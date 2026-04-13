import { db } from './schema.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {import('./types.js').GlobalMessage} msg
 */
export async function saveGlobalMessage(msg) {
  try {
    const id = msg.id || (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now()));
    await db.globalMessages.put({
      editedAt: Object.prototype.hasOwnProperty.call(msg, 'editedAt') ? (msg.editedAt ?? null) : null,
      deleted: Object.prototype.hasOwnProperty.call(msg, 'deleted') ? Boolean(msg.deleted) : false,
      ...msg,
      id,
      replies: Array.isArray(msg?.replies) && msg.replies.length > 0 ? msg.replies : null
    });
  } catch (err) {
    console.error('saveGlobalMessage failed', err);
    throw err;
  }
}

/**
 * @param {string} id
 * @returns {Promise<import('./types.js').GlobalMessage|null>}
 */
export async function getGlobalMessage(id) {
  try {
    const key = String(id ?? '').trim();
    if (!key) return null;
    return (await db.globalMessages.get(key)) ?? null;
  } catch (err) {
    console.error('getGlobalMessage failed', err);
    throw err;
  }
}

/**
 * @param {string} id
 * @param {Partial<import('./types.js').GlobalMessage>} patch
 * @returns {Promise<number>} number of modified rows
 */
export async function updateGlobalMessage(id, patch) {
  try {
    const key = String(id ?? '').trim();
    if (!key) return 0;
    if (!patch || typeof patch !== 'object') return 0;
    return await db.globalMessages.update(key, patch);
  } catch (err) {
    console.error('updateGlobalMessage failed', err);
    throw err;
  }
}

/**
 * Get global messages in ascending timestamp order.
 * @param {number} [limit=100]
 * @returns {Promise<import('./types.js').GlobalMessage[]>}
 */
export async function getGlobalMessages(limit = 100) {
  try {
    const latestFirst = await db.globalMessages.orderBy('timestamp').reverse().limit(limit).toArray();
    return latestFirst.reverse();
  } catch (err) {
    console.error('getGlobalMessages failed', err);
    throw err;
  }
}

/**
 * Page older global messages before a timestamp, in ascending timestamp order.
 * @param {number} beforeTimestamp
 * @param {number} [limit=50]
 * @returns {Promise<import('./types.js').GlobalMessage[]>}
 */
export async function getGlobalMessagesPage(beforeTimestamp, limit = 50) {
  try {
    const before = Number(beforeTimestamp);
    const n = Number(limit);
    const cap = Number.isFinite(n) ? Math.max(1, Math.min(200, n)) : 50;
    if (!Number.isFinite(before)) return [];

    const latestFirst = await db.globalMessages.where('timestamp').below(before).reverse().limit(cap).toArray();
    return latestFirst.reverse();
  } catch (err) {
    console.error('getGlobalMessagesPage failed', err);
    throw err;
  }
}

/**
 * Delete global messages older than 24h.
 * @returns {Promise<number>} count deleted
 */
export async function cleanOldGlobalMessages() {
  try {
    const cutoff = Date.now() - ONE_DAY_MS;
    return await db.globalMessages.where('timestamp').below(cutoff).delete();
  } catch (err) {
    console.error('cleanOldGlobalMessages failed', err);
    throw err;
  }
}
