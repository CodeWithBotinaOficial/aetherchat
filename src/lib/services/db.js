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
 * @property {string} id
 * @property {string} peerId
 * @property {string} username
 * @property {number} age
 * @property {string} color
 * @property {string} text
 * @property {number} timestamp
 */

/**
 * @typedef {Object} PrivateChat
 * @property {string} id
 * @property {string} myPeerId
 * @property {string} theirPeerId
 * @property {string} theirUsername
 * @property {string} theirColor
 * @property {string|null} theirAvatarBase64
 * @property {string|null} [lastMessagePreview]
 * @property {number} [unreadCount]
 * @property {number} createdAt
 * @property {number} lastActivity
 */

/**
 * @typedef {Object} PrivateMessage
 * @property {string} id
 * @property {string} chatId
 * @property {'sent'|'received'} direction
 * @property {string} ciphertext
 * @property {string} iv
 * @property {number} timestamp
 * @property {boolean} delivered
 */

/**
 * @typedef {Object} KnownPeer
 * @property {number} [id]
 * @property {string} username
 * @property {string} peerId
 * @property {number} lastSeen
 */

/**
 * @typedef {Object} UsernameRegistryEntry
 * @property {number} [id]
 * @property {string} username
 * @property {string} peerId
 * @property {number} registeredAt
 * @property {number} lastSeenAt
 */

class AetherChatDB extends Dexie {
  /** @type {Dexie.Table<User, number>} */ users;
  /** @type {Dexie.Table<GlobalMessage, string>} */ globalMessages;
  /** @type {Dexie.Table<PrivateChat, string>} */ privateChats;
  /** @type {Dexie.Table<PrivateMessage, string>} */ privateMessages;
  /** @type {Dexie.Table<KnownPeer, number>} */ knownPeers;
  /** @type {Dexie.Table<UsernameRegistryEntry, number>} */ usernameRegistry;

  constructor() {
    super('AetherChatDB');

    this.version(1).stores({
      users: 'id, username, createdAt',
      globalMessages: '++id, timestamp, peerId, username',
      privateChats: '++id, lastActivity, peerUsername',
      privateMessages: '++id, chatId, timestamp, fromUsername',
      knownPeers: '++id, peerId, lastSeen, username'
    });

    this.version(2).stores({
      users: 'id, username, createdAt',
      globalMessages: '++id, timestamp, peerId, username',
      privateChats: '++id, lastActivity, peerUsername',
      privateMessages: '++id, chatId, timestamp, fromUsername',
      knownPeers: '++id, peerId, lastSeen, username',
      usernameRegistry: '++id, username, peerId, registeredAt, lastSeenAt'
    });

    // Phase 3: message IDs become UUIDs (primary key = `id`).
    // Dexie/IndexedDB does not support changing a table's primary key in-place, so we:
    // 1) delete the old message tables in v3 (cache tables, safe to drop)
    // 2) recreate them with UUID primary keys in v4
    this.version(3).stores({
      users: 'id, username, createdAt',
      globalMessages: null,
      privateChats: '++id, lastActivity, peerUsername',
      privateMessages: null,
      knownPeers: '++id, peerId, lastSeen, username',
      usernameRegistry: '++id, username, peerId, registeredAt, lastSeenAt'
    });

    this.version(4).stores({
      users: 'id, username, createdAt',
      globalMessages: 'id, timestamp, peerId, username',
      privateChats: '++id, lastActivity, peerUsername',
      privateMessages: 'id, chatId, timestamp, fromUsername',
      knownPeers: '++id, peerId, lastSeen, username',
      usernameRegistry: '++id, username, peerId, registeredAt, lastSeenAt'
    });

    // Phase 5: replace legacy private chat tables with E2EE private chat tables.
    // Dexie/IndexedDB cannot change primary keys in-place; private chats are per-user caches, safe to drop.
    this.version(5).stores({
      users: 'id, username, createdAt',
      globalMessages: 'id, timestamp, peerId, username',
      privateChats: null,
      privateMessages: null,
      knownPeers: '++id, peerId, lastSeen, username',
      usernameRegistry: '++id, username, peerId, registeredAt, lastSeenAt'
    });

    this.version(6).stores({
      users: 'id, username, createdAt',
      globalMessages: 'id, timestamp, peerId, username',
      privateChats: 'id, myPeerId, theirPeerId, theirUsername, createdAt, lastActivity',
      privateMessages: 'id, chatId, direction, ciphertext, iv, timestamp, delivered',
      knownPeers: '++id, peerId, lastSeen, username',
      usernameRegistry: '++id, username, peerId, registeredAt, lastSeenAt'
    });

    // Phase 6: persist private chat metadata (preview + unreadCount). Indexes unchanged.
    this.version(7)
      .stores({
        users: 'id, username, createdAt',
        globalMessages: 'id, timestamp, peerId, username',
        privateChats: 'id, myPeerId, theirPeerId, theirUsername, createdAt, lastActivity',
        privateMessages: 'id, chatId, direction, ciphertext, iv, timestamp, delivered',
        knownPeers: '++id, peerId, lastSeen, username',
        usernameRegistry: '++id, username, peerId, registeredAt, lastSeenAt'
      })
      .upgrade(async (tx) => {
        const table = tx.table('privateChats');
        await table.toCollection().modify((chat) => {
          if (typeof chat.unreadCount !== 'number') chat.unreadCount = 0;
          if (!Object.prototype.hasOwnProperty.call(chat, 'lastMessagePreview')) chat.lastMessagePreview = null;
        });
      });
  }
}

export const db = new AetherChatDB();

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;
const ONE_YEAR_MS = 365 * ONE_DAY_MS;

/**
 * Normalize usernames for uniqueness checks (case-insensitive, accent-insensitive).
 * @param {string} username
 * @returns {string}
 */
function normalizeUsername(username) {
  return String(username ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

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
    const id = msg.id || (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now()));
    await db.globalMessages.put({ ...msg, id });
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

// ── Private Chats (Phase 5) ─────────────────────────────────────────────────

/**
 * Upsert a private chat entry by id.
 * @param {PrivateChat} chat
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
 * @returns {Promise<PrivateChat[]>}
 */
export async function getPrivateChats(myPeerId) {
  try {
    const list = await db.privateChats.where('myPeerId').equals(myPeerId).toArray();
    return list.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
  } catch (err) {
    console.error('getPrivateChats failed', err);
    throw err;
  }
}

/**
 * @param {string} chatId
 * @returns {Promise<PrivateChat|null>}
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
    await db.transaction('rw', db.privateChats, db.privateMessages, async () => {
      await db.privateMessages.where('chatId').equals(chatId).delete();
      await db.privateChats.delete(chatId);
    });
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

// ── Private Messages (Phase 5) ───────────────────────────────────────────────

/**
 * Stores ciphertext + iv only. Plaintext MUST NOT be stored.
 * @param {PrivateMessage} msg
 */
export async function savePrivateMessage(msg) {
  try {
    if (!msg || typeof msg !== 'object') throw new Error('Missing message');
    if (typeof msg.id !== 'string' || msg.id.length === 0) throw new Error('Missing msg.id');
    if (typeof msg.chatId !== 'string' || msg.chatId.length === 0) throw new Error('Missing msg.chatId');
    if (typeof msg.ciphertext !== 'string' || msg.ciphertext.length === 0) throw new Error('Missing ciphertext');
    if (typeof msg.iv !== 'string' || msg.iv.length === 0) throw new Error('Missing iv');
    await db.privateMessages.put(msg);
  } catch (err) {
    console.error('savePrivateMessage failed', err);
    throw err;
  }
}

/**
 * @param {string} chatId
 * @param {number} [limit=100]
 * @returns {Promise<PrivateMessage[]>}
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
 * @returns {Promise<PrivateMessage[]>}
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

/**
 * Deletes chats where lastActivity is older than 30 days, cascading to messages.
 * @returns {Promise<number>} count of chats deleted
 */
export async function cleanOldPrivateChats() {
  try {
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    return await db.transaction('rw', db.privateChats, db.privateMessages, async () => {
      const oldChatIds = await db.privateChats.where('lastActivity').below(cutoff).primaryKeys();
      if (oldChatIds.length === 0) return 0;
      await db.privateMessages.where('chatId').anyOf(oldChatIds).delete();
      await db.privateChats.bulkDelete(oldChatIds);
      return oldChatIds.length;
    });
  } catch (err) {
    console.error('cleanOldPrivateChats failed', err);
    throw err;
  }
}

// Back-compat alias (Phase 1/3 name).
export async function cleanOldPrivateMessages() {
  return await cleanOldPrivateChats();
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

/**
 * Upsert a username registry entry by normalized username.
 * @param {UsernameRegistryEntry} entry
 */
export async function registerUsernameLocally(entry) {
  try {
    const norm = normalizeUsername(entry.username);
    if (!norm) return;

    await db.transaction('rw', db.usernameRegistry, async () => {
      const existing = await db.usernameRegistry.where('username').equals(norm).first();
      const record = {
        username: norm,
        peerId: entry.peerId,
        registeredAt: entry.registeredAt,
        lastSeenAt: entry.lastSeenAt
      };
      if (existing) {
        await db.usernameRegistry.put({ ...existing, ...record, id: existing.id });
      } else {
        await db.usernameRegistry.add(record);
      }
    });
  } catch (err) {
    console.error('registerUsernameLocally failed', err);
    throw err;
  }
}

/**
 * @param {string} username
 * @returns {Promise<boolean>}
 */
export async function isUsernameTaken(username) {
  try {
    const norm = normalizeUsername(username);
    if (!norm) return false;
    const existing = await db.usernameRegistry.where('username').equals(norm).first();
    return Boolean(existing);
  } catch (err) {
    console.error('isUsernameTaken failed', err);
    throw err;
  }
}

/**
 * @returns {Promise<UsernameRegistryEntry[]>}
 */
export async function getFullUsernameRegistry() {
  try {
    return await db.usernameRegistry.orderBy('registeredAt').toArray();
  } catch (err) {
    console.error('getFullUsernameRegistry failed', err);
    throw err;
  }
}

/**
 * Merge remote registry entries with local registry.
 * Earlier registration always wins; lastSeenAt is merged as max().
 * @param {UsernameRegistryEntry[]} remoteEntries
 */
export async function mergeUsernameRegistry(remoteEntries) {
  try {
    const list = Array.isArray(remoteEntries) ? remoteEntries : [];
    if (list.length === 0) return;

    await db.transaction('rw', db.usernameRegistry, async () => {
      for (const entry of list) {
        const norm = normalizeUsername(entry?.username);
        if (!norm) continue;

        const remote = {
          username: norm,
          peerId: entry.peerId,
          registeredAt: entry.registeredAt,
          lastSeenAt: entry.lastSeenAt
        };

        const local = await db.usernameRegistry.where('username').equals(norm).first();
        if (!local) {
          await db.usernameRegistry.add(remote);
          continue;
        }

        const localWins = (local.registeredAt ?? Number.POSITIVE_INFINITY) <= (remote.registeredAt ?? Number.POSITIVE_INFINITY);
        if (localWins) {
          await db.usernameRegistry.put({
            ...local,
            lastSeenAt: Math.max(local.lastSeenAt ?? 0, remote.lastSeenAt ?? 0),
            id: local.id
          });
        } else {
          await db.usernameRegistry.put({
            ...local,
            ...remote,
            lastSeenAt: Math.max(local.lastSeenAt ?? 0, remote.lastSeenAt ?? 0),
            id: local.id
          });
        }
      }
    });
  } catch (err) {
    console.error('mergeUsernameRegistry failed', err);
    throw err;
  }
}

/**
 * Remove username registry entries that haven't been seen in over 1 year.
 * @returns {Promise<number>}
 */
export async function pruneStaleRegistryEntries() {
  try {
    const cutoff = Date.now() - ONE_YEAR_MS;
    return await db.usernameRegistry.where('lastSeenAt').below(cutoff).delete();
  } catch (err) {
    console.error('pruneStaleRegistryEntries failed', err);
    throw err;
  }
}

export const __test = { normalizeUsername };
