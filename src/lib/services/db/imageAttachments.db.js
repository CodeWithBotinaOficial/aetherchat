import { db } from './schema.js';

/**
 * Saves an image attachment to the database.
 * @param {import('../imageTransfer/types.js').ImageAttachment} attachment
 * @returns {Promise<void>}
 */
export async function saveImageAttachment(attachment) {
  try {
    if (!attachment?.transferId) throw new Error('Missing transferId');
    // Store binary data as ArrayBuffer for broad IndexedDB compatibility in tests
    let data = null;
    if (attachment.blob && typeof attachment.blob.arrayBuffer === 'function') {
      try {
        data = await attachment.blob.arrayBuffer();
      } catch (err) {
        console.error('Failed to read blob arrayBuffer', err);
        data = null;
      }
    }

    await db.imageAttachments.put({
      transferId: attachment.transferId,
      messageId: attachment.messageId || '',
      context: attachment.context || 'global',
      // persist raw binary in `data` field; callers expect `blob` on retrieval
      data,
      mimeType: attachment.mimeType || 'application/octet-stream',
      filename: attachment.filename || 'image',
      sizeBytes: attachment.sizeBytes || 0,
      width: attachment.width || 0,
      height: attachment.height || 0,
      storedAt: attachment.storedAt || Date.now()
    });
  } catch (err) {
    console.error('saveImageAttachment failed', err);
    throw err;
  }
}

/**
 * Retrieves an image attachment by transferId.
 * @param {string} transferId
 * @returns {Promise<import('../imageTransfer/types.js').ImageAttachment|null>}
 */
export async function getImageAttachment(transferId) {
  try {
    const key = String(transferId ?? '').trim();
    if (!key) return null;
    const rec = (await db.imageAttachments.get(key)) ?? null;
    if (!rec) return null;
    // Reconstruct Blob if stored as ArrayBuffer
    if (rec.data && !(rec.data instanceof Blob)) {
      try {
        rec.blob = new Blob([rec.data], { type: rec.mimeType || 'application/octet-stream' });
      } catch (err) {
        // Fallback: empty blob
        rec.blob = new Blob([], { type: rec.mimeType || 'application/octet-stream' });
      }
    } else if (rec.blob && rec.blob instanceof Blob) {
      // already a Blob
    } else {
      rec.blob = new Blob([], { type: rec.mimeType || 'application/octet-stream' });
    }
    return rec;
  } catch (err) {
    console.error('getImageAttachment failed', err);
    throw err;
  }
}

/**
 * Retrieves all image attachments for a given message.
 * @param {string} messageId
 * @returns {Promise<import('../imageTransfer/types.js').ImageAttachment[]>}
 */
export async function getImageAttachmentByMessageId(messageId) {
  try {
    const id = String(messageId ?? '').trim();
    if (!id) return [];
    const rows = await db.imageAttachments.where('messageId').equals(id).toArray();
    return rows.map((rec) => {
      if (rec.data && !(rec.data instanceof Blob)) {
        try {
          rec.blob = new Blob([rec.data], { type: rec.mimeType || 'application/octet-stream' });
        } catch {
          rec.blob = new Blob([], { type: rec.mimeType || 'application/octet-stream' });
        }
      } else if (rec.blob && rec.blob instanceof Blob) {
        // ok
      } else {
        rec.blob = new Blob([], { type: rec.mimeType || 'application/octet-stream' });
      }
      return rec;
    });
  } catch (err) {
    console.error('getImageAttachmentByMessageId failed', err);
    throw err;
  }
}

/**
 * Deletes an image attachment by transferId.
 * @param {string} transferId
 * @returns {Promise<void>}
 */
export async function deleteImageAttachment(transferId) {
  try {
    const key = String(transferId ?? '').trim();
    if (!key) return;
    await db.imageAttachments.delete(key);
  } catch (err) {
    console.error('deleteImageAttachment failed', err);
    throw err;
  }
}

/**
 * Deletes all image attachments for a given message.
 * @param {string} messageId
 * @returns {Promise<number>} count deleted
 */
export async function deleteImageAttachmentsByMessageId(messageId) {
  try {
    const id = String(messageId ?? '').trim();
    if (!id) return 0;
    return await db.imageAttachments.where('messageId').equals(id).delete();
  } catch (err) {
    console.error('deleteImageAttachmentsByMessageId failed', err);
    throw err;
  }
}

/**
 * Deletes image attachments older than the given age in milliseconds.
 * @param {number} olderThanMs
 * @returns {Promise<number>} count deleted
 */
export async function cleanOldImageAttachments(olderThanMs) {
  try {
    const ms = Number(olderThanMs);
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    const cutoff = Date.now() - ms;
    return await db.imageAttachments.where('storedAt').below(cutoff).delete();
  } catch (err) {
    console.error('cleanOldImageAttachments failed', err);
    throw err;
  }
}

