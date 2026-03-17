import { get, writable } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { addGlobalMessage, globalMessages as globalMessagesStore } from '$lib/stores/chatStore.js';
import {
  db,
  getFullUsernameRegistry,
  getGlobalMessages,
  getKnownPeers,
  isUsernameTaken,
  mergeUsernameRegistry,
  registerUsernameLocally,
  saveKnownPeer
} from '$lib/services/db.js';
import {
  buildSessionId,
  closeAllSessions,
  completeSession,
  createSession,
  decryptForSession,
  encryptForSession,
  exportPublicKey,
  generateKeyPair,
  isSessionActive,
  resumeSession
} from '$lib/services/crypto.js';
import {
  addIncomingMessage,
  addOutgoingMessage,
  deleteChatFromStore,
  decryptSealedMessages,
  markDelivered,
  openChat,
  privateChatStore,
  setChatOnlineStatus,
  setKeyExchangeState,
  updateMessageQueued,
  upsertChatEntry
} from '$lib/stores/privateChatStore.js';
import { activeTab } from '$lib/stores/navigationStore.js';
import {
  getPrivateChat,
  deleteQueuedMessage,
  getQueuedMessagesForChat,
  saveSentMessagePlaintext,
  markMessageDelivered,
  saveQueuedMessage,
  savePrivateMessage as saveEncryptedPrivateMessage,
  updateChatMeta,
  upsertPrivateChat
} from '$lib/services/db.js';

// PeerJS public server has limitations (roughly ~50 connections per peer ID).
// This MVP uses it for discovery and direct browser-to-browser messaging.
export const LOBBY_PEER_ID = 'aetherchat-lobby-v1';

export const PEERJS_CONFIG = {
  host: '0.peerjs.com',
  port: 443,
  secure: true,
  debug: import.meta.env.DEV ? 2 : 0,
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

const RECONNECT_DELAYS = [2000, 5000, 10000];
const MAX_RECONNECT_ATTEMPTS = 3;
const JOIN_LOBBY_TIMEOUT_MS = 6000;
// PeerJS public server can keep an ID "taken" for a bit after hard-close; retry with backoff.
// First attempts stay under ~5s total, then continue backing off to avoid thrashing.
const UNAVAILABLE_ID_RETRY_DELAYS_MS = [250, 500, 900, 1500, 2200, 3500, 5500, 8500, 13000];

// Avoid repeatedly trying to connect to peer IDs that just failed.
// This reduces noisy PeerJS console errors when the lobby roster contains stale IDs.
const CONNECT_FAIL_COOLDOWN_MS = 2 * 60 * 1000;
/** @type {Map<string, { lastFailedAt: number, count: number }>} */
const recentConnectFailures = new Map();

function isInConnectCooldown(peerId) {
  const key = String(peerId ?? '').trim();
  if (!key) return false;
  const entry = recentConnectFailures.get(key);
  if (!entry) return false;
  return Date.now() - entry.lastFailedAt < CONNECT_FAIL_COOLDOWN_MS;
}

function noteConnectFailure(peerId) {
  const key = String(peerId ?? '').trim();
  if (!key) return;
  const prev = recentConnectFailures.get(key);
  recentConnectFailures.set(key, {
    lastFailedAt: Date.now(),
    count: (prev?.count ?? 0) + 1
  });
}

function noteConnectSuccess(peerId) {
  const key = String(peerId ?? '').trim();
  if (!key) return;
  recentConnectFailures.delete(key);
}

let registrySyncResolve = null;
export let registrySyncReady = new Promise((resolve) => {
  registrySyncResolve = resolve;
});

function resolveRegistrySync(reason) {
  if (!registrySyncResolve) return;
  try {
    registrySyncResolve(reason);
  } finally {
    registrySyncResolve = null;
  }
}

// Peer avatar cache (peerId -> avatarBase64). Used for rendering; avatars are only exchanged via handshake messages.
export const avatarCache = writable(new Map());

function setCachedAvatar(peerId, avatarBase64) {
  if (!peerId || typeof avatarBase64 !== 'string' || avatarBase64.length === 0) return;
  // Base64 strings can be large; keep a hard cap to avoid blowing up memory from malformed payloads.
  if (avatarBase64.length > 750_000) return;
  avatarCache.update((cache) => {
    const next = new Map(cache);
    next.set(peerId, avatarBase64);
    return next;
  });
}

/**
 * @typedef {'HANDSHAKE'|'HANDSHAKE_ACK'|'GLOBAL_MSG'|'PRIVATE_KEY_EXCHANGE'|'PRIVATE_KEY_EXCHANGE_ACK'|'PRIVATE_MSG'|'PRIVATE_MSG_ACK'|'PRIVATE_CHAT_CLOSED'|'USER_LIST'|'PEER_DISCONNECT'|'LOBBY_JOIN'|'NETWORK_STATE'|'NEW_PEER'|'USERNAME_CHECK'|'USERNAME_TAKEN'|'USERNAME_REGISTERED'|'STATE_DIGEST'|'SYNC_REQUEST'|'SYNC_RESPONSE'|'LOBBY_HOST_CHANGED'} MessageType
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
 */

/** @type {any|null} */
let PeerCtor = null;

/** @type {any|null} */
let mainPeer = null;
let localPeerRef = null;
/** @type {any|null} */
let lobbyPeer = null;
/** @type {any|null} */
let lobbyConn = null;

/** @type {UserProfile|null} */
let cachedProfile = null;
let userProfileRef = null;

/** @type {Promise<{publicKey: CryptoKey, privateKey: CryptoKey}>|null} */
let localKeyPairPromise = null;
/** @type {Promise<string>|null} */
let localPublicKeyBase64Promise = null;

/** @type {Map<string, string>} */
const remoteIdentityKeys = new Map(); // peerId -> base64 public key (from HANDSHAKE/ACK)

/** @type {Map<string, any>} */
const lobbyConnections = new Map(); // peerId -> DataConnection (to lobby peer)

/** @type {Map<string, { peerId: string, username: string, color: string, age: number }>} */
const lobbyPeerList = new Map(); // peerId -> peer info (main peer IDs)

/** @type {Map<string, ProtocolEnvelope>} */
const pendingGlobalOutbox = new Map(); // messageId -> envelope (flush when peers connect)

let gossipIntervalId = null;
let heartbeatIntervalId = null;

// Track key exchange timeouts per chat so we don't get stuck forever in "initiated/completing".
const keyExchangeTimeouts = new Map(); // chatId -> timeoutId

let reconnectAttempts = 0;
let reconnectTimer = null;
let unavailableIdAttempts = 0;
let unavailableIdRetryTimer = null;
let unloadHookInstalled = false;
/** @type {string|null} */
let forcedPeerId = null;

async function broadcastStateDigest(profile) {
  try {
    const latest = await db.globalMessages.orderBy('timestamp').last();
    const registryCount = await db.usernameRegistry.count();
    broadcastToAll({
      type: 'STATE_DIGEST',
      from: buildFromProfile(profile),
      payload: {
        latestGlobalMsgTimestamp: latest?.timestamp ?? 0,
        usernameRegistryCount: registryCount,
        peerId: get(peerStore).peerId
      },
      timestamp: Date.now()
    });
  } catch (err) {
    console.error('broadcastStateDigest failed', err);
  }
}

async function handlePeerDisconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    if (heartbeatIntervalId) {
      clearInterval(heartbeatIntervalId);
      heartbeatIntervalId = null;
    }
    peerStore.update((s) => ({ ...s, connectionState: 'failed' }));
    return;
  }

  peerStore.update((s) => ({
    ...s,
    connectionState: 'reconnecting',
    reconnectAttempt: reconnectAttempts + 1
  }));

  reconnectTimer = setTimeout(() => {
    (async () => {
      reconnectAttempts += 1;

      if (!localPeerRef) {
        mainPeer = null;
        await initPeer(userProfileRef);
        return;
      }

      if (localPeerRef.destroyed) {
        try {
          mainPeer = null;
          localPeerRef = null;
        } catch {
          // ignore
        }
        await initPeer(userProfileRef);
        return;
      }

      if (localPeerRef.disconnected) {
        try {
          localPeerRef.reconnect();
        } catch (err) {
          console.error('Reconnect failed:', err);
          try {
            localPeerRef.destroy();
          } catch {
            // ignore
          }
          localPeerRef = null;
          mainPeer = null;
          await initPeer(userProfileRef);
        }
        return;
      }

      // Bad intermediate state: destroy and start fresh.
      try {
        localPeerRef.destroy();
      } catch {
        // ignore
      }
      localPeerRef = null;
      mainPeer = null;
      await initPeer(userProfileRef);
    })().catch((err) => console.error('handlePeerDisconnect failed', err));
  }, RECONNECT_DELAYS[reconnectAttempts] ?? 10_000);
}

const ALLOWED_TYPES = new Set([
  'HANDSHAKE',
  'HANDSHAKE_ACK',
  'GLOBAL_MSG',
  'PRESENCE_ANNOUNCE',
  'HEARTBEAT',
  'PRIVATE_KEY_EXCHANGE',
  'PRIVATE_KEY_EXCHANGE_ACK',
  'PRIVATE_MSG',
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

const REQUIRES_TO = new Set([
  'PRIVATE_KEY_EXCHANGE',
  'PRIVATE_KEY_EXCHANGE_ACK',
  'PRIVATE_MSG',
  'PRIVATE_MSG_ACK',
  'PRIVATE_CHAT_CLOSED'
]);

// Simple pub/sub so callers can await specific messages without coupling to PeerJS.
const listeners = new Map(); // type -> Set<(msg) => void>

/**
 * @param {MessageType} type
 * @param {(msg: any) => void} cb
 * @returns {() => void}
 */
export function onMessage(type, cb) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(cb);
  return () => listeners.get(type)?.delete(cb);
}

function emitMessage(msg) {
  const set = listeners.get(msg.type);
  if (!set) return;
  for (const cb of set) {
    try {
      cb(msg);
    } catch (err) {
      console.error('onMessage callback failed', err);
    }
  }
}

/**
 * Try a few suggestions; registry checks are local only.
 * @param {string} username
 * @returns {Promise<string>}
 */
export async function generateUsernameSuggestion(username) {
  const base = String(username ?? '').trim();
  if (!base) return `user${Math.floor(100 + Math.random() * 900)}`;

	  for (let i = 0; i < 10; i += 1) {
	    const suffix = Math.floor(100 + Math.random() * 900);
	    const candidate = `${base}${suffix}`;
	    // Best-effort: avoid suggestions already in the local registry.
	    // Network uniqueness is enforced via the USERNAME_CHECK flow.
	    const taken = await isUsernameTaken(candidate);
	    if (!taken) return candidate;
	  }

  return `${base}${Math.floor(100 + Math.random() * 900)}`;
}

/**
 * @param {string} desiredUsername
 * @returns {Promise<{ available: true } | { available: false, takenBy: string, suggestion: string }>}
 */
export async function checkUsernameAvailability(desiredUsername) {
  // Layer 1: local registry.
  const takenLocally = await isUsernameTaken(desiredUsername);
  if (takenLocally) {
    return {
      available: false,
      takenBy: 'local',
      suggestion: await generateUsernameSuggestion(desiredUsername)
    };
  }

  // Layer 2: live network query (only if we have direct peers).
  const connectedPeers = get(peerStore).connectedPeers;
  if (connectedPeers.size === 0) return { available: true };

  return await new Promise((resolve) => {
    const checkId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `chk-${Date.now()}-${Math.random()}`;
    const timer = setTimeout(() => resolve({ available: true }), 2000);

    const unsubscribe = onMessage('USERNAME_TAKEN', (msg) => {
      if (msg?.payload?.checkId !== checkId) return;
      clearTimeout(timer);
      unsubscribe();
      generateUsernameSuggestion(desiredUsername)
        .then((suggestion) => resolve({ available: false, takenBy: msg.from.peerId, suggestion }))
        .catch(() => resolve({ available: false, takenBy: msg.from.peerId, suggestion: `${desiredUsername}${Math.floor(100 + Math.random() * 900)}` }));
    });

    const from =
      cachedProfile && cachedProfile.username
        ? buildFromProfile(cachedProfile)
        : { peerId: get(peerStore).peerId ?? 'pre-registration', username: 'pre-registration', color: 'hsl(0, 0%, 70%)', age: 0 };

    broadcastToAll({
      type: 'USERNAME_CHECK',
      from,
      payload: { username: desiredUsername, checkId },
      timestamp: Date.now()
    });
  });
}

function isLobbyUnavailableError(err) {
  const type = err?.type;
  const msg = String(err?.message ?? '');
  // Some PeerJS builds omit `type` but include a helpful message string.
  return (type === 'peer-unavailable' || !type) && msg.includes(LOBBY_PEER_ID);
}

async function ensurePeerCtor() {
  if (PeerCtor) return PeerCtor;
  // In Vitest, accessing a missing named export can throw (ESM proxy behavior),
  // so probe exports defensively.
  const mod = await import('peerjs');
  try {
    // Cache for becomeLobbyHost callbacks.
    globalThis._PeerJS = mod;
  } catch {
    // ignore
  }
  /** @type {any|null} */
  let ctor = null;
  try {
    ctor = mod.default;
  } catch {
    // ignore
  }
  if (!ctor) {
    try {
      ctor = mod.Peer;
    } catch {
      // ignore
    }
  }
  PeerCtor = ctor ?? mod;
  return PeerCtor;
}

async function ensureLocalKeyPair() {
  if (!localKeyPairPromise) localKeyPairPromise = generateKeyPair();
  return localKeyPairPromise;
}

async function ensureLocalPublicKeyBase64() {
  if (!localPublicKeyBase64Promise) {
    localPublicKeyBase64Promise = ensureLocalKeyPair().then((kp) => exportPublicKey(kp.publicKey));
  }
  return localPublicKeyBase64Promise;
}

/**
 * @param {MessageType} type
 * @param {string} peerId
 * @param {UserProfile} profile
 * @param {any} payload
 * @returns {ProtocolEnvelope}
 */
function buildMessage(type, peerId, profile, payload, timestamp = Date.now()) {
  return {
    type,
    from: {
      peerId,
      username: profile.username,
      color: profile.color,
      age: profile.age
    },
    payload,
    timestamp
  };
}

function buildDirectMessage(type, peerId, profile, to, payload, timestamp = Date.now()) {
  return {
    ...buildMessage(type, peerId, profile, payload, timestamp),
    to
  };
}

/**
 * @param {UserProfile} profile
 * @param {string} [peerIdOverride]
 * @returns {{peerId: string, username: string, color: string, age: number}}
 */
function buildFromProfile(profile, peerIdOverride) {
  const peerId = peerIdOverride ?? get(peerStore).peerId ?? '';
  return { peerId, username: profile.username, color: profile.color, age: profile.age };
}

/**
 * @param {any} msg
 * @returns {msg is ProtocolEnvelope}
 */
export function validateProtocolMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (!ALLOWED_TYPES.has(msg.type)) return false;
  if (!msg.from || typeof msg.from !== 'object') return false;
  if (typeof msg.from.peerId !== 'string' || msg.from.peerId.length === 0) return false;
  if (typeof msg.from.username !== 'string' || msg.from.username.length === 0) return false;
  if (typeof msg.from.color !== 'string' || msg.from.color.length === 0) return false;
  if (typeof msg.from.age !== 'number') return false;
  if (typeof msg.timestamp !== 'number') return false;
  if (typeof msg.payload === 'undefined') return false;
  if (typeof msg.to !== 'undefined') {
    if (typeof msg.to !== 'string' || msg.to.length === 0) return false;
  }
  if (REQUIRES_TO.has(msg.type)) {
    if (typeof msg.to !== 'string' || msg.to.length === 0) return false;
  }
  return true;
}

function setConnectionState(state, extra = {}) {
  peerStore.update((s) => ({ ...s, connectionState: state, ...extra }));
}

function upsertConnectedPeer(peerId, conn, info) {
  peerStore.update((s) => {
    const next = new Map(s.connectedPeers);
    const prev = next.get(peerId);
    next.set(peerId, {
      username: info?.username ?? prev?.username ?? 'unknown',
      color: info?.color ?? prev?.color ?? '',
      age: info?.age ?? prev?.age ?? 0,
      avatarBase64: info?.avatarBase64 ?? prev?.avatarBase64 ?? null,
      connection: conn ?? prev?.connection
    });
    return { ...s, connectedPeers: next };
  });
}

function removeConnectedPeer(peerId) {
  peerStore.update((s) => {
    const next = new Map(s.connectedPeers);
    next.delete(peerId);
    return { ...s, connectedPeers: next };
  });
}

function electNewLobbyHost() {
  // Called when the current lobby host is lost. Deterministic election:
  // the lowest peerId (alphabetically) among all currently connected peers (including self)
  // attempts to claim the lobby ID.
  const state = get(peerStore);
  const ourId = state.peerId;
  if (!ourId) return;
  if (!mainPeer || !cachedProfile) return;
  if (state.isLobbyHost) return;

  const allPeerIds = [ourId, ...state.connectedPeers.keys()].sort();
  if (allPeerIds[0] !== ourId) return;

  becomeLobbyHost(mainPeer, cachedProfile).catch((err) => console.error('electNewLobbyHost failed', err));
}

function safeSend(conn, msg) {
  // PeerJS DataConnection throws if you send before the `open` event.
  // This can happen transiently during reconnect when we have entries in the map
  // for connections that are still negotiating.
  // Note: some unit tests stub connections without an `open` boolean; in that case
  // we treat it as sendable. PeerJS always exposes `open` (false until ready).
  if (!conn || conn.open === false) return;
  try {
    conn?.send?.(msg);
  } catch (err) {
    console.error('Peer send failed', err);
  }
}

function safeClose(conn) {
  try {
    conn?.close?.();
  } catch (err) {
    console.error('Peer close failed', err);
  }
}

function startGossipInterval(profile) {
  if (gossipIntervalId) clearInterval(gossipIntervalId);
  gossipIntervalId = setInterval(() => {
    broadcastStateDigest(profile).catch((err) => console.error('gossip tick failed', err));
  }, 30_000);
}

function startHeartbeat(profile) {
  if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
  heartbeatIntervalId = setInterval(() => {
    const state = get(peerStore);
    if (state.connectedPeers.size === 0) return;
    const id = state.peerId;
    if (!id) return;
    const p = profile ?? cachedProfile;
    if (!p) return;
    broadcastToAll(buildMessage('HEARTBEAT', id, p, {}, Date.now()));
  }, 30_000);
}

function stopHeartbeat() {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
}

function startKeyExchangeTimeout(chatId) {
  clearKeyExchangeTimeout(chatId);
  const timeoutId = setTimeout(() => {
    keyExchangeTimeouts.delete(chatId);
    const chat = get(privateChatStore).chats.get(chatId);
    const state = chat?.keyExchangeState;
    if (state === 'initiated' || state === 'completing') {
      setKeyExchangeState(chatId, 'failed');
    }
  }, 10_000);
  keyExchangeTimeouts.set(chatId, timeoutId);
}

function clearKeyExchangeTimeout(chatId) {
  const existing = keyExchangeTimeouts.get(chatId);
  if (existing) {
    clearTimeout(existing);
    keyExchangeTimeouts.delete(chatId);
  }
}

async function getKnownUsernamesList() {
  const entries = await getFullUsernameRegistry();
  return entries.map((e) => e.username);
}

function connectToPeer(peerId, profile) {
  if (!mainPeer) return null;
  // PeerJS throws "Cannot connect to new Peer after disconnecting from server." when
  // attempting to create a DataConnection while `peer.disconnected === true`.
  if (mainPeer.destroyed || mainPeer.disconnected) return null;
  if (!peerId || peerId === mainPeer.id) return null;
  if (isInConnectCooldown(peerId)) return null;

  const state = get(peerStore);
  if (state.connectedPeers.has(peerId)) return state.connectedPeers.get(peerId)?.connection ?? null;

  try {
    const conn = mainPeer.connect(peerId);
    handleIncomingConnection(conn, profile);
    return conn;
  } catch (err) {
    console.error('connectToPeer failed', err);
    return null;
  }
}

async function sendHandshake(conn, profile) {
  const effectiveProfile = profile ?? userProfileRef ?? cachedProfile;
  if (!effectiveProfile) return;
  const id = get(peerStore).peerId;
  if (!id) return;
  const publicKey = await ensureLocalPublicKeyBase64();
  safeSend(
    conn,
    buildMessage('HANDSHAKE', id, effectiveProfile, { publicKey, avatarBase64: effectiveProfile.avatarBase64 ?? null })
  );
}

async function sendHandshakeAck(conn, profile) {
  const effectiveProfile = profile ?? userProfileRef ?? cachedProfile;
  if (!effectiveProfile) return;
  const id = get(peerStore).peerId;
  if (!id) return;
  const publicKey = await ensureLocalPublicKeyBase64();
  safeSend(
    conn,
    buildMessage('HANDSHAKE_ACK', id, effectiveProfile, { publicKey, avatarBase64: effectiveProfile.avatarBase64 ?? null })
  );
}

function broadcastToAll(envelope) {
  const state = get(peerStore);
  for (const entry of state.connectedPeers.values()) safeSend(entry.connection, envelope);
}

function sendToPeer(peerId, envelope) {
  const state = get(peerStore);
  const entry = state.connectedPeers.get(peerId);
  if (!entry) return;
  if (entry.connection?.open === false) return;
  safeSend(entry.connection, envelope);
}

function flushGlobalOutbox() {
  const state = get(peerStore);
  const openPeers = [...state.connectedPeers.values()].filter((e) => e.connection?.open !== false);
  if (openPeers.length === 0) return;
  for (const [msgId, env] of pendingGlobalOutbox.entries()) {
    for (const entry of openPeers) safeSend(entry.connection, env);
    pendingGlobalOutbox.delete(msgId);
  }
}

export async function flushQueueForPeer(theirPeerId) {
  const state = get(peerStore);
  const entry = theirPeerId ? state.connectedPeers.get(theirPeerId) : null;
  if (!theirPeerId || !entry || entry.connection?.open === false) return;
  const myPeerId = state.peerId;
  const profile = userProfileRef ?? cachedProfile;
  if (!myPeerId || !profile || !profile.username || profile.username === 'pre-registration') return;

  // PeerJS IDs are transient; queues are keyed by stable chatId (username-based).
  const chatsForPeer = [];
  try {
    for (const chat of get(privateChatStore).chats.values()) {
      if (chat?.theirPeerId === theirPeerId) chatsForPeer.push(chat);
    }
  } catch {
    // ignore
  }
  if (chatsForPeer.length === 0) return;

  for (const chat of chatsForPeer) {
    const chatId = chat?.id;
    if (!chatId) continue;

    /** @type {import('$lib/services/db.js').QueuedMessage[] | undefined} */
    let queued;
    try {
      queued = await getQueuedMessagesForChat(chatId);
    } catch (err) {
      console.error('getQueuedMessagesForChat failed', err);
      continue;
    }
    if (!queued || queued.length === 0) continue;

    const sessionActive = isSessionActive(chatId);
    if (!sessionActive) {
      // Need a session before we can encrypt and send.
      try {
        const { publicKeyBase64 } = await createSession(profile.username, chat.theirUsername);
        setKeyExchangeState(chatId, 'initiated');
        startKeyExchangeTimeout(chatId);
        sendToPeer(
          theirPeerId,
          buildDirectMessage('PRIVATE_KEY_EXCHANGE', myPeerId, profile, theirPeerId, { publicKeyBase64 }, Date.now())
        );
      } catch (err) {
        console.error('flushQueueForPeer key exchange init failed', err);
        clearKeyExchangeTimeout(chatId);
        setKeyExchangeState(chatId, 'failed');
      }
      continue;
    }

    // Session is active: encrypt and send each queued message, then remove it from the queue.
    for (const msg of queued) {
      try {
        const { ciphertext, iv } = await encryptForSession(chatId, msg.plaintext);
        await deleteQueuedMessage(msg.id);
        await saveEncryptedPrivateMessage({
          id: msg.id,
          chatId,
          direction: 'sent',
          ciphertext,
          iv,
          timestamp: msg.timestamp,
          delivered: false
        });
        // Keep a local plaintext copy for sender readability across re-keys.
        await saveSentMessagePlaintext({ id: msg.id, chatId, plaintext: msg.plaintext, timestamp: msg.timestamp });
        updateMessageQueued(chatId, msg.id, false);
        sendToPeer(
          theirPeerId,
          buildDirectMessage('PRIVATE_MSG', myPeerId, profile, theirPeerId, { ciphertext, iv, messageId: msg.id }, msg.timestamp)
        );
      } catch (err) {
        console.error('Failed to flush queued message', err);
      }
    }
  }
}

function getNetworkPeerList(profile) {
  // When acting as lobby host, discovery must not depend on direct mesh links.
  // Use the lobby join roster as the baseline, then overlay any fresher info we
  // already have from direct connections.
  const state = get(peerStore);
  const map = new Map();

  // Include any known lobby-joined peers.
  for (const p of lobbyPeerList.values()) {
    if (!p?.peerId) continue;
    // Only advertise peers that still have an open lobby join connection.
    // Direct mesh peers will be overlaid below.
    if (p.peerId !== state.peerId) {
      const joinConn = lobbyConnections.get(p.peerId);
      if (!joinConn || joinConn.open === false) continue;
    }
    map.set(p.peerId, { peerId: p.peerId, username: p.username, color: p.color, age: p.age });
  }

  // Ensure self is present (some edge flows can call before lobbyPeerList is seeded).
  if (state.peerId) {
    map.set(state.peerId, { peerId: state.peerId, username: profile.username, color: profile.color, age: profile.age });
  }

  // Overlay direct connection info (more up-to-date than initial LOBBY_JOIN payloads).
  for (const [peerId, info] of state.connectedPeers.entries()) {
    if (!peerId) continue;
    map.set(peerId, { peerId, username: info.username, color: info.color, age: info.age });
  }

  return Array.from(map.values());
}

async function setupLobbyHostHandlers(hostPeer, localPeer, profile) {
  // Track ourselves in the lobby's peer list.
  if (localPeer?.id) {
    lobbyPeerList.set(localPeer.id, { peerId: localPeer.id, username: profile.username, color: profile.color, age: profile.age });
  }

  hostPeer.on('connection', (conn) => {
    conn.on('close', () => {
      // Clean up lobby roster entry for this join connection.
      const pid = conn?.metadata?.peerId;
      if (typeof pid === 'string' && pid.length > 0) {
        lobbyConnections.delete(pid);
        lobbyPeerList.delete(pid);
      }
    });
    conn.on('error', () => {
      const pid = conn?.metadata?.peerId;
      if (typeof pid === 'string' && pid.length > 0) {
        lobbyConnections.delete(pid);
        lobbyPeerList.delete(pid);
      }
    });
    conn.on('data', (msg) => {
      (async () => {
        if (!validateProtocolMessage(msg)) return;
        if (msg.type !== 'LOBBY_JOIN') return;

        const newPeer = msg.from;
        lobbyPeerList.set(newPeer.peerId, { peerId: newPeer.peerId, username: newPeer.username, color: newPeer.color, age: newPeer.age });
        lobbyConnections.set(newPeer.peerId, conn);
        // Stamp the join connection with the main peerId so conn.on('close') can
        // remove it from the roster (PeerJS DataConnection doesn't expose `from`).
        try {
          conn.metadata = { ...(conn.metadata ?? {}), peerId: newPeer.peerId };
        } catch {
          // ignore
        }

        const [peerList, usernameRegistry, globalHistory] = await Promise.all([
          getNetworkPeerList(profile),
          getFullUsernameRegistry(),
          getGlobalMessages(100)
        ]);

        safeSend(conn, {
          type: 'NETWORK_STATE',
          from: buildFromProfile(profile),
          payload: { peers: peerList, usernameRegistry, globalHistory },
          timestamp: Date.now()
        });

        broadcastToAll({
          type: 'NEW_PEER',
          from: buildFromProfile(profile),
          payload: { newPeer },
          timestamp: Date.now()
        });

        // Critical for guest reconnection: proactively form a direct mesh link to
        // the joining peer. Guests should not have to "poke" the network to be seen.
        // Delay slightly to reduce connection-collision thrash when both sides reconnect.
        setTimeout(() => {
          try {
            connectToPeerIfUnknown(newPeer, profile);
          } catch (err) {
            console.error('lobby host connect-back failed', err);
          }
        }, 350);
      })().catch((err) => console.error('lobby host handler failed', err));
    });
  });

  // Ensure lobby peer is destroyed when we leave.
  if (typeof window !== 'undefined') {
    window.addEventListener(
      'beforeunload',
      () => {
        try {
          hostPeer.destroy?.();
        } catch {
          // ignore
        }
      },
      { once: true }
    );
  }
}

/**
 * Attempt to connect to existing lobby; if missing, become the lobby host.
 * @param {any} localPeer
 * @param {UserProfile} profile
 * @returns {Promise<{ role: 'guest', lobbyConn: any } | { role: 'host', lobbyPeer: any } | { role: 'standalone' }>}
 */
export async function joinLobby(localPeer, profile, attempt = 0) {
  return await new Promise((resolve) => {
    // If the peer is disconnected/destroyed we cannot open new DataConnections.
    if (!localPeer || localPeer.destroyed || localPeer.disconnected) {
      resolveRegistrySync('timeout');
      void handlePeerDisconnect();
      resolve({ role: 'standalone' });
      return;
    }

    /** @type {any} */
    let conn;
    try {
      // Attempt to connect to the existing lobby host.
      conn = localPeer.connect(LOBBY_PEER_ID, {
        reliable: true,
        metadata: { type: 'lobby-join' }
      });
    } catch (err) {
      // PeerJS throws when trying to connect while the peer is in a disconnected state.
      console.error('joinLobby: connect failed', err);
      resolveRegistrySync('timeout');
      void handlePeerDisconnect();
      resolve({ role: 'standalone' });
      return;
    }

    if (!conn || typeof conn.on !== 'function') {
      // Defensive: some PeerJS failure modes return undefined instead of throwing.
      resolveRegistrySync('timeout');
      void handlePeerDisconnect();
      resolve({ role: 'standalone' });
      return;
    }

    // IMPORTANT: this connection is not part of our direct-peer mesh, but it *must*
    // receive NETWORK_STATE so guests can learn the peer list and sync history.
    conn.on('data', (data) => {
      (async () => {
        await handleMessage(data, conn, profile);
      })().catch((err) => console.error('lobbyConn handleMessage failed', err));
    });

    const timeout = setTimeout(() => {
      resolveRegistrySync('timeout');
      safeClose(conn);
      becomeLobbyHost(localPeer, profile, attempt).then(resolve);
    }, JOIN_LOBBY_TIMEOUT_MS);

    conn.on('open', () => {
      clearTimeout(timeout);
      lobbyConn = conn;

      safeSend(conn, {
        type: 'LOBBY_JOIN',
        from: buildFromProfile(profile, localPeer.id),
        payload: {},
        timestamp: Date.now()
      });

      peerStore.update((s) => ({ ...s, isLobbyHost: false }));
      resolve({ role: 'guest', lobbyConn: conn });
    });

    conn.on('error', (err) => {
      clearTimeout(timeout);
      safeClose(conn);
      // If we're disconnected from the PeerJS server, don't try to claim the lobby yet.
      if (err?.type === 'disconnected') {
        resolveRegistrySync('timeout');
        void handlePeerDisconnect();
        resolve({ role: 'standalone' });
        return;
      }
      becomeLobbyHost(localPeer, profile, attempt).then(resolve);
    });

    conn.on('close', () => {
      if (lobbyConn === conn) lobbyConn = null;
      // If the lobby peer disappears, elect a new host so newcomers can join.
      setTimeout(electNewLobbyHost, 2000);
    });
  });
}

/**
 * Try to claim the lobby ID by creating a second Peer. On race, retry join as guest (max 3 attempts).
 * @param {any} localPeer
 * @param {UserProfile} profile
 * @param {number} [attempt=0]
 * @returns {Promise<{ role: 'host', lobbyPeer: any } | { role: 'guest', lobbyConn: any } | { role: 'standalone' }>}
 */
export async function becomeLobbyHost(localPeer, profile, attempt = 0) {
  return await new Promise((resolve) => {
    /** @type {any} */
    const mod = globalThis._PeerJS;
    const Peer = mod?.Peer ?? mod?.default ?? PeerCtor;
    const hostPeer = new Peer(LOBBY_PEER_ID, PEERJS_CONFIG);

    hostPeer.on('open', () => {
      lobbyPeer = hostPeer;
      resolveRegistrySync('first-peer');
      peerStore.update((s) => ({
        ...s,
        isLobbyHost: true,
        lobbyPeer: hostPeer,
        currentLobbyHostId: get(peerStore).peerId
      }));
      void setupLobbyHostHandlers(hostPeer, localPeer, profile);

      // Inform the mesh which main peer now holds the lobby ID.
      broadcastToAll({
        type: 'LOBBY_HOST_CHANGED',
        from: buildFromProfile(profile),
        payload: { newHostPeerId: get(peerStore).peerId },
        timestamp: Date.now()
      });

      resolve({ role: 'host', lobbyPeer: hostPeer });
    });

    hostPeer.on('error', (err) => {
      if (err?.type === 'unavailable-id') {
        try {
          hostPeer.destroy?.();
        } catch {
          // ignore
        }

        if (attempt >= 2) {
          resolve({ role: 'standalone' });
          return;
        }

        const jitter = 1000 + Math.random() * 1000;
        setTimeout(() => {
          joinLobby(localPeer, profile, attempt + 1).then(resolve);
        }, jitter);
        return;
      }

      peerStore.update((s) => ({ ...s, connectionState: 'standalone' }));
      resolveRegistrySync('standalone');
      resolve({ role: 'standalone' });
    });
  });
}

export function handleIncomingConnection(conn, profile) {
  if (!conn) return;
  const remotePeerId = conn.peer;
  const effectiveProfile = profile ?? userProfileRef ?? cachedProfile;

  // If we already have a connection for this peerId (stale), close it and replace.
  const existing = get(peerStore).connectedPeers.get(remotePeerId);
  if (existing?.connection && existing.connection !== conn) {
    safeClose(existing.connection);
  }

  upsertConnectedPeer(remotePeerId, conn, null);

  conn.on('open', () => {
    (async () => {
      noteConnectSuccess(remotePeerId);
      // Replace stale connection entry on open as well (covers both incoming + outgoing).
      const prev = get(peerStore).connectedPeers.get(remotePeerId);
      if (prev?.connection && prev.connection !== conn) {
        safeClose(prev.connection);
        upsertConnectedPeer(remotePeerId, conn, null);
      }

      await sendHandshake(conn, effectiveProfile);
      void flushQueueForPeer(remotePeerId);
      flushGlobalOutbox();
      setChatOnlineStatus(remotePeerId, true);
	      // Trigger an immediate digest after a peer link comes up so refreshed peers
	      // can sync without waiting for the 30s gossip interval.
	      void broadcastStateDigest(effectiveProfile);
	    })().catch((err) => console.error('sendHandshake failed', err));
	  });

  conn.on('data', (data) => {
    (async () => {
      await handleMessage(data, conn, effectiveProfile);
    })().catch((err) => console.error('handleMessage failed', err));
  });

  conn.on('close', () => {
    setChatOnlineStatus(remotePeerId, false);
    peerStore.update((s) => {
      const next = new Map(s.connectedPeers);
      const current = next.get(remotePeerId);
      if (current?.connection === conn) {
        next.delete(remotePeerId);
      }
      return { ...s, connectedPeers: next };
    });
    // If we lost the current lobby host (main peer), attempt re-election.
    if (remotePeerId && remotePeerId === get(peerStore).currentLobbyHostId) {
      setTimeout(electNewLobbyHost, 2000);
    }
  });

  conn.on('error', (err) => {
    noteConnectFailure(remotePeerId);
    console.error('Peer connection error', err);
    setChatOnlineStatus(remotePeerId, false);
    peerStore.update((s) => {
      const next = new Map(s.connectedPeers);
      const current = next.get(remotePeerId);
      if (current?.connection === conn) {
        next.delete(remotePeerId);
      }
      return { ...s, connectedPeers: next };
    });
  });
}

async function handleNetworkState(payload, profile) {
  const peers = payload?.peers ?? [];
  const usernameRegistry = payload?.usernameRegistry ?? [];
  const globalHistory = payload?.globalHistory ?? [];

  // 1. Merge username registry.
  try {
    await mergeUsernameRegistry(usernameRegistry);
  } catch (err) {
    console.error('handleNetworkState mergeUsernameRegistry failed', err);
  } finally {
    resolveRegistrySync('network');
  }

  // 2. Merge global message history (best-effort dedupe by `id`).
  try {
    await db.transaction('rw', db.globalMessages, async () => {
      for (const msg of globalHistory) {
        if (!msg || typeof msg !== 'object') continue;
        // `put` acts as an upsert keyed by the table primary key (`id`).
        await db.globalMessages.put(msg);
      }
    });
  } catch (err) {
    console.error('handleNetworkState merge messages failed', err);
  }

  // 3. Refresh store from DB.
  try {
    const allMessages = await getGlobalMessages(100);
    globalMessagesStore.set(allMessages);
  } catch (err) {
    console.error('handleNetworkState refresh store failed', err);
  }

  // 4. Connect to all peers in the list.
  const localPeerId = get(peerStore).peerId;
  const connectedIds = new Set(get(peerStore).connectedPeers.keys());
  for (const p of peers) {
    if (!p?.peerId) continue;
    if (p.peerId === localPeerId) continue;
    if (connectedIds.has(p.peerId)) continue;
    connectToPeerIfUnknown(p, profile);
  }

  setConnectionState('connected', { isConnected: true, lastSyncAt: Date.now() });
}

function connectToPeerIfUnknown(peerInfo, profile) {
  const pid = peerInfo?.peerId;
  if (!pid || pid === get(peerStore).peerId) return;
  if (isInConnectCooldown(pid)) return;
  const state = get(peerStore);
  const existing = state.connectedPeers.get(pid);
  if (existing) {
    // Stale connections can remain after a browser close. Only skip if the connection is actually open.
    if (existing.connection?.open) return;
    safeClose(existing.connection);
    removeConnectedPeer(pid);
  }
  connectToPeer(pid, profile);
}

async function reconnectToKnownPeers(profile) {
  try {
    // If we're not connected to the PeerJS server, do not attempt to open new DataConnections.
    if (!mainPeer || mainPeer.destroyed || mainPeer.disconnected) return;

    const known = await getKnownPeers();
    const myPeerId = get(peerStore).peerId;
    const connected = get(peerStore).connectedPeers;

    for (const p of known) {
      if (!p?.peerId) continue;
      if (p.peerId === myPeerId) continue;
      const existing = connected.get(p.peerId);
      if (existing?.connection?.open) continue;
      connectToPeerIfUnknown({ peerId: p.peerId }, profile);
    }
  } catch (err) {
    console.error('reconnectToKnownPeers failed', err);
  }
}

function announcePresence(profile) {
  const state = get(peerStore);
  const id = state.peerId;
  if (!id) return;
  if (!profile) return;
  broadcastToAll({
    type: 'PRESENCE_ANNOUNCE',
    from: buildFromProfile(profile),
    payload: {
      username: profile.username,
      color: profile.color,
      age: profile.age,
      avatarBase64: profile.avatarBase64 ?? null
    },
    timestamp: Date.now()
  });
}

export async function handleMessage(msg, fromConn, profile) {
  if (!validateProtocolMessage(msg)) return;
  emitMessage(msg);

  const remotePeerId = msg.from.peerId;

  if (msg.type === 'HANDSHAKE') {
    remoteIdentityKeys.set(remotePeerId, msg.payload?.publicKey ?? '');
    const avatarBase64 = typeof msg.payload?.avatarBase64 === 'string' && msg.payload.avatarBase64.length > 0 ? msg.payload.avatarBase64 : null;
    if (avatarBase64) setCachedAvatar(remotePeerId, avatarBase64);
    upsertConnectedPeer(remotePeerId, fromConn, {
      username: msg.from.username,
      color: msg.from.color,
      age: msg.from.age,
      avatarBase64
    });
    await saveKnownPeer({ username: msg.from.username, peerId: remotePeerId, lastSeen: Date.now() });

    // Update any existing private chat entry: PeerJS IDs are transient, chatId is username-based.
    if (profile?.username && profile.username !== 'pre-registration' && msg.from.username) {
      const chatId = buildSessionId(profile.username, msg.from.username);
      const existing = await getPrivateChat(chatId);
      if (existing) {
        await upsertPrivateChat({
          ...existing,
          myPeerId: get(peerStore).peerId ?? existing.myPeerId,
          myUsername: profile.username,
          theirPeerId: remotePeerId,
          theirAvatarBase64: avatarBase64 ?? existing.theirAvatarBase64 ?? null
        });
        upsertChatEntry({
          id: chatId,
          theirPeerId: remotePeerId,
          theirAvatarBase64: avatarBase64 ?? existing.theirAvatarBase64 ?? null,
          isOnline: true
        });

        // If we have a persisted key ring for this chat, resume and decrypt sealed history immediately.
        if (!isSessionActive(chatId)) {
          try {
            await resumeSession(chatId);
          } catch {
            // ignore
          }
        }
        if (isSessionActive(chatId)) {
          setKeyExchangeState(chatId, 'active');
          try {
            await decryptSealedMessages(chatId, chatId);
          } catch {
            // ignore
          }
	        } else if (get(privateChatStore).chats.get(chatId)?.keyExchangeState === 'idle') {
	          // No stored keys: try to re-key silently so queued messages can flush.
	          try {
	            const myPid = get(peerStore).peerId;
	            if (!myPid) throw new Error('missing peerId');
	            const { publicKeyBase64 } = await createSession(profile.username, msg.from.username);
	            setKeyExchangeState(chatId, 'initiated');
	            startKeyExchangeTimeout(chatId);
	            sendToPeer(
	              remotePeerId,
	              buildDirectMessage('PRIVATE_KEY_EXCHANGE', myPid, profile, remotePeerId, { publicKeyBase64 }, Date.now())
	            );
	          } catch {
	            // ignore
	          }
	        }

        // After updating peerId mapping + keys, attempt queue flush.
        void flushQueueForPeer(remotePeerId);
      }
    }

    setChatOnlineStatus(remotePeerId, true);
    await sendHandshakeAck(fromConn, profile);
    return;
  }

  if (msg.type === 'HANDSHAKE_ACK') {
    remoteIdentityKeys.set(remotePeerId, msg.payload?.publicKey ?? '');
    const avatarBase64 = typeof msg.payload?.avatarBase64 === 'string' && msg.payload.avatarBase64.length > 0 ? msg.payload.avatarBase64 : null;
    if (avatarBase64) setCachedAvatar(remotePeerId, avatarBase64);
    upsertConnectedPeer(remotePeerId, fromConn, {
      username: msg.from.username,
      color: msg.from.color,
      age: msg.from.age,
      avatarBase64
    });
    await saveKnownPeer({ username: msg.from.username, peerId: remotePeerId, lastSeen: Date.now() });

    if (profile?.username && profile.username !== 'pre-registration' && msg.from.username) {
      const chatId = buildSessionId(profile.username, msg.from.username);
      const existing = await getPrivateChat(chatId);
      if (existing) {
        await upsertPrivateChat({
          ...existing,
          myPeerId: get(peerStore).peerId ?? existing.myPeerId,
          myUsername: profile.username,
          theirPeerId: remotePeerId,
          theirAvatarBase64: avatarBase64 ?? existing.theirAvatarBase64 ?? null
        });
        upsertChatEntry({
          id: chatId,
          theirPeerId: remotePeerId,
          theirAvatarBase64: avatarBase64 ?? existing.theirAvatarBase64 ?? null,
          isOnline: true
        });

        if (!isSessionActive(chatId)) {
          try {
            await resumeSession(chatId);
          } catch {
            // ignore
          }
        }
        if (isSessionActive(chatId)) {
          setKeyExchangeState(chatId, 'active');
          try {
            await decryptSealedMessages(chatId, chatId);
          } catch {
            // ignore
          }
	        } else if (get(privateChatStore).chats.get(chatId)?.keyExchangeState === 'idle') {
	          try {
	            const myPid = get(peerStore).peerId;
	            if (!myPid) throw new Error('missing peerId');
	            const { publicKeyBase64 } = await createSession(profile.username, msg.from.username);
	            setKeyExchangeState(chatId, 'initiated');
	            startKeyExchangeTimeout(chatId);
	            sendToPeer(
	              remotePeerId,
	              buildDirectMessage('PRIVATE_KEY_EXCHANGE', myPid, profile, remotePeerId, { publicKeyBase64 }, Date.now())
	            );
	          } catch {
	            // ignore
	          }
	        }

        void flushQueueForPeer(remotePeerId);
      }
    }

    setChatOnlineStatus(remotePeerId, true);
    return;
  }

  if (msg.type === 'PRESENCE_ANNOUNCE') {
    const avatarBase64 =
      typeof msg.payload?.avatarBase64 === 'string' && msg.payload.avatarBase64.length > 0 ? msg.payload.avatarBase64 : null;
    if (avatarBase64) setCachedAvatar(remotePeerId, avatarBase64);

    const theirUsername = msg.payload?.username ?? msg.from.username;
    upsertConnectedPeer(remotePeerId, fromConn, {
      username: theirUsername,
      color: msg.payload?.color ?? msg.from.color,
      age: typeof msg.payload?.age === 'number' ? msg.payload.age : msg.from.age,
      avatarBase64
    });
    await saveKnownPeer({ username: msg.from.username, peerId: remotePeerId, lastSeen: msg.timestamp ?? Date.now() });

    // If we have a private chat with them and session is not active, silently re-key.
    const myPeerId = get(peerStore).peerId;
    const p = userProfileRef ?? cachedProfile;
    if (myPeerId && p?.username && p.username !== 'pre-registration' && theirUsername) {
      const chatId = buildSessionId(p.username, theirUsername);
      const chat = get(privateChatStore).chats.get(chatId);

      // If the chat exists, update theirPeerId (PeerJS IDs can change across refreshes).
      if (chat) {
        try {
          const existing = await getPrivateChat(chatId);
          if (existing) {
            await upsertPrivateChat({
              ...existing,
              myPeerId,
              myUsername: p.username,
              theirPeerId: remotePeerId,
              theirAvatarBase64: avatarBase64 ?? existing.theirAvatarBase64 ?? null
            });
          }
        } catch {
          // ignore
        }
        upsertChatEntry({ id: chatId, theirPeerId: remotePeerId, isOnline: true, theirAvatarBase64: avatarBase64 ?? chat.theirAvatarBase64 });
      }

      if (chat && !isSessionActive(chatId) && chat.keyExchangeState !== 'initiated' && chat.keyExchangeState !== 'completing') {
        try {
          const { publicKeyBase64 } = await createSession(p.username, theirUsername);
          setKeyExchangeState(chatId, 'initiated');
          startKeyExchangeTimeout(chatId);
          sendToPeer(
            remotePeerId,
            buildDirectMessage('PRIVATE_KEY_EXCHANGE', myPeerId, p, remotePeerId, { publicKeyBase64 }, Date.now())
          );
        } catch (err) {
          console.error('Auto re-key failed', err);
          setKeyExchangeState(chatId, 'failed');
        }
      }
    }

    setChatOnlineStatus(remotePeerId, true);
    return;
  }

  if (msg.type === 'HEARTBEAT') {
    setChatOnlineStatus(remotePeerId, true);
    await saveKnownPeer({ username: msg.from.username, peerId: remotePeerId, lastSeen: msg.timestamp ?? Date.now() });
    return;
  }

  if (msg.type === 'NETWORK_STATE') {
    peerStore.update((s) => ({ ...s, currentLobbyHostId: msg.from.peerId }));
    await handleNetworkState(msg.payload, profile);
    return;
  }

  if (msg.type === 'NEW_PEER') {
    await connectToPeerIfUnknown(msg.payload?.newPeer, profile);
    return;
  }

  if (msg.type === 'LOBBY_HOST_CHANGED') {
    const newHostPeerId = msg.payload?.newHostPeerId;
    if (typeof newHostPeerId === 'string' && newHostPeerId.length > 0) {
      peerStore.update((s) => ({ ...s, currentLobbyHostId: newHostPeerId }));
    }
    return;
  }

  if (msg.type === 'LOBBY_JOIN') {
    // Only lobby host processes these; handled in setupLobbyHostHandlers.
    return;
  }

  if (msg.type === 'USERNAME_CHECK') {
    const username = msg.payload?.username;
    const checkId = msg.payload?.checkId;
    if (typeof username !== 'string' || typeof checkId !== 'string') return;
    const taken = await isUsernameTaken(username);
    if (!taken) return;
    sendToPeer(msg.from.peerId, {
      type: 'USERNAME_TAKEN',
      from: buildFromProfile(profile),
      payload: { checkId, username },
      timestamp: Date.now()
    });
    return;
  }

  if (msg.type === 'USERNAME_TAKEN') {
    // Handled by listeners (see checkUsernameAvailability).
    return;
  }

  if (msg.type === 'USERNAME_REGISTERED') {
    const username = msg.payload?.username;
    const peerId = msg.payload?.peerId;
    const registeredAt = msg.payload?.registeredAt;
    if (typeof username !== 'string' || username.trim().length === 0) return;
    if (typeof peerId !== 'string' || peerId.length === 0) return;
    if (typeof registeredAt !== 'number') return;

    await registerUsernameLocally({
      username,
      peerId,
      registeredAt,
      lastSeenAt: Date.now()
    });
    return;
  }

  if (msg.type === 'STATE_DIGEST') {
    const latestRemote = Number(msg.payload?.latestGlobalMsgTimestamp ?? 0);
    const remoteRegistryCount = Number(msg.payload?.usernameRegistryCount ?? 0);

    const myLatest = await db.globalMessages.orderBy('timestamp').last();
    const myCount = await db.usernameRegistry.count();

    if ((myLatest?.timestamp ?? 0) < latestRemote || myCount < remoteRegistryCount) {
      const knownUsernames = await getKnownUsernamesList();
      sendToPeer(msg.from.peerId, {
        type: 'SYNC_REQUEST',
        from: buildFromProfile(profile),
        payload: {
          sinceTimestamp: myLatest?.timestamp ?? 0,
          knownUsernames
        },
        timestamp: Date.now()
      });
    }
    return;
  }

  if (msg.type === 'SYNC_REQUEST') {
    const sinceTimestamp = Number(msg.payload?.sinceTimestamp ?? 0);
    const knownUsernames = Array.isArray(msg.payload?.knownUsernames) ? msg.payload.knownUsernames : [];

    const [newMessages, fullRegistry] = await Promise.all([
      db.globalMessages.where('timestamp').above(sinceTimestamp).toArray(),
      getFullUsernameRegistry()
    ]);
    const known = new Set(knownUsernames);
    const registryEntries = fullRegistry.filter((e) => !known.has(e.username));

    sendToPeer(msg.from.peerId, {
      type: 'SYNC_RESPONSE',
      from: buildFromProfile(profile),
      payload: { newMessages, registryEntries },
      timestamp: Date.now()
    });
    return;
  }

  if (msg.type === 'SYNC_RESPONSE') {
    const newMessages = Array.isArray(msg.payload?.newMessages) ? msg.payload.newMessages : [];
    const registryEntries = Array.isArray(msg.payload?.registryEntries) ? msg.payload.registryEntries : [];

    try {
      await db.transaction('rw', db.globalMessages, async () => {
        for (const m of newMessages) {
          if (!m || typeof m !== 'object') continue;
          await db.globalMessages.put(m);
        }
      });
    } catch (err) {
      console.error('SYNC_RESPONSE merge messages failed', err);
    }

    await mergeUsernameRegistry(registryEntries);

    try {
      const allMessages = await getGlobalMessages(100);
      globalMessagesStore.set(allMessages);
    } catch (err) {
      console.error('SYNC_RESPONSE refresh store failed', err);
    }
    peerStore.update((s) => ({ ...s, lastSyncAt: Date.now() }));
    return;
  }

  if (msg.type === 'PEER_DISCONNECT') {
    const disconnectedPeerId = msg.from.peerId;
    const wasLobbyHost = disconnectedPeerId && disconnectedPeerId === get(peerStore).currentLobbyHostId;

    setChatOnlineStatus(disconnectedPeerId, false);
    await saveKnownPeer({ username: msg.from.username, peerId: disconnectedPeerId, lastSeen: msg.timestamp ?? Date.now() });
    removeConnectedPeer(disconnectedPeerId);

    if (wasLobbyHost) {
      // Give the elected peer a moment to claim the lobby ID before we try.
      setTimeout(electNewLobbyHost, 2000);
    }
    return;
  }

  if (msg.type === 'GLOBAL_MSG') {
    // Back-compat: accept `{ text }`, but prefer `{ message }` so we can dedupe by UUID.
    const incoming = msg.payload?.message;
    const text = typeof incoming?.text === 'string' ? incoming.text : msg.payload?.text;
    if (typeof text !== 'string' || text.trim().length === 0) return;

    const incomingId = incoming?.id;
    const messageId =
      typeof incomingId === 'string' && incomingId.length > 0
        ? incomingId
        : globalThis.crypto?.randomUUID
          ? globalThis.crypto.randomUUID()
          : `m-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    await addGlobalMessage({
      id: messageId,
      peerId: msg.from.peerId,
      username: msg.from.username,
      age: msg.from.age,
      color: msg.from.color,
      avatarBase64: get(avatarCache).get(msg.from.peerId) ?? null,
      text: text.trim(),
      timestamp: typeof incoming?.timestamp === 'number' ? incoming.timestamp : msg.timestamp
    });
    return;
  }

  if (msg.type === 'PRIVATE_KEY_EXCHANGE') {
	    const myPeerId = get(peerStore).peerId;
	    if (!myPeerId) return;
		    if (msg.to !== myPeerId) return;
		    const theirPeerId = remotePeerId;
		    const myUsername = profile?.username ?? null;
	    const theirUsername = msg.from.username;
    if (!myUsername || myUsername === 'pre-registration') return;
    if (!theirUsername) return;

    const publicKeyBase64 = msg.payload?.publicKeyBase64;
    if (typeof publicKeyBase64 !== 'string' || publicKeyBase64.length === 0) return;

    const chatId = buildSessionId(myUsername, theirUsername);
    clearKeyExchangeTimeout(chatId);
    setKeyExchangeState(chatId, 'completing');

    let ourPublicKeyBase64;
    try {
      ({ publicKeyBase64: ourPublicKeyBase64 } = await completeSession(myUsername, theirUsername, publicKeyBase64));
    } catch (err) {
      console.error('completeSession (responder) failed', err);
      setKeyExchangeState(chatId, 'failed');
      return;
    }

    const cachedAvatar =
      get(avatarCache).get(theirPeerId) ?? get(peerStore).connectedPeers.get(theirPeerId)?.avatarBase64 ?? null;

    const now = Date.now();
    const existing = await getPrivateChat(chatId);
    await upsertPrivateChat({
      ...(existing ?? {}),
      id: chatId,
      myPeerId,
      myUsername,
      theirPeerId,
      theirUsername,
      theirColor: msg.from.color,
      theirAvatarBase64: cachedAvatar,
      theirAge: msg.from.age,
      createdAt: existing?.createdAt ?? now,
      lastActivity: now,
      lastMessagePreview: existing?.lastMessagePreview ?? null,
      unreadCount: typeof existing?.unreadCount === 'number' ? existing.unreadCount : 0
    });

    upsertChatEntry({
      id: chatId,
      theirPeerId,
      theirUsername: msg.from.username,
      theirColor: msg.from.color,
      theirAvatarBase64: cachedAvatar,
      theirAge: msg.from.age,
      lastActivity: now,
      keyExchangeState: 'completing',
      isOnline: true
    });

    // Only registered peers should accept private chats.
    const selfProfile = userProfileRef ?? cachedProfile;
    if (!selfProfile || selfProfile.username === 'pre-registration') {
      setKeyExchangeState(chatId, 'failed');
      return;
    }

    sendToPeer(
      theirPeerId,
      buildDirectMessage('PRIVATE_KEY_EXCHANGE_ACK', myPeerId, selfProfile, theirPeerId, { publicKeyBase64: ourPublicKeyBase64 })
    );
    setKeyExchangeState(chatId, 'active');
    await decryptSealedMessages(chatId, chatId);
    await flushQueueForPeer(theirPeerId);
    return;
  }

	  if (msg.type === 'PRIVATE_KEY_EXCHANGE_ACK') {
	    const myPeerId = get(peerStore).peerId;
	    if (!myPeerId) return;
	    if (msg.to !== myPeerId) return;

	    const theirPeerId = remotePeerId;
	    const myUsername = profile?.username ?? null;
	    const theirUsername = msg.from.username;
    if (!myUsername || myUsername === 'pre-registration') return;
    if (!theirUsername) return;
    const publicKeyBase64 = msg.payload?.publicKeyBase64;
    if (typeof publicKeyBase64 !== 'string' || publicKeyBase64.length === 0) return;

    const chatId = buildSessionId(myUsername, theirUsername);
    clearKeyExchangeTimeout(chatId);
    try {
      await completeSession(myUsername, theirUsername, publicKeyBase64);
    } catch (err) {
      console.error('completeSession (initiator) failed', err);
      setKeyExchangeState(chatId, 'failed');
      return;
    }
    setKeyExchangeState(chatId, 'active');
    await decryptSealedMessages(chatId, chatId);
    await flushQueueForPeer(theirPeerId);
    return;
  }

	  if (msg.type === 'PRIVATE_MSG') {
	    const myPeerId = get(peerStore).peerId;
	    if (!myPeerId) return;
	    if (msg.to !== myPeerId) return;

	    const theirPeerId = remotePeerId;
	    const myUsername = profile?.username ?? null;
	    const theirUsername = msg.from.username;
    if (!myUsername || myUsername === 'pre-registration') return;
    if (!theirUsername) return;
    const ciphertext = msg.payload?.ciphertext;
    const iv = msg.payload?.iv;
    const messageId = msg.payload?.messageId;
    if (typeof ciphertext !== 'string' || typeof iv !== 'string') return;
    if (typeof messageId !== 'string' || messageId.length === 0) return;

    const chatId = buildSessionId(myUsername, theirUsername);
    const cachedAvatar =
      get(avatarCache).get(theirPeerId) ?? get(peerStore).connectedPeers.get(theirPeerId)?.avatarBase64 ?? null;

    // Ensure chat exists in DB/store.
    const now = Date.now();
    const existing = await getPrivateChat(chatId);
    await upsertPrivateChat({
      ...(existing ?? {}),
      id: chatId,
      myPeerId,
      myUsername,
      theirPeerId,
      theirUsername,
      theirColor: msg.from.color,
      theirAvatarBase64: cachedAvatar,
      theirAge: msg.from.age,
      createdAt: existing?.createdAt ?? now,
      lastActivity: msg.timestamp ?? now,
      lastMessagePreview: existing?.lastMessagePreview ?? null,
      unreadCount: typeof existing?.unreadCount === 'number' ? existing.unreadCount : 0
    });

    upsertChatEntry({
      id: chatId,
      theirPeerId,
      theirUsername: msg.from.username,
      theirColor: msg.from.color,
      theirAvatarBase64: cachedAvatar,
      theirAge: msg.from.age,
      lastActivity: msg.timestamp ?? now
    });

    let sealed = true;
    /** @type {string|null} */
    let text = null;
    if (isSessionActive(chatId)) {
      try {
        text = await decryptForSession(chatId, ciphertext, iv);
        sealed = false;
      } catch {
        // keep placeholder
      }
    }

    try {
      await saveEncryptedPrivateMessage({
        id: messageId,
        chatId,
        direction: 'received',
        ciphertext,
        iv,
        timestamp: msg.timestamp ?? now,
        delivered: true
      });
    } catch (err) {
      console.error('savePrivateMessage failed', err);
    }

    addIncomingMessage(chatId, { id: messageId, text, ciphertext, iv, sealed, timestamp: msg.timestamp ?? now });

    try {
      // Persist a best-effort preview + unread count so it survives reload.
      const currentUnread = get(privateChatStore).chats.get(chatId)?.unreadCount ?? 0;
      await updateChatMeta(chatId, {
        lastMessagePreview: typeof text === 'string' ? text.slice(0, 40) : null,
        lastActivity: msg.timestamp ?? now,
        unreadCount: currentUnread
      });
    } catch (err) {
      console.error('updateChatMeta failed', err);
    }

    sendToPeer(
      theirPeerId,
      buildDirectMessage('PRIVATE_MSG_ACK', myPeerId, profile, theirPeerId, { messageId }, Date.now())
    );
    return;
  }

  if (msg.type === 'PRIVATE_MSG_ACK') {
    const myPeerId = get(peerStore).peerId;
    if (!myPeerId) return;
    if (msg.to !== myPeerId) return;

    const myUsername = profile?.username ?? null;
    const theirUsername = msg.from.username;
    if (!myUsername || myUsername === 'pre-registration') return;
    if (!theirUsername) return;
    const messageId = msg.payload?.messageId;
    if (typeof messageId !== 'string' || messageId.length === 0) return;

    const chatId = buildSessionId(myUsername, theirUsername);
    markDelivered(chatId, messageId);
    try {
      await markMessageDelivered(messageId);
    } catch (err) {
      console.error('markMessageDelivered failed', err);
    }
    return;
  }

  if (msg.type === 'PRIVATE_CHAT_CLOSED') {
    const myPeerId = get(peerStore).peerId;
    if (!myPeerId) return;
    if (msg.to !== myPeerId) return;

    const chatId = msg.payload?.chatId;
    if (typeof chatId !== 'string' || chatId.length === 0) return;
    const sysId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `sys-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    addIncomingMessage(chatId, {
      id: sysId,
      text: `${msg.from.username} has cleared this conversation on their end.`,
      timestamp: msg.timestamp ?? Date.now()
    });
    return;
  }
}

export async function initPeer(profile) {
  try {
    // Keep profile references set synchronously so UI actions can always access them.
    // `userProfileRef` may be null during pre-registration.
    userProfileRef = profile ?? null;
    cachedProfile =
      profile && profile.username
        ? profile
        : { username: 'pre-registration', color: 'hsl(0, 0%, 70%)', age: 0, avatarBase64: null, createdAt: Date.now() };
    setConnectionState('connecting', { error: null, reconnectAttempt: 0 });

    // If the peer already exists (e.g. we connected pre-registration), update cached profile
    // and refresh our handshake so remote peers learn our final username/avatar.
	    if (mainPeer && !mainPeer.destroyed) {
	      const shouldRefresh = Boolean(profile?.createdAt) && profile?.username && profile.username !== 'pre-registration';
	      if (shouldRefresh) {
	        const state = get(peerStore);
	        for (const entry of state.connectedPeers.values()) {
	          sendHandshake(entry.connection, profile).catch((err) => console.error('refresh handshake failed', err));
	        }
	      }
	      return mainPeer;
	    }
    if (mainPeer?.destroyed) {
      mainPeer = null;
      localPeerRef = null;
    }

    const Peer = await ensurePeerCtor();

    // Keep PeerJS internal logs quiet in prod; allow some verbosity in dev.
    const debug = import.meta.env?.DEV ? 2 : 0;

    // IMPORTANT: Do not request a specific PeerJS ID on load.
    // Some browsers keep the old websocket alive briefly on refresh, and requesting any explicit ID
    // can get stuck in "unavailable-id" loops. Let the server assign a free ID each time.
    if (forcedPeerId) {
      mainPeer = new Peer(forcedPeerId, { ...PEERJS_CONFIG, debug });
      forcedPeerId = null;
    } else {
      mainPeer = new Peer({ ...PEERJS_CONFIG, debug });
    }

    const thisPeer = mainPeer;
    localPeerRef = mainPeer;
    // PeerJS ID is only known after 'open'. Clear stale IDs immediately to avoid UI/DB using an old value.
    peerStore.update((s) => ({ ...s, peerId: null }));

    if (typeof window !== 'undefined' && !unloadHookInstalled) {
      unloadHookInstalled = true;
      const cleanup = () => {
        try {
          localPeerRef?.destroy?.();
        } catch {
          // ignore
        }
        try {
          lobbyPeer?.destroy?.();
        } catch {
          // ignore
        }
      };

      // `pagehide` fires more reliably than `beforeunload` on mobile and some browsers.
      window.addEventListener('pagehide', cleanup, { once: true });
      window.addEventListener('beforeunload', cleanup, { once: true });
    }

    mainPeer.on('open', (id) => {
      if (localPeerRef !== thisPeer) return; // stale peer instance
      unavailableIdAttempts = 0;
      if (unavailableIdRetryTimer) {
        clearTimeout(unavailableIdRetryTimer);
        unavailableIdRetryTimer = null;
      }
      reconnectAttempts = 0;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
	      peerStore.update((s) => ({
	        ...s,
	        peerId: id,
	        isConnected: true,
	        error: null,
	        reconnectAttempt: 0
	      }));
      // Register ourselves in the local username registry (for offline uniqueness checks).
      const shouldRegisterLocally = Boolean(profile?.createdAt) && Boolean(profile?.username) && profile.username !== 'pre-registration';
      if (shouldRegisterLocally) {
        registerUsernameLocally({
          username: profile.username,
          peerId: id,
          registeredAt: profile.createdAt,
          lastSeenAt: Date.now()
        }).catch((err) => console.error('registerUsernameLocally failed', err));
      }
		      (async () => {
		        const res = await joinLobby(mainPeer, cachedProfile);
	        if (res.role === 'guest') {
	          setConnectionState('syncing', { isConnected: true, isLobbyHost: false });
	        } else if (res.role === 'host') {
	          setConnectionState('connected', { isConnected: true, isLobbyHost: true, currentLobbyHostId: id });
	        } else {
	          setConnectionState('standalone', { isConnected: true, isLobbyHost: false });
	        }

		        await reconnectToKnownPeers(cachedProfile);
		        // Retry reconnect a couple times if we have no mesh links yet (common after refresh).
		        const retryDelays = [1500, 3500];
		        for (const d of retryDelays) {
		          setTimeout(() => {
		            try {
		              const st = get(peerStore);
		              const hasOpen = [...st.connectedPeers.values()].some((e) => e.connection?.open !== false);
		              if (!hasOpen) void reconnectToKnownPeers(cachedProfile);
		            } catch {
		              // ignore
		            }
		          }, d);
		        }
		        startHeartbeat(cachedProfile);
		        startGossipInterval(cachedProfile);

	        // Presence announce after reconnect so peers refresh stale status + connections.
	        if (cachedProfile?.username && cachedProfile.username !== 'pre-registration') {
	          setTimeout(() => announcePresence(cachedProfile), 1000);
	        }
	      })().catch((err) => console.error('joinLobby failed', err));
	    });

		    mainPeer.on('connection', (conn) => {
		      if (localPeerRef !== thisPeer) return; // stale peer instance
		      handleIncomingConnection(conn, cachedProfile);
		    });

		    mainPeer.on('error', (err) => {
		      if (localPeerRef !== thisPeer) return; // stale peer instance
		      switch (err?.type) {
	        case 'peer-unavailable':
	          // Expected: lobby not found -> host election logic handles this on the connection error path.
	          return;
        case 'unavailable-id': {
          // PeerJS refused our requested ID. IDs are ephemeral; rotate immediately and retry with backoff.
          console.error('PeerJS error:', err?.type, err?.message);
          if (unavailableIdAttempts >= UNAVAILABLE_ID_RETRY_DELAYS_MS.length) {
            peerStore.update((s) => ({ ...s, error: err?.type ?? 'peer-error', connectionState: 'failed' }));
            return;
          }
          const delay = UNAVAILABLE_ID_RETRY_DELAYS_MS[unavailableIdAttempts] ?? 500;
          unavailableIdAttempts += 1;
          // Retry without forcing an ID so the server can pick a free one.
          forcedPeerId = null;
          peerStore.update((s) => ({ ...s, connectionState: 'reconnecting', isConnected: false, error: null }));

			          // Avoid concurrent retry timers (multiple error events can fire per failure).
			          if (unavailableIdRetryTimer) {
			            clearTimeout(unavailableIdRetryTimer);
			            unavailableIdRetryTimer = null;
			          }
			          if (reconnectTimer) {
			            clearTimeout(reconnectTimer);
			            reconnectTimer = null;
			          }
			          try {
			            mainPeer?.destroy?.();
			          } catch {
			            // ignore
			          }
			          mainPeer = null;
			          localPeerRef = null;
			          unavailableIdRetryTimer = setTimeout(() => {
			            unavailableIdRetryTimer = null;
			            initPeer(userProfileRef ?? cachedProfile).catch((e) =>
			              console.error('retry initPeer after unavailable-id failed', e)
			            );
			          }, delay);
			          return;
			        }
	        case 'disconnected':
	          // Peer cannot open new connections while disconnected from the PeerJS server.
	          console.error('PeerJS error:', err?.type, err?.message);
	          void handlePeerDisconnect();
	          return;
	        case 'network':
	        case 'server-error':
	        case 'socket-error':
	        case 'socket-closed':
	          console.error('PeerJS error:', err?.type, err?.message);
          void handlePeerDisconnect();
          return;
        case 'browser-incompatible':
        case 'ssl-unavailable':
        case 'invalid-id':
        case 'invalid-key':
          console.error('PeerJS error:', err?.type, err?.message);
          peerStore.update((s) => ({ ...s, connectionState: 'failed' }));
          return;
        default:
          // When we're the first peer, connecting to the lobby ID is expected to fail.
          if (isLobbyUnavailableError(err)) return;
          console.error('PeerJS error:', err?.type, err?.message);
          console.warn('Unhandled PeerJS error type:', err?.type);
          peerStore.update((s) => ({ ...s, error: err?.type ?? 'peer-error' }));
      }
    });

    mainPeer.on('disconnected', () => {
      if (localPeerRef !== thisPeer) return; // stale peer instance
      peerStore.update((s) => ({ ...s, connectionState: 'reconnecting' }));
      void handlePeerDisconnect();
    });

    return mainPeer;
  } catch (err) {
    console.error('initPeer failed', err);
    peerStore.update((s) => ({ ...s, error: 'init-failed', connectionState: 'failed' }));
    throw err;
  }
}

// Back-compat export: delegate to the new state-checked handler.
export async function attemptReconnect() {
  await handlePeerDisconnect();
}

export async function broadcastGlobalMessage(text, profile) {
  const state = get(peerStore);
  const id = state.peerId;
  if (!id) return;

  const trimmed = String(text ?? '').trim();
  if (!trimmed) return;

  const msgId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `m-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const timestamp = Date.now();

  const message = {
    id: msgId,
    peerId: id,
    username: profile.username,
    age: profile.age,
    color: profile.color,
    text: trimmed,
    timestamp
  };

  const localMessage = { ...message, avatarBase64: profile.avatarBase64 ?? null };
  const envelope = buildMessage('GLOBAL_MSG', id, profile, { message }, timestamp);

  // Optimistic update.
  await addGlobalMessage(localMessage);

  const stateAfter = get(peerStore);
  const hasOpenPeer = [...stateAfter.connectedPeers.values()].some((e) => e.connection?.open !== false);
  if (!hasOpenPeer) {
    // No open peers yet (still connecting/reconnecting). Queue and flush when a peer connects.
    pendingGlobalOutbox.set(msgId, envelope);
    return;
  }

  for (const entry of stateAfter.connectedPeers.values()) {
    safeSend(entry.connection, envelope);
  }
}

/**
 * Broadcast a one-time username registration event so all peers can update their local registry.
 * Note: in a fully decentralized system, simultaneous registrations can still conflict in rare races.
 * @param {UserProfile} profile
 */
export function broadcastUsernameRegistered(profile) {
  const state = get(peerStore);
  const id = state.peerId;
  if (!id) return;
  if (!profile?.username) return;

  broadcastToAll({
    type: 'USERNAME_REGISTERED',
    from: buildFromProfile(profile),
    payload: {
      username: profile.username,
      peerId: id,
      registeredAt: profile.createdAt ?? Date.now()
    },
    timestamp: Date.now()
  });
}

export async function initiatePrivateChat(theirPeerId, theirUsername, theirColor, theirAvatarBase64) {
  const state = get(peerStore);
  const myPeerId = state.peerId;
  const profile = userProfileRef ?? cachedProfile;

  if (!myPeerId || !state.isConnected) {
    console.warn('initiatePrivateChat: not connected yet');
    return;
  }
  if (!theirPeerId) {
    console.warn('initiatePrivateChat: missing target peer id');
    return;
  }
  if (!profile) {
    console.warn('initiatePrivateChat: missing user profile');
    return;
  }
  if (!profile.username || profile.username === 'pre-registration') {
    console.warn('initiatePrivateChat: user not registered');
    return;
  }

  // Always switch to the private tab first so UI never feels unresponsive.
  activeTab.set('private');

  const chatId = buildSessionId(profile.username, theirUsername);
  const now = Date.now();

  // Ensure chat exists in store/DB (important after reload).
  const storeState = get(privateChatStore);
  const existingChat = storeState.chats.get(chatId) ?? null;

  if (!existingChat) {
    let existingDbChat = null;
    try {
      existingDbChat = await getPrivateChat(chatId);
    } catch (err) {
      console.error('getPrivateChat failed', err);
    }

    if (existingDbChat) {
      upsertChatEntry({
        id: existingDbChat.id,
        theirPeerId: existingDbChat.theirPeerId,
        theirUsername: existingDbChat.theirUsername,
        theirColor: existingDbChat.theirColor,
        theirAvatarBase64: existingDbChat.theirAvatarBase64 ?? null,
        lastActivity: existingDbChat.lastActivity ?? now,
        keyExchangeState: 'idle',
        isOnline: state.connectedPeers.has(theirPeerId)
      });
    } else {
      await upsertPrivateChat({
        id: chatId,
        myPeerId,
        myUsername: profile.username,
        theirPeerId,
        theirUsername,
        theirColor,
        theirAvatarBase64: theirAvatarBase64 ?? null,
        createdAt: now,
        lastActivity: now,
        lastMessagePreview: null,
        unreadCount: 0
      });

      upsertChatEntry({
        id: chatId,
        theirPeerId,
        theirUsername,
        theirColor,
        theirAvatarBase64: theirAvatarBase64 ?? null,
        lastActivity: now,
        keyExchangeState: 'idle',
        isOnline: state.connectedPeers.has(theirPeerId)
      });
    }
  }

  openChat(chatId);
  setChatOnlineStatus(theirPeerId, state.connectedPeers.has(theirPeerId));

  // If the session is already active, nothing else to do.
  if (isSessionActive(chatId)) {
    setKeyExchangeState(chatId, 'active');
    return;
  }

  // If the target peer isn't currently connected, defer key exchange until they reconnect.
  const peerConn = state.connectedPeers.get(theirPeerId)?.connection ?? null;
  if (!peerConn || peerConn.open === false) {
    setKeyExchangeState(chatId, 'idle');
    return;
  }

  setKeyExchangeState(chatId, 'initiated');
  try {
    const { publicKeyBase64 } = await createSession(profile.username, theirUsername);
    startKeyExchangeTimeout(chatId);
    sendToPeer(theirPeerId, buildDirectMessage('PRIVATE_KEY_EXCHANGE', myPeerId, profile, theirPeerId, { publicKeyBase64 }, now));
  } catch (err) {
    console.error('initiatePrivateChat key exchange failed', err);
    clearKeyExchangeTimeout(chatId);
    setKeyExchangeState(chatId, 'failed');
  }
}

export async function sendPrivateMessage(chatId, theirPeerId, plaintext) {
  const state = get(peerStore);
  const myPeerId = state.peerId;
  const profile = userProfileRef ?? cachedProfile;
  const cid = String(chatId ?? '').trim();
  if (!cid) {
    console.warn('sendPrivateMessage: missing chat id');
    return;
  }
  if (!theirPeerId) {
    console.warn('sendPrivateMessage: missing target peer id');
    return;
  }
  if (!profile) {
    console.warn('sendPrivateMessage: missing user profile');
    return;
  }
  if (!myPeerId) {
    console.warn('sendPrivateMessage: peer not initialized');
    return;
  }
  if (!profile.username || profile.username === 'pre-registration') {
    console.warn('sendPrivateMessage: user not registered');
    return;
  }

  const trimmed = String(plaintext ?? '').trim();
  if (!trimmed) return;

  // chatId/sessionId is derived from usernames, not PeerJS IDs.
  const messageId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `pm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const timestamp = Date.now();

  // Optimistic UI: show the plaintext immediately.
  addOutgoingMessage(cid, { id: messageId, text: trimmed, timestamp });

  const sessionActive = isSessionActive(cid);
  const peerOnline = state.connectedPeers.get(theirPeerId)?.connection?.open === true;

  if (sessionActive && peerOnline) {
    // Encrypt and send immediately.
    const { ciphertext, iv } = await encryptForSession(cid, trimmed);
    await saveEncryptedPrivateMessage({
      id: messageId,
      chatId: cid,
      direction: 'sent',
      ciphertext,
      iv,
      timestamp,
      delivered: false
    });
    await saveSentMessagePlaintext({ id: messageId, chatId: cid, plaintext: trimmed, timestamp });

    updateChatMeta(cid, { lastMessagePreview: trimmed.slice(0, 40), lastActivity: timestamp }).catch((err) =>
      console.error('updateChatMeta failed', err)
    );

    sendToPeer(theirPeerId, buildDirectMessage('PRIVATE_MSG', myPeerId, profile, theirPeerId, { ciphertext, iv, messageId }, timestamp));
    return;
  }

  // Queue path: persist plaintext locally and mark message as queued in the UI.
  try {
    await saveQueuedMessage({ id: messageId, chatId: cid, theirPeerId, plaintext: trimmed, timestamp });
    updateMessageQueued(cid, messageId, true);
  } catch (err) {
    console.error('saveQueuedMessage failed', err);
  }

  updateChatMeta(cid, { lastMessagePreview: trimmed.slice(0, 40), lastActivity: timestamp }).catch((err) =>
    console.error('updateChatMeta failed', err)
  );

  // If they're online but we don't have a session yet, initiate key exchange so the queue can flush.
  if (peerOnline) {
    void flushQueueForPeer(theirPeerId);
  }
}

export async function closePrivateChat(chatIdOrTheirPeerId) {
  const state = get(peerStore);
  const myPeerId = state.peerId;
  const rawValue = chatIdOrTheirPeerId;
  const rawStr = String(chatIdOrTheirPeerId ?? '').trim();
  if (!rawStr) return;

  // Local deletion must work even if PeerJS is still initializing/offline.
  // Prefer deleting by the actual chatId (stable, persisted) rather than recomputing it
  // from the current peerId (which may differ if the user hit an unavailable-id flow).
  /** @type {any|null} */
  let chatId = null;
  /** @type {string|null|undefined} */
  let theirPeerId;

  // 1) Treat input as a chatId if it matches an in-memory chat (supports legacy numeric IDs too).
  try {
    const storeChats = get(privateChatStore).chats;
    if (storeChats?.has?.(rawValue)) {
      const entry = storeChats.get(rawValue);
      chatId = rawValue;
      theirPeerId = entry?.theirPeerId ?? null;
    } else if (storeChats?.has?.(rawStr)) {
      const entry = storeChats.get(rawStr);
      chatId = rawStr;
      theirPeerId = entry?.theirPeerId ?? null;
    }
  } catch {
    // ignore
  }

  // 2) Treat input as a chatId if it exists in IndexedDB.
  if (!chatId) {
    try {
      const dbChat = await getPrivateChat(rawStr);
      if (dbChat) {
        chatId = rawStr;
        theirPeerId = dbChat?.theirPeerId ?? null;
      }
    } catch {
      // ignore
    }
  }
  if (!chatId) {
    // Legacy numeric chat IDs: attempt number lookup as a last resort.
    const maybeNum = Number(rawStr);
    if (Number.isFinite(maybeNum)) {
      try {
        const dbChat = await getPrivateChat(maybeNum);
        if (dbChat) {
          chatId = maybeNum;
          theirPeerId = dbChat?.theirPeerId ?? null;
        }
      } catch {
        // ignore
      }
    }
  }

  // 3) Fallback: treat input as theirPeerId and locate the chat by that.
  if (!chatId) {
    theirPeerId = rawStr;
    try {
      for (const [id, chat] of get(privateChatStore).chats.entries()) {
        if (chat?.theirPeerId === theirPeerId) {
          chatId = id;
          break;
        }
      }
    } catch {
      // ignore
    }
    if (!chatId) {
      try {
        const row = await db.privateChats.where('theirPeerId').equals(theirPeerId).first();
        if (row?.id) chatId = row.id;
      } catch {
        // ignore
      }
    }
  }
  if (!chatId) return;

  await deleteChatFromStore(chatId);

  // Best-effort remote notification (only if we have enough state to send).
  if (myPeerId && cachedProfile && theirPeerId && state.connectedPeers.has(theirPeerId)) {
    sendToPeer(theirPeerId, buildDirectMessage('PRIVATE_CHAT_CLOSED', myPeerId, cachedProfile, theirPeerId, { chatId }, Date.now()));
  }
}

export function disconnectPeer() {
  const state = get(peerStore);
  const id = state.peerId;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;

  if (gossipIntervalId) {
    clearInterval(gossipIntervalId);
    gossipIntervalId = null;
  }
  stopHeartbeat();
  for (const timeoutId of keyExchangeTimeouts.values()) clearTimeout(timeoutId);
  keyExchangeTimeouts.clear();

  if (id && cachedProfile) {
    const msg = buildMessage('PEER_DISCONNECT', id, cachedProfile, {});
    for (const entry of state.connectedPeers.values()) safeSend(entry.connection, msg);
  }

  for (const entry of state.connectedPeers.values()) safeClose(entry.connection);
  lobbyConnections.forEach((c) => safeClose(c));
  safeClose(lobbyConn);

  try {
    mainPeer?.destroy?.();
  } catch (err) {
    console.error('destroy main peer failed', err);
  }
  try {
    lobbyPeer?.destroy?.();
  } catch (err) {
    console.error('destroy lobby peer failed', err);
  }

  mainPeer = null;
  localPeerRef = null;
  lobbyPeer = null;
  lobbyConn = null;
  cachedProfile = null;
  userProfileRef = null;
  PeerCtor = null;

  closeAllSessions();
  remoteIdentityKeys.clear();
  lobbyConnections.clear();
  lobbyPeerList.clear();

  peerStore.set({
    peerId: null,
    isConnected: false,
    connectionState: 'offline',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    lobbyPeer: null,
    currentLobbyHostId: null,
    lastSyncAt: null,
    connectedPeers: new Map()
  });
}

// Test-only hooks (not part of the public app API).
export const __test = {
  setMainPeerForTest(p) {
    mainPeer = p;
  },
  setProfileForTest(p) {
    cachedProfile = p;
  },
  electNewLobbyHostForTest() {
    electNewLobbyHost();
  },
  resetRegistrySyncReadyForTest() {
    registrySyncReady = new Promise((resolve) => {
      registrySyncResolve = resolve;
    });
  },
  resolveRegistrySyncForTest(reason = 'test') {
    resolveRegistrySync(reason);
  },
  setLocalPeerRefForTest(p) {
    localPeerRef = p;
    mainPeer = p;
  },
  setUserProfileRefForTest(p) {
    userProfileRef = p;
    cachedProfile = p;
  },
  async handlePeerDisconnectForTest() {
    await handlePeerDisconnect();
  },
  getReconnectAttemptsForTest() {
    return reconnectAttempts;
  }
};
