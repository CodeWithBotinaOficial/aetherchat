import Dexie from 'dexie';

/**
 * @typedef {import('./types.js').User} User
 * @typedef {import('./types.js').GlobalMessage} GlobalMessage
 * @typedef {import('./types.js').PrivateChat} PrivateChat
 * @typedef {import('./types.js').PrivateMessage} PrivateMessage
 * @typedef {import('./types.js').KnownPeer} KnownPeer
 * @typedef {import('./types.js').UsernameRegistryEntry} UsernameRegistryEntry
 * @typedef {import('./types.js').PeerIdEntry} PeerIdEntry
 * @typedef {import('./types.js').QueuedMessage} QueuedMessage
 * @typedef {import('./types.js').QueuedAction} QueuedAction
 * @typedef {import('./types.js').SessionKeyRing} SessionKeyRing
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
