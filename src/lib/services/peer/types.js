/**
 * @typedef {'HANDSHAKE'|'HANDSHAKE_ACK'|'GLOBAL_MSG'|'GLOBAL_MSG_EDIT'|'GLOBAL_MSG_DELETE'|'PRESENCE_ANNOUNCE'|'HEARTBEAT'|'PRIVATE_KEY_EXCHANGE'|'PRIVATE_KEY_EXCHANGE_ACK'|'PRIVATE_MSG'|'PRIVATE_MSG_EDIT'|'PRIVATE_MSG_DELETE'|'PRIVATE_MSG_ACK'|'PRIVATE_CHAT_CLOSED'|'USER_LIST'|'PEER_DISCONNECT'|'LOBBY_JOIN'|'NETWORK_STATE'|'NEW_PEER'|'USERNAME_CHECK'|'USERNAME_TAKEN'|'USERNAME_REGISTERED'|'STATE_DIGEST'|'SYNC_REQUEST'|'SYNC_RESPONSE'|'LOBBY_HOST_CHANGED'|'FOLLOW'|'UNFOLLOW'|'WALL_COMMENT_ADDED'|'WALL_COMMENT_EDITED'|'WALL_COMMENT_DELETED'|'WALL_DATA_REQUEST'|'WALL_DATA_RESPONSE'} MessageType
 */

/**
 * @typedef {Object} UserProfile
 * @property {string} username
 * @property {string} color
 * @property {number} age
 * @property {string} [avatarBase64]
 * @property {number} [createdAt]
 */

/**
 * @typedef {Object} ProtocolEnvelope
 * @property {MessageType} type
 * @property {{peerId: string, username: string, color: string, age: number}} from
 * @property {any} payload
 * @property {number} timestamp
 * @property {string} [to]
 */
