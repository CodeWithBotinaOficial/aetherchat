/**
 * Receiver service for P2P image transfers.
 *
 * Handles incoming IMAGE_TRANSFER_START, IMAGE_CHUNK, IMAGE_TRANSFER_COMPLETE,
 * and IMAGE_TRANSFER_CANCELLED messages.
 *
 * Robustness guarantees:
 *  - handleChunk auto-initialises assembly if IMAGE_TRANSFER_START was missed
 *    (network reorder / dropped JSON message). Chunks are never silently discarded.
 *  - handleTransferStart is idempotent: if chunks arrived first (placeholder meta
 *    already in assembly) it updates the DB record with the real meta so that
 *    assembleChunks gets the correct mimeType.
 *  - Every ACK send and completion event is logged for debugging.
 */

import { initAssembly, receiveChunk, getAssembledChunks, clearAssembly, getAssemblyEntry } from './assemblyBuffer.js';
import { getImageTransfer, saveImageAttachment, updateImageTransferState, saveImageTransfer } from '$lib/services/db.js';
import { assembleChunks } from '$lib/utils/imageValidator.js';
import { emitImageEvent } from './events.js';
import { buildMessage, safeSend } from '$lib/services/peer/shared.js';
import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { SUPPORTED_IMAGE_TYPES, MAX_IMAGE_BYTES } from './types.js';

// ---------------------------------------------------------------------------
// Logging prefix for easy filtering in DevTools
// ---------------------------------------------------------------------------
const LOG = '[ImageReceiver]';

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
      console.error(`${LOG} handleTransferStart: missing transferId`);
      return;
    }

    console.warn(`${LOG} START received transferId=${meta.transferId} from=${senderPeerId} chunks=${meta.totalChunks} size=${meta.sizeBytes}`);

    // Validate metadata
    if (!SUPPORTED_IMAGE_TYPES.includes(meta.mimeType)) {
      console.warn(`${LOG} Rejecting unsupported MIME type: ${meta.mimeType} (transferId=${meta.transferId})`);
      sendTransferRejected(meta.transferId, 'Unsupported MIME type', senderPeerId, senderConn);
      return;
    }

    if (meta.sizeBytes > MAX_IMAGE_BYTES) {
      console.warn(`${LOG} Rejecting oversized image: ${meta.sizeBytes} bytes (transferId=${meta.transferId})`);
      sendTransferRejected(meta.transferId, 'File too large', senderPeerId, senderConn);
      return;
    }

    const existingEntry = getAssemblyEntry(meta.transferId);
    if (existingEntry) {
      // Chunks arrived before START (network reorder). The placeholder meta in
      // the assembly buffer is incomplete — update the DB record with real meta
      // so assembleChunks produces a correctly-typed Blob when the last chunk fires.
      console.warn(`${LOG} Late START: assembly already exists for ${meta.transferId}, updating DB meta`);
      await updateImageTransferState(meta.transferId, 'receiving', {
        meta,
        messageId: meta.messageId,
        context: meta.context,
        senderPeerId,
        totalChunks: meta.totalChunks
      });
    } else {
      // Normal path: initialise assembly and create DB record
      initAssembly(meta);
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
    }

    // Send ACK — always
    sendTransferStartAck(meta.transferId, senderPeerId, senderConn);
    console.warn(`${LOG} START_ACK sent transferId=${meta.transferId} to=${senderPeerId}`);
  } catch (err) {
    console.error(`${LOG} handleTransferStart failed`, err);
  }
}

/**
 * Handles IMAGE_CHUNK from a remote peer.
 *
 * If assembly was never initialised (IMAGE_TRANSFER_START was missed), a
 * placeholder entry is created so the chunk is stored rather than discarded.
 * The placeholder meta will be upgraded when/if START arrives later.
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

    // ----------------------------------------------------------------
    // Fallback: auto-initialise assembly if IMAGE_TRANSFER_START was missed.
    // This ensures chunks are stored even in the presence of message reordering.
    // ----------------------------------------------------------------
    if (!getAssemblyEntry(id)) {
      console.warn(
        `${LOG} handleChunk: no assembly for ${id} (START missed?), ` +
        `auto-initialising placeholder (totalChunks=${totalChunks}) from=${senderPeerId}`
      );
      const placeholderMeta = {
        transferId: id,
        filename: 'image',
        mimeType: 'application/octet-stream', // overwritten when real START arrives
        sizeBytes: 0,
        totalChunks,
        width: 0,
        height: 0,
        context: 'global',
        messageId: '',
        senderPeerId,
        createdAt: Date.now()
      };
      initAssembly(placeholderMeta);
      // Save a minimal DB record so the transfer is tracked and can be updated later
      await saveImageTransfer({
        transferId: id,
        messageId: '',
        context: 'global',
        senderPeerId,
        meta: placeholderMeta,
        state: 'receiving',
        receivedChunks: 0,
        totalChunks,
        createdAt: Date.now()
      }).catch(() => {}); // non-fatal if it already exists
    }

    // Always ACK the chunk immediately (idempotent, safe to re-ACK duplicates)
    sendChunkAck(id, chunkIndex, senderPeerId, senderConn);
    console.warn(`${LOG} CHUNK_ACK sent chunkIndex=${chunkIndex} transferId=${id} to=${senderPeerId} at=${Date.now()}`);

    // Store chunk
    const isComplete = receiveChunk(id, chunkIndex, data);

    if (isComplete) {
      console.warn(`${LOG} All chunks received for ${id}, assembling…`);
      try {
        const chunks = getAssembledChunks(id);
        if (!chunks) {
          console.error(`${LOG} handleChunk: assembled chunks is null for ${id}`);
          return;
        }

        const transfer = await getImageTransfer(id);
        if (!transfer?.meta) {
          console.error(`${LOG} handleChunk: transfer not found in DB for ${id}`);
          return;
        }

        const blob = assembleChunks(chunks, transfer.meta.mimeType);

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

        await updateImageTransferState(id, 'complete', { completedAt: Date.now() });

        console.warn(`${LOG} Transfer complete and saved: ${id}`);
        emitImageEvent('imageReady', {
          transferId: id,
          messageId: transfer.meta.messageId,
          context: transfer.meta.context
        });
      } finally {
        clearAssembly(id);
      }
    }
  } catch (err) {
    console.error(`${LOG} handleChunk failed chunkIndex=${chunkIndex} transferId=${transferId}`, err);
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
      console.warn(`${LOG} handleTransferComplete: transfer ${id} not found`);
      return;
    }

    if (transfer.state === 'complete') {
      clearAssembly(id);
      return;
    }

    const chunks = getAssembledChunks(id);
    if (chunks) {
      // handleChunk will finish it
      return;
    }

    // Detect missing chunks
    const missing = [];
    for (let i = 0; i < transfer.totalChunks; i++) {
      missing.push(i);
    }

    if (missing.length > 0) {
      console.warn(`${LOG} handleTransferComplete: ${missing.length} chunks missing for ${id}, requesting retransmission`);
      sendChunkRequest(id, missing, senderPeerId, senderConn);
    }
  } catch (err) {
    console.error(`${LOG} handleTransferComplete failed`, err);
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
    console.error(`${LOG} handleTransferCancelled failed`, err);
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
    console.error(`${LOG} sendTransferStartAck failed`, err);
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
    console.error(`${LOG} sendTransferRejected failed`, err);
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
    console.error(`${LOG} sendChunkAck failed`, err);
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
    console.error(`${LOG} sendChunkRequest failed`, err);
  }
}
