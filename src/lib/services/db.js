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
 * @property {{ messageId: string, authorUsername: string, authorColor: string, textSnapshot: string, timestamp: number, deleted?: boolean }[] | null} [replies]
 * @property {number} timestamp
 * @property {number|null} [editedAt]
 * @property {boolean} [deleted]
 */

/**
 * @typedef {Object} PrivateChat
 * @property {string} id
 * @property {string} myPeerId
 * @property {string} [myUsername]
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
 * @property {{ ciphertext: string, iv: string } | null} [replies] Encrypted replies bundle (never plaintext).
 * @property {number} timestamp
 * @property {boolean} delivered
 * @property {number|null} [editedAt]
 * @property {boolean} [deleted]
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

/**
 * Stable peer ID storage (per username, per browser).
 * @typedef {Object} PeerIdEntry
 * @property {string} username
 * @property {string} peerId
 */

/**
 * Local-only queued private messages (plaintext, temporary).
 * @typedef {Object} QueuedMessage
 * @property {string} id
 * @property {string} chatId
 * @property {string} theirPeerId
 * @property {string} plaintext
 * @property {string|null} [repliesJson] Plaintext JSON string for replies (local-only, temporary).
 * @property {number} timestamp
 */

/**
 * Local-only queued private edit/delete actions (plaintext, temporary).
 * This is used when the peer is offline or we don't have a confirmed session yet.
 * @typedef {Object} QueuedAction
 * @property {string} id
 * @property {string} chatId
 * @property {string} theirPeerId
 * @property {'edit'|'delete'} kind
 * @property {string} messageId
 * @property {string|null} [plaintext]
 * @property {string|null} [repliesJson]
 * @property {number|null} [editedAt]
 * @property {number} timestamp
 */

/**
 * Persisted private chat session key ring (local-only).
 * Keys are stored so received messages remain decryptable across browser restarts and re-keys.
 * @typedef {Object} SessionKeyRing
 * @property {string} id
 * @property {{ keyBase64: string, createdAt: number }[]} keys
 * @property {number} updatedAt
 */

export class AetherChatDB extends Dexie {
  /** @type {Dexie.Table<User, number>} */ users;
  /** @type {Dexie.Table<GlobalMessage, string>} */ globalMessages;
  /** @type {Dexie.Table<PrivateChat, string>} */ privateChats;
  /** @type {Dexie.Table<PrivateMessage, string>} */ privateMessages;
  /** @type {Dexie.Table<KnownPeer, number>} */ knownPeers;
  /** @type {Dexie.Table<UsernameRegistryEntry, number>} */ usernameRegistry;
  /** @type {Dexie.Table<PeerIdEntry, string>} */ peerIds;
  /** @type {Dexie.Table<QueuedMessage, string>} */ queuedMessages;
  /** @type {Dexie.Table<QueuedAction, string>} */ queuedActions;
  /** @type {Dexie.Table<{ id: string, chatId: string, timestamp: number, plaintext: string }, string>} */ sentMessagesPlaintext;
  /** @type {Dexie.Table<SessionKeyRing, string>} */ sessionKeys;

  /**
   * @param {string} [name='AetherChatDB']
   */
  constructor(name = 'AetherChatDB') {
    super(name);

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

		    // Phase 7: stable peer IDs + persisted offline queue for private messages.
		    this.version(8).stores({
		      users: 'id, username, createdAt',
		      globalMessages: 'id, timestamp, peerId, username',
		      privateChats: 'id, myPeerId, theirPeerId, theirUsername, createdAt, lastActivity',
		      privateMessages: 'id, chatId, direction, ciphertext, iv, timestamp, delivered',
		      knownPeers: '++id, peerId, lastSeen, username',
		      usernameRegistry: '++id, username, peerId, registeredAt, lastSeenAt',
		      peerIds: 'username, peerId',
		      queuedMessages: 'id, chatId, theirPeerId, timestamp'
		    });

			    // Phase 8: keep a local plaintext copy of SENT private messages for sender readability
			    // across session key rotation (forward secrecy).
			    this.version(9).stores({
			      users: 'id, username, createdAt',
			      globalMessages: 'id, timestamp, peerId, username',
			      privateChats: 'id, myPeerId, theirPeerId, theirUsername, createdAt, lastActivity',
			      privateMessages: 'id, chatId, direction, ciphertext, iv, timestamp, delivered',
			      knownPeers: '++id, peerId, lastSeen, username',
			      usernameRegistry: '++id, username, peerId, registeredAt, lastSeenAt',
			      peerIds: 'username, peerId',
			      queuedMessages: 'id, chatId, theirPeerId, timestamp',
			      sentMessagesPlaintext: 'id, chatId, timestamp'
			    });

			    // Phase 9: persist private chat session keys (local-only) so received messages
			    // stay decryptable across browser restarts and session re-keys.
				    this.version(10).stores({
				      users: 'id, username, createdAt',
				      globalMessages: 'id, timestamp, peerId, username',
				      privateChats: 'id, myPeerId, theirPeerId, theirUsername, createdAt, lastActivity',
				      privateMessages: 'id, chatId, direction, ciphertext, iv, timestamp, delivered',
				      knownPeers: '++id, peerId, lastSeen, username',
				      usernameRegistry: '++id, username, peerId, registeredAt, lastSeenAt',
				      peerIds: 'username, peerId',
				      queuedMessages: 'id, chatId, theirPeerId, timestamp',
				      sentMessagesPlaintext: 'id, chatId, timestamp',
				      sessionKeys: 'id, updatedAt'
				    });

				    // Phase 10: private chat IDs are username-based (not PeerJS ID based).
				    // PeerJS IDs are transient across refreshes; chat history must not depend on them.
				    this.version(11)
				      .stores({
				        users: 'id, username, createdAt',
				        globalMessages: 'id, timestamp, peerId, username',
				        privateChats: 'id, myPeerId, myUsername, theirPeerId, theirUsername, createdAt, lastActivity',
				        privateMessages: 'id, chatId, direction, ciphertext, iv, timestamp, delivered',
				        knownPeers: '++id, peerId, lastSeen, username',
				        usernameRegistry: '++id, username, peerId, registeredAt, lastSeenAt',
				        peerIds: 'username, peerId',
				        queuedMessages: 'id, chatId, theirPeerId, timestamp',
				        sentMessagesPlaintext: 'id, chatId, timestamp',
				        sessionKeys: 'id, updatedAt'
				      })
				      .upgrade(async (tx) => {
				        // Do not assume the user row has primary key = 1. Some browsers/older builds
				        // may store it under a different key.
				        const users = await tx.table('users').toArray();
				        const user =
				          users.find((u) => typeof u?.username === 'string' && u.username.trim().length > 0) ??
				          users[0] ??
				          null;
				        const myUsername = user?.username;
				        if (typeof myUsername !== 'string' || myUsername.trim().length === 0) return;

				        const chatsTable = tx.table('privateChats');
				        const messagesTable = tx.table('privateMessages');
				        const sentPlainTable = tx.table('sentMessagesPlaintext');
				        const queuedTable = tx.table('queuedMessages');
				        const keysTable = tx.table('sessionKeys');

				        const chats = await chatsTable.toArray();
				        for (const chat of chats) {
				          const theirUsername = chat?.theirUsername;
				          if (typeof theirUsername !== 'string' || theirUsername.trim().length === 0) continue;

				          const newId = [myUsername, theirUsername].sort().join(':');

				          // Backfill myUsername even when ID is already stable.
				          if (chat.id === newId) {
				            await chatsTable.put({ ...chat, myUsername, id: newId });
				            continue;
				          }

				          const existingNew = await chatsTable.get(newId);
				          if (existingNew) {
				            await chatsTable.put({
				              ...existingNew,
				              myPeerId: chat.myPeerId ?? existingNew.myPeerId,
				              myUsername,
				              theirPeerId: chat.theirPeerId ?? existingNew.theirPeerId,
				              theirUsername: theirUsername ?? existingNew.theirUsername,
				              theirColor: chat.theirColor ?? existingNew.theirColor,
				              theirAvatarBase64: chat.theirAvatarBase64 ?? existingNew.theirAvatarBase64 ?? null,
				              theirAge: chat.theirAge ?? existingNew.theirAge,
				              createdAt: Math.min(existingNew.createdAt ?? Date.now(), chat.createdAt ?? Date.now()),
				              lastActivity: Math.max(existingNew.lastActivity ?? 0, chat.lastActivity ?? 0),
				              lastMessagePreview: existingNew.lastMessagePreview ?? chat.lastMessagePreview ?? null,
				              unreadCount:
				                typeof existingNew.unreadCount === 'number'
				                  ? existingNew.unreadCount
				                  : typeof chat.unreadCount === 'number'
				                    ? chat.unreadCount
				                    : 0,
				              id: newId
				            });
				          } else {
				            await chatsTable.put({ ...chat, id: newId, myUsername });
				          }

				          await messagesTable.where('chatId').equals(chat.id).modify({ chatId: newId });
				          await sentPlainTable.where('chatId').equals(chat.id).modify({ chatId: newId });
				          await queuedTable.where('chatId').equals(chat.id).modify({ chatId: newId });

				          const ring = await keysTable.get(chat.id);
				          if (ring) {
				            await keysTable.put({ ...ring, id: newId });
				            await keysTable.delete(chat.id);
				          }

				          await chatsTable.delete(chat.id);
				        }
				      });

				    // Phase 11: add `replies` field to message tables (global + private).
				    // - Global: replies are stored in plaintext (public chat).
				    // - Private: replies are stored encrypted in the `privateMessages.replies` bundle.
					    this.version(12)
					      .stores({
					        users: 'id, username, createdAt',
					        globalMessages: 'id, timestamp, peerId, username',
					        privateChats: 'id, myPeerId, myUsername, theirPeerId, theirUsername, createdAt, lastActivity',
					        privateMessages: 'id, chatId, direction, ciphertext, iv, timestamp, delivered',
					        knownPeers: '++id, peerId, lastSeen, username',
					        usernameRegistry: '++id, username, peerId, registeredAt, lastSeenAt',
					        peerIds: 'username, peerId',
					        queuedMessages: 'id, chatId, theirPeerId, timestamp',
					        sentMessagesPlaintext: 'id, chatId, timestamp',
					        sessionKeys: 'id, updatedAt'
					      })
					      .upgrade(async (tx) => {
					        const globals = tx.table('globalMessages');
					        const privates = tx.table('privateMessages');
					        await globals.toCollection().modify((m) => {
					          if (!Object.prototype.hasOwnProperty.call(m, 'replies')) m.replies = null;
					        });
					        await privates.toCollection().modify((m) => {
					          if (!Object.prototype.hasOwnProperty.call(m, 'replies')) m.replies = null;
					        });
					      });

					    // Phase 12: message edit/delete metadata + offline queue for private edit/delete actions.
					    this.version(13)
					      .stores({
					        users: 'id, username, createdAt',
					        globalMessages: 'id, timestamp, peerId, username',
					        privateChats: 'id, myPeerId, myUsername, theirPeerId, theirUsername, createdAt, lastActivity',
					        privateMessages: 'id, chatId, direction, ciphertext, iv, timestamp, delivered',
					        knownPeers: '++id, peerId, lastSeen, username',
					        usernameRegistry: '++id, username, peerId, registeredAt, lastSeenAt',
					        peerIds: 'username, peerId',
					        queuedMessages: 'id, chatId, theirPeerId, timestamp',
					        queuedActions: 'id, chatId, theirPeerId, timestamp, kind',
					        sentMessagesPlaintext: 'id, chatId, timestamp',
					        sessionKeys: 'id, updatedAt'
					      })
					      .upgrade(async (tx) => {
					        const globals = tx.table('globalMessages');
					        const privates = tx.table('privateMessages');
					        await globals.toCollection().modify((m) => {
					          if (!Object.prototype.hasOwnProperty.call(m, 'editedAt')) m.editedAt = null;
					          if (!Object.prototype.hasOwnProperty.call(m, 'deleted')) m.deleted = false;
					          if (Array.isArray(m.replies)) {
					            for (const r of m.replies) {
					              if (r && typeof r === 'object' && !Object.prototype.hasOwnProperty.call(r, 'deleted')) r.deleted = false;
					            }
					          }
					        });
					        await privates.toCollection().modify((m) => {
					          if (!Object.prototype.hasOwnProperty.call(m, 'editedAt')) m.editedAt = null;
					          if (!Object.prototype.hasOwnProperty.call(m, 'deleted')) m.deleted = false;
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
 * @returns {Promise<GlobalMessage|null>}
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
 * @param {Partial<GlobalMessage>} patch
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
 * Page older global messages before a timestamp, in ascending timestamp order.
 * @param {number} beforeTimestamp
 * @param {number} [limit=50]
 * @returns {Promise<GlobalMessage[]>}
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
 * Get a stable (persisted) peerId for this username, or null if none exists yet.
 * @param {string} username
 * @returns {Promise<string|null>}
 */
export async function getStoredPeerId(username) {
  try {
    const key = String(username ?? '').trim();
    if (!key) return null;
    const entry = await db.peerIds.get(key);
    return entry?.peerId ?? null;
  } catch {
    return null;
  }
}

// ── Offline Queue (Phase 7) ─────────────────────────────────────────────────
//
// Security note:
// queuedMessages stores PLAINTEXT temporarily on the local device only.
// This is intentional: we cannot encrypt private messages without an active
// E2EE session key, and we cannot establish a session while offline.
// These records are deleted as soon as they are encrypted and sent.

/**
 * @param {{ id: string, chatId: string, theirPeerId: string, plaintext: string, repliesJson?: string|null, timestamp: number }} msg
 */
export async function saveQueuedMessage(msg) {
  try {
    if (!msg?.id) throw new Error('Missing queued message id');
    await db.queuedMessages.put({
      id: msg.id,
      chatId: msg.chatId,
      theirPeerId: msg.theirPeerId,
      plaintext: msg.plaintext,
      repliesJson: Object.prototype.hasOwnProperty.call(msg, 'repliesJson') ? (msg.repliesJson ?? null) : null,
      timestamp: msg.timestamp
    });
  } catch (err) {
    console.error('saveQueuedMessage failed', err);
    throw err;
  }
}

/**
 * @param {string} theirPeerId
 * @returns {Promise<QueuedMessage[]>}
 */
export async function getQueuedMessagesForPeer(theirPeerId) {
  try {
    const key = String(theirPeerId ?? '').trim();
    if (!key) return [];
    const rows = await db.queuedMessages.where('theirPeerId').equals(key).toArray();
    return rows.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  } catch (err) {
    console.error('getQueuedMessagesForPeer failed', err);
    throw err;
  }
}

/**
 * Preferred: queued messages are associated with a private chatId, not a transient PeerJS ID.
 * @param {string} chatId
 * @returns {Promise<QueuedMessage[]>}
 */
export async function getQueuedMessagesForChat(chatId) {
  try {
    const key = String(chatId ?? '').trim();
    if (!key) return [];
    const rows = await db.queuedMessages.where('chatId').equals(key).toArray();
    return rows.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  } catch (err) {
    console.error('getQueuedMessagesForChat failed', err);
    throw err;
  }
}

/**
 * @param {string} id
 */
export async function deleteQueuedMessage(id) {
  try {
    const key = String(id ?? '').trim();
    if (!key) return;
    await db.queuedMessages.delete(key);
  } catch (err) {
    console.error('deleteQueuedMessage failed', err);
    throw err;
  }
}

/**
 * @param {string} theirPeerId
 */
export async function clearQueuedMessagesForPeer(theirPeerId) {
  try {
    const key = String(theirPeerId ?? '').trim();
    if (!key) return;
    await db.queuedMessages.where('theirPeerId').equals(key).delete();
  } catch (err) {
    console.error('clearQueuedMessagesForPeer failed', err);
    throw err;
  }
}

/**
 * @param {string} chatId
 */
export async function clearQueuedMessagesForChat(chatId) {
  try {
    const key = String(chatId ?? '').trim();
    if (!key) return;
    await db.queuedMessages.where('chatId').equals(key).delete();
  } catch (err) {
    console.error('clearQueuedMessagesForChat failed', err);
    throw err;
  }
}

// ── Offline Queue (Edit/Delete actions) ──────────────────────────────────────

/**
 * @param {QueuedAction} action
 */
export async function saveQueuedAction(action) {
  try {
    if (!action?.id) throw new Error('Missing queued action id');
    await db.queuedActions.put({
      id: action.id,
      chatId: action.chatId,
      theirPeerId: action.theirPeerId,
      kind: action.kind,
      messageId: action.messageId,
      plaintext: Object.prototype.hasOwnProperty.call(action, 'plaintext') ? (action.plaintext ?? null) : null,
      repliesJson: Object.prototype.hasOwnProperty.call(action, 'repliesJson') ? (action.repliesJson ?? null) : null,
      editedAt: Object.prototype.hasOwnProperty.call(action, 'editedAt') ? (action.editedAt ?? null) : null,
      timestamp: action.timestamp
    });
  } catch (err) {
    console.error('saveQueuedAction failed', err);
    throw err;
  }
}

/**
 * @param {string} chatId
 * @returns {Promise<QueuedAction[]>}
 */
export async function getQueuedActionsForChat(chatId) {
  try {
    const key = String(chatId ?? '').trim();
    if (!key) return [];
    const rows = await db.queuedActions.where('chatId').equals(key).toArray();
    return rows.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  } catch (err) {
    console.error('getQueuedActionsForChat failed', err);
    throw err;
  }
}

/**
 * @param {string} id
 */
export async function deleteQueuedAction(id) {
  try {
    const key = String(id ?? '').trim();
    if (!key) return;
    await db.queuedActions.delete(key);
  } catch (err) {
    console.error('deleteQueuedAction failed', err);
    throw err;
  }
}

/**
 * @param {string} chatId
 */
export async function clearQueuedActionsForChat(chatId) {
  try {
    const key = String(chatId ?? '').trim();
    if (!key) return;
    await db.queuedActions.where('chatId').equals(key).delete();
  } catch (err) {
    console.error('clearQueuedActionsForChat failed', err);
    throw err;
  }
}

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
    await db.transaction('rw', db.privateChats, db.privateMessages, db.sentMessagesPlaintext, db.sessionKeys, db.queuedMessages, async () => {
      await db.privateMessages.where('chatId').equals(chatId).delete();
      await db.sentMessagesPlaintext.where('chatId').equals(chatId).delete();
      await db.queuedMessages.where('chatId').equals(chatId).delete();
      await db.sessionKeys.delete(chatId);
      await db.privateChats.delete(chatId);
    });
  } catch (err) {
    console.error('deletePrivateChat failed', err);
    throw err;
  }
}

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
 * @returns {Promise<SessionKeyRing|null>}
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
 * @param {Partial<PrivateMessage>} patch
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
    return await db.transaction('rw', db.privateChats, db.privateMessages, db.sentMessagesPlaintext, db.queuedMessages, db.sessionKeys, async () => {
      const oldChatIds = await db.privateChats.where('lastActivity').below(cutoff).primaryKeys();
      if (oldChatIds.length === 0) return 0;
      await db.privateMessages.where('chatId').anyOf(oldChatIds).delete();
      await db.sentMessagesPlaintext.where('chatId').anyOf(oldChatIds).delete();
      await db.queuedMessages.where('chatId').anyOf(oldChatIds).delete();
      await db.sessionKeys.where('id').anyOf(oldChatIds).delete();
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
      // PeerJS IDs are ephemeral; de-duplicate by username so reconnection can update peerId.
      const uname = String(peer?.username ?? '').trim();
      const existing = uname ? await db.knownPeers.where('username').equals(uname).first() : null;
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
	          const remoteIsNewer = (remote.lastSeenAt ?? 0) >= (local.lastSeenAt ?? 0);
	          await db.usernameRegistry.put({
	            ...local,
	            // Registration ownership stays with the earliest registrant, but contact peerId can change.
	            peerId: remoteIsNewer && remote.peerId ? remote.peerId : local.peerId,
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
