/**
 * Sender service for P2P image transfers.
 *
 * Handles outgoing image transfers: validation, chunking, sending, ACK tracking,
 * and retries. Sends to multiple target peers concurrently (per-peer state tracking).
 */

import { validateImageFile, getImageDimensions, fileToArrayBuffer } from '$lib/utils/imageValidator.js';
import { saveImageTransfer, updateImageTransferState, saveImageAttachment } from '$lib/services/db.js';
import { frameChunk } from './binary.js';
import { broadcastToAll, safeSend, onMessage, buildMessage } from '$lib/services/peer/shared.js';
import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { CHUNK_SIZE, CHUNK_TIMEOUT_MS, MAX_CHUNK_RETRIES } from './types.js';
import { emitImageEvent } from './events.js';

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

    // Broadcast IMAGE_TRANSFER_START to all targets
    const { ensureBinaryChannel } = await import('./binaryChannel.js');
    const profile = { username: 'system', color: '#000', dateOfBirth: null };
    const startMsg = buildMessage('IMAGE_TRANSFER_START', myPeerId, profile, { meta });

    const targetConnsPromises = targets.map(async (peerId) => {
      const conn = ensureBinaryChannel(peerId);
      if (!conn) return null;

      if (!conn.open) {
        await new Promise((resolve) => {
          let resolved = false;
          const timeout = setTimeout(() => {
            if (!resolved) { resolved = true; resolve(); }
          }, 3000);
          conn.on('open', () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve();
            }
          });
        });
      }

      if (conn.open) {
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

    // Wait for START_ACK from each peer (with timeout)
    const acksReceived = new Set();
    const unsubscribe = onMessage('IMAGE_TRANSFER_START_ACK', (msg) => {
      if (msg.payload?.transferId === transferId) {
        acksReceived.add(msg.from.peerId);
      }
    });

    try {
      await new Promise((resolve) => {
        setTimeout(resolve, CHUNK_TIMEOUT_MS);
      });
    } finally {
      unsubscribe();
    }

    if (acksReceived.size === 0) {
      await updateImageTransferState(transferId, 'failed', {
        errorMessage: 'No peers acknowledged transfer start'
      });
      throw new Error('No peers acknowledged transfer start');
    }

    // Begin sending chunks to each peer
    const sendResults = await Promise.allSettled(
      targetConns.map((tc) => sendChunksToPeer(transferId, meta, buffer, tc.peerId, tc.conn, profile))
    );

    const failures = sendResults.filter((r) => r.status === 'rejected');
    if (failures.length === targetConns.length) {
      await updateImageTransferState(transferId, 'failed', {
        errorMessage: 'All peers failed to receive chunks'
      });
      throw new Error('All peers failed to receive chunks');
    }

    // Send COMPLETE to all peers that received chunks
    const completeMsg = buildMessage('IMAGE_TRANSFER_COMPLETE', myPeerId, profile, { transferId });
    for (const tc of targetConns) {
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

  // Track which chunks the peer has ACKed
  const ackedChunks = new Set();

  const handleAck = (msg) => {
    if (msg.payload?.transferId === transferId && msg.from.peerId === peerId) {
      ackedChunks.add(msg.payload.chunkIndex);
    }
  };

  const unsubscribe = onMessage('IMAGE_CHUNK_ACK', handleAck);

  try {
    // Probe channel health before sending
    try {
      const mod = await import('./binaryChannel.js');
      const alive = await mod.probeChannel(conn, peerId, 2000);
      if (!alive) {
        // recreate channel and use the fresh one
        mod && mod && mod;
        const { ensureBinaryChannel } = await import('./binaryChannel.js');
        conn = ensureBinaryChannel(peerId);
        if (conn && !conn.open) {
          await new Promise((resolve) => {
            const timeout = setTimeout(resolve, 3000);
            conn.on('open', () => { clearTimeout(timeout); resolve(); });
          });
        }
      }
    } catch (e) {
      console.warn('probeChannel failed', e);
    }

    for (let chunkIndex = 0; chunkIndex < meta.totalChunks; chunkIndex++) {
      // Extract chunk data
      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, buffer.byteLength);
      const chunkData = buffer.slice(start, end);

      // Send with retries
      let retries = 0;
      while (retries < MAX_CHUNK_RETRIES) {
        try {
          ackedChunks.delete(chunkIndex); // Clear ack flag

          // Frame and send binary chunk
          const framedChunk = frameChunk(transferId, chunkIndex, meta.totalChunks, chunkData);
          try {
            conn.send(framedChunk);
          } catch (err) {
            console.error(`DataChannel send failed for peer ${peerId}`, err);
            // Remove stale channel so future sends recreate it
            try {
              const mod = await import('./binaryChannel.js');
              // Trigger ensureBinaryChannel to recreate/remove stale entries as needed.
              try { await mod.ensureBinaryChannel(peerId); } catch { /* ignored */ }
            } catch {
              // Intentionally ignored: best-effort cleanup
            }
            throw err;
          }

          // Wait for ACK or timeout
          const ackReceived = await waitForAck(ackedChunks, chunkIndex, CHUNK_TIMEOUT_MS);

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
  } finally {
    unsubscribe();
  }
}

/**
 * Waits for a specific chunk to be ACKed or times out.
 *
 * @param {Set<number>} ackedChunks
 * @param {number} chunkIndex
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function waitForAck(ackedChunks, chunkIndex, timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;

    const checkInterval = setInterval(() => {
      if (ackedChunks.has(chunkIndex)) {
        clearInterval(checkInterval);
        resolve(true);
        return;
      }

      if (Date.now() >= deadline) {
        clearInterval(checkInterval);
        resolve(false);
      }
    }, 50);
  });
}

