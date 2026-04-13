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

