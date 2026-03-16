import Dexie from 'dexie';

/**
 * @typedef {Object} User
 * @property {number} [id]
 * @property {string} username
 * @property {number} age
 * @property {string} color
 * @property {string} avatarBase64
 * @property {number} createdAt
 */

/**
 * @typedef {Object} GlobalMessage
 * @property {number} [id]
 * @property {string} peerId
 * @property {string} username
 * @property {number} age
 * @property {string} color
 * @property {string} text
 * @property {number} timestamp
 */

/**
 * @typedef {Object} PrivateChat
 * @property {number} [id]
 * @property {string} peerUsername
 * @property {string} lastMessage
 * @property {number} lastActivity
 * @property {number} unreadCount
 */

/**
 * @typedef {Object} PrivateMessage
 * @property {number} [id]
 * @property {number} chatId
 * @property {string} fromUsername
 * @property {string} text
 * @property {number} timestamp
 * @property {boolean} encrypted
 */

/**
 * @typedef {Object} KnownPeer
 * @property {number} [id]
 * @property {string} username
 * @property {string} peerId
 * @property {number} lastSeen
 */

class AetherChatDB extends Dexie {
  /** @type {Dexie.Table<User, number>} */ users;
  /** @type {Dexie.Table<GlobalMessage, number>} */ globalMessages;
  /** @type {Dexie.Table<PrivateChat, number>} */ privateChats;
  /** @type {Dexie.Table<PrivateMessage, number>} */ privateMessages;
  /** @type {Dexie.Table<KnownPeer, number>} */ knownPeers;

  constructor() {
    super('AetherChatDB');

    this.version(1).stores({
      users: 'id, username, createdAt',
      globalMessages: '++id, timestamp, peerId, username',
      privateChats: '++id, lastActivity, peerUsername',
      privateMessages: '++id, chatId, timestamp, fromUsername',
      knownPeers: '++id, peerId, lastSeen, username'
    });
  }
}

export const db = new AetherChatDB();

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;

/**
 * Save the local user (there is only ever one local user).
 * @param {User} user
 */
export async function saveUser(user) {
  try {
    const record = { ...user, id: 1 };
    await db.users.put(record);
  } catch (err) {
    console.error('saveUser failed', err);
    throw err;
  }
}

/**
 * Get the local user (or null).
 * @returns {Promise<User|null>}
 */
export async function getUser() {
  try {
    return (await db.users.get(1)) ?? null;
  } catch (err) {
    console.error('getUser failed', err);
    throw err;
  }
}

/**
 * @param {GlobalMessage} msg
 */
export async function saveGlobalMessage(msg) {
  try {
    await db.globalMessages.add({ ...msg });
  } catch (err) {
    console.error('saveGlobalMessage failed', err);
    throw err;
  }
}

/**
 * Get global messages in ascending timestamp order.
 * @param {number} [limit=100]
 * @returns {Promise<GlobalMessage[]>}
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

/**
 * @param {PrivateMessage} msg
 */
export async function savePrivateMessage(msg) {
  try {
    await db.transaction('rw', db.privateMessages, db.privateChats, async () => {
      await db.privateMessages.add({ ...msg });

      // Best-effort metadata update if the chat exists.
      const chat = await db.privateChats.get(msg.chatId);
      if (chat) {
        await db.privateChats.put({
          ...chat,
          lastActivity: msg.timestamp,
          lastMessage: msg.text
        });
      }
    });
  } catch (err) {
    console.error('savePrivateMessage failed', err);
    throw err;
  }
}

/**
 * @param {number} chatId
 * @returns {Promise<PrivateMessage[]>}
 */
export async function getPrivateMessages(chatId) {
  try {
    return await db.privateMessages.where('chatId').equals(chatId).sortBy('timestamp');
  } catch (err) {
    console.error('getPrivateMessages failed', err);
    throw err;
  }
}

/**
 * Delete private chats with no activity for 30 days, and their messages.
 * @returns {Promise<number>} count of chats deleted
 */
export async function cleanOldPrivateMessages() {
  try {
    const cutoff = Date.now() - THIRTY_DAYS_MS;

    return await db.transaction('rw', db.privateChats, db.privateMessages, async () => {
      const oldChatIds = await db.privateChats.where('lastActivity').below(cutoff).primaryKeys();
      if (oldChatIds.length === 0) return 0;

      // Delete messages for those chats.
      await db.privateMessages.where('chatId').anyOf(oldChatIds).delete();
      await db.privateChats.bulkDelete(oldChatIds);
      return oldChatIds.length;
    });
  } catch (err) {
    console.error('cleanOldPrivateMessages failed', err);
    throw err;
  }
}

/**
 * @param {KnownPeer} peer
 */
export async function saveKnownPeer(peer) {
  try {
    await db.transaction('rw', db.knownPeers, async () => {
      const existing = await db.knownPeers.where('peerId').equals(peer.peerId).first();
      if (existing) {
        await db.knownPeers.put({ ...existing, ...peer, id: existing.id });
        return;
      }
      await db.knownPeers.add({ ...peer });
    });
  } catch (err) {
    console.error('saveKnownPeer failed', err);
    throw err;
  }
}

/**
 * @returns {Promise<KnownPeer[]>}
 */
export async function getKnownPeers() {
  try {
    return await db.knownPeers.orderBy('lastSeen').reverse().toArray();
  } catch (err) {
    console.error('getKnownPeers failed', err);
    throw err;
  }
}

