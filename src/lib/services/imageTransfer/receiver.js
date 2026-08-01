/**
 * Receiver service for P2P image transfers.
 *
 * Handles incoming IMAGE_TRANSFER_START, IMAGE_CHUNK, IMAGE_TRANSFER_COMPLETE,
 * and IMAGE_TRANSFER_CANCELLED messages.
 */

import { initAssembly, receiveChunk, getAssembledChunks, clearAssembly } from './assemblyBuffer.js';
import { getImageTransfer, saveImageAttachment, updateImageTransferState, saveImageTransfer } from '$lib/services/db.js';
import { assembleChunks } from '$lib/utils/imageValidator.js';
import { emitImageEvent } from './events.js';
import { buildMessage, safeSend } from '$lib/services/peer/shared.js';
import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { SUPPORTED_IMAGE_TYPES, MAX_IMAGE_BYTES } from './types.js';

/**
 * Handles IMAGE_TRANSFER_START from a remote peer.
 *
 * @param {import('./types.js').ImageMeta} meta
 * @param {string} senderPeerId
 * @param {any} senderConn - DataConnection to sender
 * @returns {Promise<void>}
 */
export async function handleTransferStart(meta, senderPeerId, senderConn) {
  try {
    if (!meta?.transferId) {
      console.error('handleTransferStart: missing transferId');
      return;
    }

    // Validate metadata
    if (!SUPPORTED_IMAGE_TYPES.includes(meta.mimeType)) {
      console.warn(`Rejecting unsupported MIME type: ${meta.mimeType}`);
      sendTransferRejected(meta.transferId, 'Unsupported MIME type', senderPeerId, senderConn);
      return;
    }

    if (meta.sizeBytes > MAX_IMAGE_BYTES) {
      console.warn(`Rejecting oversized image: ${meta.sizeBytes} bytes`);
      sendTransferRejected(meta.transferId, 'File too large', senderPeerId, senderConn);
      return;
    }

    // Initialize assembly buffer
    initAssembly(meta);

    // Save transfer record with 'receiving' state
    await saveImageTransfer({
      transferId: meta.transferId,
      messageId: meta.messageId,
      context: meta.context,
      senderPeerId,
      meta,
      state: 'receiving',
      receivedChunks: 0,
      totalChunks: meta.totalChunks,
      createdAt: Date.now()
    });

    // Send ACK
    sendTransferStartAck(meta.transferId, senderPeerId, senderConn);
  } catch (err) {
    console.error('handleTransferStart failed', err);
  }
}

/**
 * Handles IMAGE_CHUNK from a remote peer.
 *
 * @param {string} transferId
 * @param {number} chunkIndex
 * @param {number} totalChunks
 * @param {ArrayBuffer} data
 * @param {string} senderPeerId
 * @param {any} senderConn
 * @returns {Promise<void>}
 */
export async function handleChunk(transferId, chunkIndex, totalChunks, data, senderPeerId, senderConn) {
  try {
    const id = String(transferId ?? '').trim();
    if (!id) return;

    // Always send ACK (idempotent)
    sendChunkAck(id, chunkIndex, senderPeerId, senderConn);

    // Store chunk
    const isComplete = receiveChunk(id, chunkIndex, data);

    if (isComplete) {
      try {
        // All chunks received—assemble and save
        const chunks = getAssembledChunks(id);
        if (!chunks) {
          console.error('handleChunk: assembled chunks is null');
          return;
        }

        const transfer = await getImageTransfer(id);
        if (!transfer?.meta) {
          console.error('handleChunk: transfer not found');
          return;
        }

        const blob = assembleChunks(chunks, transfer.meta.mimeType);

        // Save attachment
        await saveImageAttachment({
          transferId: id,
          messageId: transfer.meta.messageId,
          context: transfer.meta.context,
          blob,
          mimeType: transfer.meta.mimeType,
          filename: transfer.meta.filename,
          sizeBytes: transfer.meta.sizeBytes,
          width: transfer.meta.width,
          height: transfer.meta.height,
          storedAt: Date.now()
        });

        // Update transfer state
        await updateImageTransferState(id, 'complete', { completedAt: Date.now() });

        // Emit event
        emitImageEvent('imageReady', {
          transferId: id,
          messageId: transfer.meta.messageId,
          context: transfer.meta.context
        });
      } finally {
        // Clear assembly buffer
        clearAssembly(id);
      }
    }
  } catch (err) {
    console.error('handleChunk failed', err);
  }
}

/**
 * Handles IMAGE_TRANSFER_COMPLETE from a remote peer.
 * Verifies all chunks were received; requests retransmission if needed.
 *
 * @param {string} transferId
 * @param {string} senderPeerId
 * @param {any} senderConn
 * @returns {Promise<void>}
 */
export async function handleTransferComplete(transferId, senderPeerId, senderConn) {
  try {
    const id = String(transferId ?? '').trim();
    if (!id) return;

    const transfer = await getImageTransfer(id);
    if (!transfer) {
      console.warn(`handleTransferComplete: transfer ${id} not found`);
      return;
    }

    if (transfer.state === 'complete') {
      // Already complete, just ensure assembly is cleared
      clearAssembly(id);
      return;
    }

    const chunks = getAssembledChunks(id);
    if (chunks) {
      // It has chunks but state is not complete? Let handleChunk finish it.
      return;
    }

    // Detect missing chunks
    const missing = [];
    for (let i = 0; i < transfer.totalChunks; i++) {
      missing.push(i);
    }

    if (missing.length > 0) {
      console.warn(`handleTransferComplete: ${missing.length} chunks missing, requesting retransmission`);
      sendChunkRequest(id, missing, senderPeerId, senderConn);
    }
  } catch (err) {
    console.error('handleTransferComplete failed', err);
  }
}

/**
 * Handles IMAGE_TRANSFER_CANCELLED from a remote peer.
 *
 * @param {string} transferId
 * @returns {Promise<void>}
 */
export async function handleTransferCancelled(transferId) {
  try {
    const id = String(transferId ?? '').trim();
    if (!id) return;

    clearAssembly(id);

    await updateImageTransferState(id, 'cancelled');

    emitImageEvent('transferCancelled', { transferId: id });
  } catch (err) {
    console.error('handleTransferCancelled failed', err);
  }
}

// ============================================================================
// Helper functions for sending messages back to sender
// ============================================================================

function sendTransferStartAck(transferId, recipientPeerId, recipientConn) {
  try {
    const state = get(peerStore);
    const myPeerId = state.peerId;
    if (!myPeerId) return;

    const profile = { username: 'system', color: '#000', dateOfBirth: null };
    const msg = buildMessage('IMAGE_TRANSFER_START_ACK', myPeerId, profile, { transferId });
    safeSend(recipientConn, msg);
  } catch (err) {
    console.error('sendTransferStartAck failed', err);
  }
}

function sendTransferRejected(transferId, reason, recipientPeerId, recipientConn) {
  try {
    const state = get(peerStore);
    const myPeerId = state.peerId;
    if (!myPeerId) return;

    const profile = { username: 'system', color: '#000', dateOfBirth: null };
    const msg = buildMessage('IMAGE_TRANSFER_REJECTED', myPeerId, profile, {
      transferId,
      reason: String(reason ?? 'Unknown error')
    });
    safeSend(recipientConn, msg);
  } catch (err) {
    console.error('sendTransferRejected failed', err);
  }
}

function sendChunkAck(transferId, chunkIndex, recipientPeerId, recipientConn) {
  try {
    const state = get(peerStore);
    const myPeerId = state.peerId;
    if (!myPeerId) return;

    const profile = { username: 'system', color: '#000', dateOfBirth: null };
    const msg = buildMessage('IMAGE_CHUNK_ACK', myPeerId, profile, {
      transferId,
      chunkIndex: Number(chunkIndex)
    });
    safeSend(recipientConn, msg);
  } catch (err) {
    console.error('sendChunkAck failed', err);
  }
}

function sendChunkRequest(transferId, missingChunks, recipientPeerId, recipientConn) {
  try {
    const state = get(peerStore);
    const myPeerId = state.peerId;
    if (!myPeerId) return;

    const profile = { username: 'system', color: '#000', dateOfBirth: null };
    const msg = buildMessage('IMAGE_CHUNK_REQUEST', myPeerId, profile, {
      transferId,
      missingChunks: Array.isArray(missingChunks) ? missingChunks : []
    });
    safeSend(recipientConn, msg);
  } catch (err) {
    console.error('sendChunkRequest failed', err);
  }
}

