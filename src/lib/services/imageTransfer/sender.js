/**
 * Sender service for P2P image transfers.
 *
 * Handles outgoing image transfers: validation, chunking, sending, ACK tracking,
 * and retries. Sends to multiple target peers concurrently (per-peer state tracking).
 */

import { validateImageFile, getImageDimensions, fileToArrayBuffer } from '$lib/utils/imageValidator.js';
import { saveImageTransfer, updateImageTransferState, saveImageAttachment } from '$lib/services/db.js';
import { frameChunk } from './binary.js';
import { broadcastToAll, safeSend, buildMessage } from '$lib/services/peer/shared.js';
import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { CHUNK_SIZE, CHUNK_TIMEOUT_MS, MAX_CHUNK_RETRIES } from './types.js';
import { emitImageEvent } from './events.js';

export function getStandardConnection(peerId) {
  const entry = get(peerStore).connectedPeers.get(peerId);
  return entry?.connection ?? null;
}

function removeDataListener(conn, handler) {
  if (typeof conn?.off === 'function') {
    conn.off('data', handler);
    return;
  }
  if (typeof conn?.removeListener === 'function') {
    conn.removeListener('data', handler);
  }
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

export function waitForAck(conn, messageType, transferId, timeoutMs, predicate = null) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      removeDataListener(conn, handler);
      resolve(false);
    }, timeoutMs);

    function handler(data) {
      if (data instanceof ArrayBuffer) return;
      if (data?.type !== messageType) return;
      if (data?.payload?.transferId !== transferId) return;
      if (typeof predicate === 'function' && !predicate(data)) return;

      clearTimeout(timer);
      removeDataListener(conn, handler);
      resolve(true);
    }

    conn.on?.('data', handler);
  });
}

export async function probeChannel(peerId, timeoutMs = 2000) {
  const conn = getStandardConnection(peerId);
  if (!conn || !conn.open) return false;

  const nonce = globalThis.crypto?.randomUUID?.() || String(Date.now());

  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      removeDataListener(conn, handler);
      resolve(false);
    }, timeoutMs);

    function handler(data) {
      if (data instanceof ArrayBuffer) return;
      if (data?.type === 'IMAGE_PONG' && data?.payload?.nonce === nonce) {
        clearTimeout(timer);
        removeDataListener(conn, handler);
        resolve(true);
      }
    }

    conn.on?.('data', handler);

    try {
      const myPeerId = get(peerStore).peerId;
      if (!myPeerId) throw new Error('Local peer ID not available');
      const profile = { username: 'system', color: '#000', dateOfBirth: null };
      conn.send(buildMessage('IMAGE_PING', myPeerId, profile, { nonce }));
    } catch {
      clearTimeout(timer);
      removeDataListener(conn, handler);
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

    for (const tc of targetConns) {
      safeSend(tc.conn, startMsg);
    }

    if (targetConns.length === 0) {
      await updateImageTransferState(transferId, 'failed', {
        errorMessage: 'No connected target peers'
      });
      throw new Error('No connected target peers');
    }

    const ackResults = await Promise.all(
      targetConns.map(async (tc) => ({
        ...tc,
        acked: await waitForAck(
          tc.conn,
          'IMAGE_TRANSFER_START_ACK',
          transferId,
          CHUNK_TIMEOUT_MS,
          (msg) => msg.from?.peerId === tc.peerId
        )
      }))
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

  try {
    for (let chunkIndex = 0; chunkIndex < meta.totalChunks; chunkIndex++) {
      // Extract chunk data
      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, buffer.byteLength);
      const chunkData = buffer.slice(start, end);

      // Send with retries
      let retries = 0;
      while (retries < MAX_CHUNK_RETRIES) {
        try {
          // Frame and send binary chunk
          const framedChunk = frameChunk(transferId, chunkIndex, meta.totalChunks, chunkData);
          await sendChunkToConn(conn, framedChunk);

          // Wait for ACK or timeout
          const ackReceived = await waitForAck(
            conn,
            'IMAGE_CHUNK_ACK',
            transferId,
            CHUNK_TIMEOUT_MS,
            (msg) => msg.from?.peerId === peerId && msg.payload?.chunkIndex === chunkIndex
          );

          if (ackReceived) {
            break; // Move to next chunk
          }

          retries++;
          if (retries < MAX_CHUNK_RETRIES) {
            // Retry with exponential backoff (500ms, 1000ms, 2000ms)
            const delay = 500 * Math.pow(2, Math.max(0, retries - 1));
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        } catch (err) {
          console.error(`Chunk ${chunkIndex} send failed`, err);
          retries++;
        }
      }

      if (retries >= MAX_CHUNK_RETRIES) {
        throw new Error(`Chunk ${chunkIndex} max retries exceeded`);
      }
    }
  } catch (err) {
    console.error(`sendChunksToPeer failed for peer ${peerId}`, err);
    throw err;
  }
}

export async function retransmitChunks(transferId, requesterPeerId, missingChunks) {
  console.warn('IMAGE_CHUNK_REQUEST received but retransmission cache is unavailable', {
    transferId,
    requesterPeerId,
    missingChunks
  });
}
