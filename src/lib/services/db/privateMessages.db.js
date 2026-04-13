import { db } from './schema.js';

// ── Private Messages (Phase 5) ───────────────────────────────────────────────

/**
 * Stores ciphertext + iv only. Plaintext MUST NOT be stored.
 * @param {import('./types.js').PrivateMessage} msg
 */
export async function savePrivateMessage(msg) {
  try {
    if (!msg || typeof msg !== 'object') throw new Error('Missing message');
    if (typeof msg.id !== 'string' || msg.id.length === 0) throw new Error('Missing msg.id');
    if (typeof msg.chatId !== 'string' || msg.chatId.length === 0) throw new Error('Missing msg.chatId');
    if (typeof msg.ciphertext !== 'string' || msg.ciphertext.length === 0) throw new Error('Missing ciphertext');
    if (typeof msg.iv !== 'string' || msg.iv.length === 0) throw new Error('Missing iv');
    await db.privateMessages.put({
      editedAt: Object.prototype.hasOwnProperty.call(msg, 'editedAt') ? (msg.editedAt ?? null) : null,
      deleted: Object.prototype.hasOwnProperty.call(msg, 'deleted') ? Boolean(msg.deleted) : false,
      ...msg
    });
  } catch (err) {
    console.error('savePrivateMessage failed', err);
    throw err;
  }
}

/**
 * @param {string} id
 * @param {Partial<import('./types.js').PrivateMessage>} patch
 * @returns {Promise<number>} number of modified rows
 */
export async function updatePrivateMessage(id, patch) {
  try {
    const key = String(id ?? '').trim();
    if (!key) return 0;
    if (!patch || typeof patch !== 'object') return 0;
    return await db.privateMessages.update(key, patch);
  } catch (err) {
    console.error('updatePrivateMessage failed', err);
    throw err;
  }
}

/**
 * @param {string} chatId
 * @param {number} [limit=100]
 * @returns {Promise<import('./types.js').PrivateMessage[]>}
 */
export async function getPrivateMessages(chatId, limit = 100) {
  try {
    const list = await db.privateMessages.where('chatId').equals(chatId).toArray();
    list.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    if (list.length <= limit) return list;
    return list.slice(list.length - limit);
  } catch (err) {
    console.error('getPrivateMessages failed', err);
    throw err;
  }
}

/**
 * @param {string} chatId
 * @param {number} beforeTimestamp
 * @param {number} [limit=50]
 * @returns {Promise<import('./types.js').PrivateMessage[]>}
 */
export async function getPrivateMessagesPage(chatId, beforeTimestamp, limit = 50) {
  try {
    const list = await db.privateMessages.where('chatId').equals(chatId).toArray();
    const filtered = list.filter((m) => (m.timestamp ?? 0) < beforeTimestamp);
    filtered.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
    const page = filtered.slice(0, limit);
    page.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    return page;
  } catch (err) {
    console.error('getPrivateMessagesPage failed', err);
    throw err;
  }
}

/**
 * @param {string} messageId
 */
export async function markMessageDelivered(messageId) {
  try {
    await db.privateMessages.update(messageId, { delivered: true });
  } catch (err) {
    console.error('markMessageDelivered failed', err);
    throw err;
  }
}

/**
 * @param {string} chatId
 */
export async function deletePrivateMessages(chatId) {
  try {
    await db.privateMessages.where('chatId').equals(chatId).delete();
  } catch (err) {
    console.error('deletePrivateMessages failed', err);
    throw err;
  }
}

// ── Session Key Ring (Phase 9) ───────────────────────────────────────────────

/**
 * Persist the session key ring for a private chat (local-only).
 * @param {string} chatId
 * @param {{ keyBase64: string, createdAt: number }[]} keys
 */
export async function saveSessionKeyRing(chatId, keys) {
  try {
    const id = String(chatId ?? '').trim();
    if (!id) return;
    const list = Array.isArray(keys) ? keys.filter((k) => typeof k?.keyBase64 === 'string' && typeof k?.createdAt === 'number') : [];
    await db.sessionKeys.put({ id, keys: list, updatedAt: Date.now() });
  } catch (err) {
    console.error('saveSessionKeyRing failed', err);
    throw err;
  }
}

/**
 * @param {string} chatId
 * @returns {Promise<import('./types.js').SessionKeyRing|null>}
 */
export async function getSessionKeyRing(chatId) {
  try {
    const id = String(chatId ?? '').trim();
    if (!id) return null;
    return (await db.sessionKeys.get(id)) ?? null;
  } catch (err) {
    console.error('getSessionKeyRing failed', err);
    throw err;
  }
}

/**
 * @param {string} chatId
 */
export async function deleteSessionKeyRing(chatId) {
  try {
    const id = String(chatId ?? '').trim();
    if (!id) return;
    await db.sessionKeys.delete(id);
  } catch (err) {
    console.error('deleteSessionKeyRing failed', err);
    throw err;
  }
}

// ── Sent Plaintext (Phase 8) ────────────────────────────────────────────────

/**
 * Stores a plaintext copy of sent messages so the sender can always read what they sent,
 * even after session key rotation (forward secrecy). This data is local-only and never
 * transmitted to peers. It is deleted when the chat is deleted.
 *
 * @typedef {Object} SentMessagePlaintext
 * @property {string} id
 * @property {string} chatId
 * @property {string} plaintext
 * @property {number} timestamp
 */

/**
 * @param {{ id: string, chatId: string, plaintext: string, timestamp: number }} msg
 */
export async function saveSentMessagePlaintext(msg) {
  try {
    await db.sentMessagesPlaintext.put({
      id: msg.id,
      chatId: msg.chatId,
      plaintext: msg.plaintext,
      timestamp: msg.timestamp
    });
  } catch (err) {
    console.error('saveSentMessagePlaintext failed', err);
    throw err;
  }
}

/**
 * @param {string} chatId
 * @returns {Promise<SentMessagePlaintext[]>}
 */
export async function getSentMessagesPlaintext(chatId) {
  try {
    const key = String(chatId ?? '').trim();
    if (!key) return [];
    return await db.sentMessagesPlaintext.where('chatId').equals(key).sortBy('timestamp');
  } catch (err) {
    console.error('getSentMessagesPlaintext failed', err);
    throw err;
  }
}

/**
 * @param {string} chatId
 */
export async function deleteSentMessagesPlaintext(chatId) {
  try {
    const key = String(chatId ?? '').trim();
    if (!key) return;
    await db.sentMessagesPlaintext.where('chatId').equals(key).delete();
  } catch (err) {
    console.error('deleteSentMessagesPlaintext failed', err);
    throw err;
  }
}
