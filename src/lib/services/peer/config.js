// Constants/config only. No imports, no business logic.

// PeerJS public server has limitations (roughly ~50 connections per peer ID).
// This MVP uses it for discovery and direct browser-to-browser messaging.
export const LOBBY_ID_PREFIX = 'aetherchat-lobby-v1';
export const LOBBY_SHARDS = 4;

// Back-compat: keep the original exported constant for tests and logs.
export const LOBBY_PEER_ID = `${LOBBY_ID_PREFIX}-0`;

export const PEERJS_CONFIG = {
  host: '0.peerjs.com',
  port: 443,
  secure: true,
  // Keep PeerJS internal console output quiet by default.
  // Override via VITE_PEERJS_DEBUG (0-3) when needed.
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:global.relay.metered.ca:80' },
      {
        // Public TURN: not production-grade. Use a self-hosted Coturn for production.
        urls: 'turn:global.relay.metered.ca:80',
        username: 'open',
        credential: 'open'
      }
    ]
  }
};

export const RECONNECT_DELAYS = [2000, 5000, 10000];
export const MAX_RECONNECT_ATTEMPTS = 3;
export const JOIN_LOBBY_TIMEOUT_MS = 6000;
export const GLOBAL_EDIT_WINDOW_MS = 30 * 60 * 1000;

// PeerJS public server can keep an ID "taken" for a bit after hard-close; retry with backoff.
// First attempts stay under ~5s total, then continue backing off to avoid thrashing.
export const UNAVAILABLE_ID_RETRY_DELAYS_MS = [250, 500, 900, 1500, 2200, 3500, 5500, 8500, 13000];

// Avoid repeatedly trying to connect to peer IDs that just failed.
// This reduces noisy PeerJS console errors when the lobby roster contains stale IDs.
export const CONNECT_FAIL_COOLDOWN_MS = 2 * 60 * 1000;
export const CONNECT_PENDING_TIMEOUT_MS = 15_000;

export const MAX_DIRECT_PEERS = 10;

export const ALLOWED_TYPES = new Set([
  'HANDSHAKE',
  'HANDSHAKE_ACK',
  'GLOBAL_MSG',
  'GLOBAL_MSG_EDIT',
  'GLOBAL_MSG_DELETE',
  'PRESENCE_ANNOUNCE',
  'HEARTBEAT',
  'PRIVATE_KEY_EXCHANGE',
  'PRIVATE_KEY_EXCHANGE_ACK',
  'PRIVATE_MSG',
  'PRIVATE_MSG_EDIT',
  'PRIVATE_MSG_DELETE',
  'PRIVATE_MSG_ACK',
  'PRIVATE_CHAT_CLOSED',
  'USER_LIST',
  'PEER_DISCONNECT',
  'LOBBY_JOIN',
  'NETWORK_STATE',
  'NEW_PEER',
  'USERNAME_CHECK',
  'USERNAME_TAKEN',
  'USERNAME_REGISTERED',
  'STATE_DIGEST',
  'SYNC_REQUEST',
  'SYNC_RESPONSE',
  'LOBBY_HOST_CHANGED'
]);

export const REQUIRES_TO = new Set([
  'PRIVATE_KEY_EXCHANGE',
  'PRIVATE_KEY_EXCHANGE_ACK',
  'PRIVATE_MSG',
  'PRIVATE_MSG_EDIT',
  'PRIVATE_MSG_DELETE',
  'PRIVATE_MSG_ACK',
  'PRIVATE_CHAT_CLOSED'
]);

