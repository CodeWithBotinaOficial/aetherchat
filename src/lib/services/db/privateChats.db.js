import { db } from './schema.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;

// ── Private Chats (Phase 5) ─────────────────────────────────────────────────

/**
 * Upsert a private chat entry by id.
 * @param {import('./types.js').PrivateChat} chat
 */
export async function upsertPrivateChat(chat) {
  try {
    if (!chat || typeof chat !== 'object') throw new Error('Missing chat');
    if (typeof chat.id !== 'string' || chat.id.length === 0) throw new Error('Missing chat.id');
    await db.privateChats.put(chat);
  } catch (err) {
    console.error('upsertPrivateChat failed', err);
    throw err;
  }
}

/**
 * @param {string} myPeerId
 * @returns {Promise<import('./types.js').PrivateChat[]>}
 */
export async function getPrivateChats(myPeerId) {
  try {
    const key = String(myPeerId ?? '').trim();
    if (!key) {
      const all = await db.privateChats.toArray();
      return all.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
    }
    const list = await db.privateChats.where('myPeerId').equals(key).toArray();
    if (list.length > 0) return list.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));

    // Fallback for legacy chats created before stable peerIds existed.
    const all = await db.privateChats.toArray();
    return all.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
  } catch (err) {
    console.error('getPrivateChats failed', err);
    throw err;
  }
}

/**
 * @param {string} chatId
 * @returns {Promise<import('./types.js').PrivateChat|null>}
 */
export async function getPrivateChat(chatId) {
  try {
    return (await db.privateChats.get(chatId)) ?? null;
  } catch (err) {
    console.error('getPrivateChat failed', err);
    throw err;
  }
}

/**
 * Deletes the chat AND all its messages atomically.
 * @param {string} chatId
 */
export async function deletePrivateChat(chatId) {
  try {
    await db.transaction(
      'rw',
      db.privateChats,
      db.privateMessages,
      db.sentMessagesPlaintext,
      db.sessionKeys,
      db.queuedMessages,
      async () => {
        await db.privateMessages.where('chatId').equals(chatId).delete();
        await db.sentMessagesPlaintext.where('chatId').equals(chatId).delete();
        await db.queuedMessages.where('chatId').equals(chatId).delete();
        await db.sessionKeys.delete(chatId);
        await db.privateChats.delete(chatId);
      }
    );
  } catch (err) {
    console.error('deletePrivateChat failed', err);
    throw err;
  }
}

/**
 * @param {string} chatId
 * @param {number} timestamp
 */
export async function updateChatLastActivity(chatId, timestamp) {
  try {
    await db.privateChats.update(chatId, { lastActivity: timestamp });
  } catch (err) {
    console.error('updateChatLastActivity failed', err);
    throw err;
  }
}

/**
 * Update private chat metadata fields.
 * @param {string} chatId
 * @param {{ lastMessagePreview?: string|null, unreadCount?: number, lastActivity?: number }} meta
 */
export async function updateChatMeta(chatId, meta) {
  try {
    const patch = {};
    if (Object.prototype.hasOwnProperty.call(meta, 'lastMessagePreview')) patch.lastMessagePreview = meta.lastMessagePreview;
    if (Object.prototype.hasOwnProperty.call(meta, 'unreadCount')) patch.unreadCount = meta.unreadCount;
    if (Object.prototype.hasOwnProperty.call(meta, 'lastActivity')) patch.lastActivity = meta.lastActivity;
    await db.privateChats.update(chatId, patch);
  } catch (err) {
    console.error('updateChatMeta failed', err);
    throw err;
  }
}

/**
 * Deletes chats where lastActivity is older than 30 days, cascading to messages.
 * @returns {Promise<number>} count of chats deleted
 */
export async function cleanOldPrivateChats() {
  try {
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    return await db.transaction(
      'rw',
      db.privateChats,
      db.privateMessages,
      db.sentMessagesPlaintext,
      db.queuedMessages,
      db.sessionKeys,
      async () => {
        const oldChatIds = await db.privateChats.where('lastActivity').below(cutoff).primaryKeys();
        if (oldChatIds.length === 0) return 0;
        await db.privateMessages.where('chatId').anyOf(oldChatIds).delete();
        await db.sentMessagesPlaintext.where('chatId').anyOf(oldChatIds).delete();
        await db.queuedMessages.where('chatId').anyOf(oldChatIds).delete();
        await db.sessionKeys.where('id').anyOf(oldChatIds).delete();
        await db.privateChats.bulkDelete(oldChatIds);
        return oldChatIds.length;
      }
    );
  } catch (err) {
    console.error('cleanOldPrivateChats failed', err);
    throw err;
  }
}

// Back-compat alias (Phase 1/3 name).
export async function cleanOldPrivateMessages() {
  return await cleanOldPrivateChats();
}
