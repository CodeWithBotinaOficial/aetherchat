/**
 * Sender service for P2P image transfers.
 *
 * Handles outgoing image transfers: validation, chunking, sending, ACK tracking,
 * and retries. Sends to multiple target peers concurrently (per-peer state tracking).
 *
 * ACK tracking is done via the internal event bus (events.js) rather than raw
 * conn.on('data') listeners. This eliminates a race condition where ACKs could
 * arrive before the sender's listener was registered — router.js now emits
 * named events that sender.js subscribes to before sending.
 */

import { validateImageFile, getImageDimensions, fileToArrayBuffer } from '$lib/utils/imageValidator.js';
import { saveImageTransfer, updateImageTransferState, saveImageAttachment } from '$lib/services/db.js';
import { frameChunk } from './binary.js';
import { broadcastToAll, safeSend, buildMessage } from '$lib/services/peer/shared.js';
import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { CHUNK_SIZE, CHUNK_TIMEOUT_MS, MAX_CHUNK_RETRIES } from './types.js';
import { emitImageEvent, onImageEvent } from './events.js';

export function getStandardConnection(peerId) {
  const entry = get(peerStore).connectedPeers.get(peerId);
  return entry?.connection ?? null;
}

async function waitForConnectionOpen(conn, timeoutMs = 3000) {
  if (!conn || conn.open !== false) return Boolean(conn);

  return await new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    conn.on?.('open', () => finish(true));
  });
}

/**
 * Waits for IMAGE_TRANSFER_START_ACK via the event bus.
 * Subscribes BEFORE the caller sends the start message to guarantee no ACK is missed.
 *
 * @param {string} transferId
 * @param {string} fromPeerId
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
export function waitForTransferStartAck(transferId, fromPeerId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, timeoutMs);

    const unsubscribe = onImageEvent('transferStartAck', (payload) => {
      if (payload.transferId === transferId && payload.fromPeerId === fromPeerId) {
        clearTimeout(timer);
        unsubscribe();
        resolve(true);
      }
    });
  });
}

/**
 * Waits for IMAGE_CHUNK_ACK via the event bus.
 *
 * @param {string} transferId
 * @param {number} chunkIndex
 * @param {string} fromPeerId
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
export function waitForChunkAck(transferId, chunkIndex, fromPeerId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, timeoutMs);

    const unsubscribe = onImageEvent('chunkAck', (payload) => {
      if (
        payload.transferId === transferId &&
        payload.chunkIndex === chunkIndex &&
        payload.fromPeerId === fromPeerId
      ) {
        clearTimeout(timer);
        unsubscribe();
        resolve(true);
      }
    });
  });
}

/**
 * Probes the standard channel to verify it is alive.
 * Sends IMAGE_PING via safeSend and waits for IMAGE_PONG via the event bus.
 * Subscribes to 'imagePong' BEFORE sending the ping to avoid any race.
 *
 * @param {string} peerId
 * @param {number} [timeoutMs=2000]
 * @returns {Promise<boolean>}
 */
export async function probeChannel(peerId, timeoutMs = 2000) {
  const conn = getStandardConnection(peerId);
  if (!conn || !conn.open) return false;

  const nonce = globalThis.crypto?.randomUUID?.() || String(Date.now());

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, timeoutMs);

    // Subscribe BEFORE sending so we never miss the PONG
    const unsubscribe = onImageEvent('imagePong', (payload) => {
      if (payload.nonce === nonce && payload.fromPeerId === peerId) {
        clearTimeout(timer);
        unsubscribe();
        resolve(true);
      }
    });

    try {
      const myPeerId = get(peerStore).peerId;
      if (!myPeerId) throw new Error('Local peer ID not available');
      const profile = { username: 'system', color: '#000', dateOfBirth: null };
      safeSend(conn, buildMessage('IMAGE_PING', myPeerId, profile, { nonce }));
    } catch {
      clearTimeout(timer);
      unsubscribe();
      resolve(false);
    }
  });
}

async function sendChunkToConn(conn, framedChunk) {
  return new Promise((resolve, reject) => {
    try {
      conn.send(framedChunk);
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Initiates a P2P image transfer to one or more peers.
 *
 * @param {File} file
 * @param {string[]} targetPeerIds
 * @param {string} messageId
 * @param {string} context - 'global' | 'private' | 'wall'
 * @returns {Promise<{ transferId: string, meta: import('./types.js').ImageMeta }>}
 */
export async function sendImage(file, targetPeerIds, messageId, context, overrideTransferId = null) {
  try {
    // Validate file
    const validation = validateImageFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Get dimensions
    const { width, height } = await getImageDimensions(file);

    // Get my peer ID
    const state = get(peerStore);
    const myPeerId = state.peerId;
    if (!myPeerId) {
      throw new Error('Local peer ID not available');
    }

    // Convert file to ArrayBuffer
    const buffer = await fileToArrayBuffer(file);

    // Generate transfer ID
    const transferId = overrideTransferId || globalThis.crypto?.randomUUID?.() || String(Date.now());

    // Build metadata
    const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE);
    const meta = {
      transferId,
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      totalChunks,
      width,
      height,
      context: String(context ?? 'global'),
      messageId: String(messageId ?? ''),
      senderPeerId: myPeerId,
      createdAt: Date.now()
    };

    // Save transfer record with 'sending' state
    await saveImageTransfer({
      transferId,
      messageId: meta.messageId,
      context: meta.context,
      senderPeerId: myPeerId,
      meta,
      state: 'sending',
      receivedChunks: 0,
      totalChunks,
      createdAt: Date.now()
    });

    // Save image attachment locally for the sender
    await saveImageAttachment({
      transferId,
      messageId: meta.messageId,
      context: meta.context,
      blob: new Blob([buffer], { type: meta.mimeType }),
      mimeType: meta.mimeType,
      filename: meta.filename,
      sizeBytes: meta.sizeBytes,
      width: meta.width,
      height: meta.height,
      storedAt: Date.now()
    });

    // Filter and validate target peers
    const targets = Array.isArray(targetPeerIds)
      ? targetPeerIds.filter((pid) => typeof pid === 'string' && pid.length > 0 && pid !== myPeerId)
      : [];

    if (targets.length === 0) {
      await updateImageTransferState(transferId, 'failed', {
        errorMessage: 'No valid target peers'
      });
      throw new Error('No valid target peers specified');
    }

    // Send IMAGE_TRANSFER_START to all targets on the standard JSON connection.
    const profile = { username: 'system', color: '#000', dateOfBirth: null };
    const startMsg = buildMessage('IMAGE_TRANSFER_START', myPeerId, profile, { meta });

    const targetConnsPromises = targets.map(async (peerId) => {
      const conn = getStandardConnection(peerId);
      if (!conn) return null;
      if (await waitForConnectionOpen(conn)) {
        return { peerId, conn };
      }
      return null;
    });

    const targetConnsResults = await Promise.all(targetConnsPromises);
    const targetConns = targetConnsResults.filter(Boolean);

    if (targetConns.length === 0) {
      await updateImageTransferState(transferId, 'failed', {
        errorMessage: 'No connected target peers'
      });
      throw new Error('No connected target peers');
    }

    // Subscribe to transferStartAck BEFORE sending start messages (prevents race condition)
    const ackResults = await Promise.all(
      targetConns.map(async (tc) => {
        // 1. Register listener first
        const ackPromise = waitForTransferStartAck(transferId, tc.peerId, CHUNK_TIMEOUT_MS);
        // 2. Then send the start message
        safeSend(tc.conn, startMsg);
        return { ...tc, acked: await ackPromise };
      })
    );
    const ackedTargetConns = ackResults.filter((tc) => tc.acked);

    if (ackedTargetConns.length === 0) {
      await updateImageTransferState(transferId, 'failed', {
        errorMessage: 'No peers acknowledged transfer start'
      });
      throw new Error('No peers acknowledged transfer start');
    }

    // Begin sending chunks to each peer
    const sendResults = await Promise.allSettled(
      ackedTargetConns.map((tc) => sendChunksToPeer(transferId, meta, buffer, tc.peerId, tc.conn, profile))
    );

    const failures = sendResults.filter((r) => r.status === 'rejected');
    if (failures.length === ackedTargetConns.length) {
      await updateImageTransferState(transferId, 'failed', {
        errorMessage: 'All peers failed to receive chunks'
      });
      throw new Error('All peers failed to receive chunks');
    }

    // Send COMPLETE to all peers that received chunks
    const completeMsg = buildMessage('IMAGE_TRANSFER_COMPLETE', myPeerId, profile, { transferId });
    for (const tc of ackedTargetConns) {
      safeSend(tc.conn, completeMsg);
    }

    // Update transfer state to complete
    await updateImageTransferState(transferId, 'complete', {
      completedAt: Date.now()
    });

    emitImageEvent('transferProgress', {
      transferId,
      receivedChunks: totalChunks,
      totalChunks
    });

    return { transferId, meta };
  } catch (err) {
    console.error('sendImage failed', err);
    throw err;
  }
}

/**
 * Cancels an in-progress outgoing transfer.
 * Sends IMAGE_TRANSFER_CANCELLED to all connected peers.
 *
 * @param {string} transferId
 * @returns {Promise<void>}
 */
export async function cancelOutgoingTransfer(transferId) {
  try {
    const id = String(transferId ?? '').trim();
    if (!id) return;

    const state = get(peerStore);
    const myPeerId = state.peerId;
    if (!myPeerId) return;

    // Broadcast cancellation
    const profile = { username: 'system', color: '#000', dateOfBirth: null };
    const msg = buildMessage('IMAGE_TRANSFER_CANCELLED', myPeerId, profile, { transferId: id });
    broadcastToAll(msg);

    // Update DB
    await updateImageTransferState(id, 'cancelled');
  } catch (err) {
    console.error('cancelOutgoingTransfer failed', err);
  }
}

// ============================================================================
// Internal: Chunk sending with per-peer ACK tracking and retries
// ============================================================================

/**
 * Sends a single framed binary chunk and waits for its ACK via the event bus.
 *
 * @param {any} conn
 * @param {ArrayBuffer[]} chunks - pre-sliced chunk buffers (indexed by chunkIndex)
 * @param {string} transferId
 * @param {number} chunkIndex
 * @param {number} totalChunks
 * @param {string} peerId
 * @returns {Promise<void>} resolves when ACK received, rejects on max retries
 */
async function sendSingleChunk(conn, chunks, transferId, chunkIndex, totalChunks, peerId) {
  let retries = 0;
  while (retries < MAX_CHUNK_RETRIES) {
    try {
      const framedChunk = frameChunk(transferId, chunkIndex, totalChunks, chunks[chunkIndex]);
      await sendChunkToConn(conn, framedChunk);

      // Subscribe via event bus — no race condition possible
      const ackReceived = await waitForChunkAck(transferId, chunkIndex, peerId, CHUNK_TIMEOUT_MS);

      if (ackReceived) return; // success

      retries++;
      if (retries < MAX_CHUNK_RETRIES) {
        // Exponential backoff: 500ms, 1000ms, 2000ms
        const delay = 500 * Math.pow(2, Math.max(0, retries - 1));
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } catch (err) {
      console.error(`Chunk ${chunkIndex} send failed`, err);
      retries++;
    }
  }
  throw new Error(`Chunk ${chunkIndex} max retries exceeded`);
}

/**
 * Sends all chunks to a specific peer, tracking ACKs and retrying on timeout.
 *
 * @param {string} transferId
 * @param {Object} meta
 * @param {ArrayBuffer} buffer
 * @param {string} peerId
 * @param {any} conn
 * @param {Object} profile
 * @returns {Promise<void>}
 */
async function sendChunksToPeer(transferId, meta, buffer, peerId, conn, _profile) {
  const myPeerId = get(peerStore).peerId;
  if (!myPeerId) throw new Error('Local peer ID not available');

  const alive = await probeChannel(peerId, 2000);
  if (!alive) throw new Error(`Connection probe failed for peer ${peerId}`);

  // Pre-slice all chunks
  const chunks = [];
  for (let i = 0; i < meta.totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, buffer.byteLength);
    chunks.push(buffer.slice(start, end));
  }

  // Subscribe to chunkRequest events for this transfer so we can retransmit missing chunks
  const unsubscribeChunkRequest = onImageEvent('chunkRequest', async (payload) => {
    if (payload.transferId !== transferId || payload.fromPeerId !== peerId) return;
    for (const idx of payload.missingChunks) {
      if (idx >= 0 && idx < chunks.length) {
        try {
          await sendSingleChunk(conn, chunks, transferId, idx, meta.totalChunks, peerId);
        } catch (err) {
          console.error(`Retransmit chunk ${idx} failed`, err);
        }
      }
    }
  });

  try {
    for (let chunkIndex = 0; chunkIndex < meta.totalChunks; chunkIndex++) {
      await sendSingleChunk(conn, chunks, transferId, chunkIndex, meta.totalChunks, peerId);
    }
  } catch (err) {
    console.error(`sendChunksToPeer failed for peer ${peerId}`, err);
    throw err;
  } finally {
    unsubscribeChunkRequest();
  }
}

export async function retransmitChunks(transferId, requesterPeerId, missingChunks) {
  console.warn('IMAGE_CHUNK_REQUEST received but retransmission cache is unavailable', {
    transferId,
    requesterPeerId,
    missingChunks
  });
}
