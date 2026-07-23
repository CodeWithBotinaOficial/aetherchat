import { db } from './schema.js';

/**
 * Saves an image transfer record to the database.
 * @param {Object} transfer
 * @param {string} transfer.transferId
 * @param {string} transfer.messageId
 * @param {string} transfer.context
 * @param {string} transfer.senderPeerId
 * @param {any} transfer.meta - ImageMeta object
 * @param {string} transfer.state - TransferState
 * @param {number} transfer.receivedChunks
 * @param {number} transfer.totalChunks
 * @param {number} transfer.createdAt
 * @param {number} transfer.completedAt
 * @param {string} transfer.errorMessage
 * @returns {Promise<void>}
 */
export async function saveImageTransfer(transfer) {
  try {
    if (!transfer?.transferId) throw new Error('Missing transferId');
    await db.imageTransfers.put({
      transferId: transfer.transferId,
      messageId: transfer.messageId || '',
      context: transfer.context || 'global',
      senderPeerId: transfer.senderPeerId || '',
      meta: transfer.meta || {},
      state: transfer.state || 'pending',
      receivedChunks: transfer.receivedChunks || 0,
      totalChunks: transfer.totalChunks || 0,
      createdAt: transfer.createdAt || Date.now(),
      completedAt: transfer.completedAt || null,
      errorMessage: transfer.errorMessage || null
    });
  } catch (err) {
    console.error('saveImageTransfer failed', err);
    throw err;
  }
}

/**
 * Retrieves an image transfer by transferId.
 * @param {string} transferId
 * @returns {Promise<Object|null>}
 */
export async function getImageTransfer(transferId) {
  try {
    const key = String(transferId ?? '').trim();
    if (!key) return null;
    return (await db.imageTransfers.get(key)) ?? null;
  } catch (err) {
    console.error('getImageTransfer failed', err);
    throw err;
  }
}

/**
 * Updates the state of an image transfer.
 * @param {string} transferId
 * @param {string} state - TransferState
 * @param {Object} [extra] - additional fields to update
 * @returns {Promise<number>} number of rows modified
 */
export async function updateImageTransferState(transferId, state, extra) {
  try {
    const key = String(transferId ?? '').trim();
    if (!key) return 0;
    const patch = { state: String(state ?? 'pending'), ...extra };
    return await db.imageTransfers.update(key, patch);
  } catch (err) {
    console.error('updateImageTransferState failed', err);
    throw err;
  }
}

/**
 * Retrieves transfers that are stuck in 'sending' or 'receiving' state
 * for longer than the specified duration.
 * @param {number} olderThanMs
 * @returns {Promise<Object[]>}
 */
export async function getStaleTransfers(olderThanMs) {
  try {
    const ms = Number(olderThanMs);
    if (!Number.isFinite(ms) || ms <= 0) return [];
    
    // Clean up old completed/failed transfers first (older than 1 hour)
    const ONE_HOUR = 60 * 60 * 1000;
    const cleanupCutoff = Date.now() - ONE_HOUR;
    await db.imageTransfers
      .where('createdAt')
      .below(cleanupCutoff)
      .filter((t) => ['complete', 'failed', 'cancelled'].includes(t.state))
      .delete();

    const cutoff = Date.now() - ms;
    const stuck = await db.imageTransfers
      .where('state')
      .anyOf('sending', 'receiving')
      .filter((t) => t.createdAt < cutoff)
      .toArray();
    return stuck;
  } catch (err) {
    console.error('getStaleTransfers failed', err);
    throw err;
  }
}

/**
 * Deletes an image transfer record.
 * @param {string} transferId
 * @returns {Promise<void>}
 */
export async function deleteImageTransfer(transferId) {
  try {
    const key = String(transferId ?? '').trim();
    if (!key) return;
    await db.imageTransfers.delete(key);
  } catch (err) {
    console.error('deleteImageTransfer failed', err);
    throw err;
  }
}

