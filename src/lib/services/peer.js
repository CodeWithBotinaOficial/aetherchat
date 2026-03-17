import { get, writable } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { addGlobalMessage, globalMessages as globalMessagesStore } from '$lib/stores/chatStore.js';
import {
  db,
  getFullUsernameRegistry,
  getGlobalMessages,
  isUsernameTaken,
  mergeUsernameRegistry,
  registerUsernameLocally,
  saveKnownPeer
} from '$lib/services/db.js';
import {
  buildSessionId,
  closeAllSessions,
  closeSession,
  completeSession,
  createSession,
  decryptForSession,
  encryptForSession,
  exportPublicKey,
  generateKeyPair,
  isSessionActive
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
  upsertChatEntry
} from '$lib/stores/privateChatStore.js';
import { activeTab } from '$lib/stores/navigationStore.js';
import {
  getPrivateChat,
  markMessageDelivered,
  savePrivateMessage as saveEncryptedPrivateMessage,
  updateChatLastActivity,
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

const RECONNECT_DELAYS = [2000, 5000, 10000];
const MAX_RECONNECT_ATTEMPTS = 3;
const JOIN_LOBBY_TIMEOUT_MS = 6000;

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

let gossipIntervalId = null;

// In-memory offline queue (peerId -> ProtocolEnvelope[]). This is best-effort:
// queued payloads are already encrypted; if a new session key is negotiated before delivery,
// the recipient may be unable to decrypt and will see a locked placeholder.
const offlineMessageQueue = new Map();

let reconnectAttempts = 0;
let reconnectTimer = null;

async function handlePeerDisconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
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

function randomPeerId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    // ignore
  }
  return `peer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    (async () => {
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
    })().catch((err) => console.error('gossip tick failed', err));
  }, 30_000);
}

async function getKnownUsernamesList() {
  const entries = await getFullUsernameRegistry();
  return entries.map((e) => e.username);
}

function connectToPeer(peerId, profile) {
  if (!mainPeer) return null;
  if (!peerId || peerId === mainPeer.id) return null;

  const state = get(peerStore);
  if (state.connectedPeers.has(peerId)) return state.connectedPeers.get(peerId)?.connection ?? null;

  const conn = mainPeer.connect(peerId);
  handleIncomingConnection(conn, profile);
  return conn;
}

async function sendHandshake(conn, profile) {
  const id = get(peerStore).peerId;
  if (!id) return;
  const publicKey = await ensureLocalPublicKeyBase64();
  safeSend(conn, buildMessage('HANDSHAKE', id, profile, { publicKey, avatarBase64: profile.avatarBase64 }));
}

async function sendHandshakeAck(conn, profile) {
  const id = get(peerStore).peerId;
  if (!id) return;
  const publicKey = await ensureLocalPublicKeyBase64();
  safeSend(conn, buildMessage('HANDSHAKE_ACK', id, profile, { publicKey, avatarBase64: profile.avatarBase64 }));
}

function broadcastToAll(envelope) {
  const state = get(peerStore);
  for (const entry of state.connectedPeers.values()) safeSend(entry.connection, envelope);
}

function sendToPeer(peerId, envelope) {
  const state = get(peerStore);
  const entry = state.connectedPeers.get(peerId);
  if (!entry) return;
  safeSend(entry.connection, envelope);
}

function queueMessage(theirPeerId, envelope) {
  if (!theirPeerId || !envelope) return;
  const arr = offlineMessageQueue.get(theirPeerId) ?? [];
  arr.push(envelope);
  offlineMessageQueue.set(theirPeerId, arr);
}

export function flushQueueForPeer(theirPeerId) {
  const state = get(peerStore);
  if (!theirPeerId || !state.connectedPeers.has(theirPeerId)) return;
  const queued = offlineMessageQueue.get(theirPeerId) ?? [];
  for (const env of queued) sendToPeer(theirPeerId, env);
  offlineMessageQueue.delete(theirPeerId);
}

function getCurrentPeerList(profile) {
  const state = get(peerStore);
  const peers = [];
  if (state.peerId) peers.push({ peerId: state.peerId, username: profile.username, color: profile.color, age: profile.age });
  for (const [peerId, info] of state.connectedPeers.entries()) {
    peers.push({ peerId, username: info.username, color: info.color, age: info.age });
  }
  return peers;
}

async function setupLobbyHostHandlers(hostPeer, localPeer, profile) {
  // Track ourselves in the lobby's peer list.
  if (localPeer?.id) {
    lobbyPeerList.set(localPeer.id, { peerId: localPeer.id, username: profile.username, color: profile.color, age: profile.age });
  }

  hostPeer.on('connection', (conn) => {
    conn.on('data', (msg) => {
      (async () => {
        if (!validateProtocolMessage(msg)) return;
        if (msg.type !== 'LOBBY_JOIN') return;

        const newPeer = msg.from;
        lobbyPeerList.set(newPeer.peerId, { peerId: newPeer.peerId, username: newPeer.username, color: newPeer.color, age: newPeer.age });

        const [peerList, usernameRegistry, globalHistory] = await Promise.all([
          getCurrentPeerList(profile),
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
    // Attempt to connect to the existing lobby host.
    const conn = localPeer.connect(LOBBY_PEER_ID, {
      reliable: true,
      metadata: { type: 'lobby-join' }
    });

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
        from: buildFromProfile(profile, get(peerStore).peerId ?? localPeer.id),
        payload: {},
        timestamp: Date.now()
      });

      peerStore.update((s) => ({ ...s, isLobbyHost: false }));
      resolve({ role: 'guest', lobbyConn: conn });
    });

    conn.on('error', () => {
      clearTimeout(timeout);
      safeClose(conn);
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

  upsertConnectedPeer(remotePeerId, conn, null);

  conn.on('open', () => {
    (async () => {
      await sendHandshake(conn, profile);
      flushQueueForPeer(remotePeerId);
      setChatOnlineStatus(remotePeerId, true);

      // Auto-initiate key exchange for existing chats after reconnect (no UI side effects).
      const myPeerId = get(peerStore).peerId;
      if (!myPeerId) return;
      const chatId = buildSessionId(myPeerId, remotePeerId);
      const existingChat = get(privateChatStore).chats.get(chatId);
      if (!existingChat) return;
      if (existingChat.keyExchangeState !== 'idle') return;
      if (isSessionActive(chatId)) return;
      if (!userProfileRef) return;

      const { publicKeyBase64 } = await createSession(myPeerId, remotePeerId);
      setKeyExchangeState(chatId, 'initiated');
      sendToPeer(
        remotePeerId,
        buildDirectMessage('PRIVATE_KEY_EXCHANGE', myPeerId, userProfileRef, remotePeerId, { publicKeyBase64 }, Date.now())
      );
    })().catch((err) => console.error('sendHandshake failed', err));
  });

  conn.on('data', (data) => {
    (async () => {
      await handleMessage(data, conn, profile);
    })().catch((err) => console.error('handleMessage failed', err));
  });

  conn.on('close', () => {
    removeConnectedPeer(remotePeerId);
    // If we lost the current lobby host (main peer), attempt re-election.
    if (remotePeerId && remotePeerId === get(peerStore).currentLobbyHostId) {
      setTimeout(electNewLobbyHost, 2000);
    }
  });

  conn.on('error', (err) => {
    console.error('Peer connection error', err);
    removeConnectedPeer(remotePeerId);
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
  const state = get(peerStore);
  if (state.connectedPeers.has(pid)) return;
  connectToPeer(pid, profile);
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
    setChatOnlineStatus(remotePeerId, true);

    // Persist avatar for existing private chats so it survives reloads.
    if (avatarBase64) {
      const myPeerId = get(peerStore).peerId;
      if (myPeerId) {
        const chatId = buildSessionId(myPeerId, remotePeerId);
        const existing = await getPrivateChat(chatId);
        if (existing) {
          await upsertPrivateChat({ ...existing, theirAvatarBase64: avatarBase64 });
          upsertChatEntry({ id: chatId, theirAvatarBase64: avatarBase64 });
        }
      }
    }
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
    setChatOnlineStatus(remotePeerId, true);

    if (avatarBase64) {
      const myPeerId = get(peerStore).peerId;
      if (myPeerId) {
        const chatId = buildSessionId(myPeerId, remotePeerId);
        const existing = await getPrivateChat(chatId);
        if (existing) {
          await upsertPrivateChat({ ...existing, theirAvatarBase64: avatarBase64 });
          upsertChatEntry({ id: chatId, theirAvatarBase64: avatarBase64 });
        }
      }
    }
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

    const publicKeyBase64 = msg.payload?.publicKeyBase64;
    if (typeof publicKeyBase64 !== 'string' || publicKeyBase64.length === 0) return;

    const chatId = buildSessionId(myPeerId, theirPeerId);
    setKeyExchangeState(chatId, 'completing');

    const { publicKeyBase64: ourPublicKeyBase64 } = await completeSession(myPeerId, theirPeerId, publicKeyBase64);

    const cachedAvatar =
      get(avatarCache).get(theirPeerId) ?? get(peerStore).connectedPeers.get(theirPeerId)?.avatarBase64 ?? null;

    const now = Date.now();
    const existing = await getPrivateChat(chatId);
    await upsertPrivateChat({
      ...(existing ?? {}),
      id: chatId,
      myPeerId,
      theirPeerId,
      theirUsername: msg.from.username,
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

    sendToPeer(theirPeerId, buildDirectMessage('PRIVATE_KEY_EXCHANGE_ACK', myPeerId, profile, theirPeerId, { publicKeyBase64: ourPublicKeyBase64 }));
    setKeyExchangeState(chatId, 'active');
    await decryptSealedMessages(chatId, chatId);
    return;
  }

  if (msg.type === 'PRIVATE_KEY_EXCHANGE_ACK') {
    const myPeerId = get(peerStore).peerId;
    if (!myPeerId) return;
    if (msg.to !== myPeerId) return;

    const theirPeerId = remotePeerId;
    const publicKeyBase64 = msg.payload?.publicKeyBase64;
    if (typeof publicKeyBase64 !== 'string' || publicKeyBase64.length === 0) return;

    const chatId = buildSessionId(myPeerId, theirPeerId);
    await completeSession(myPeerId, theirPeerId, publicKeyBase64);
    setKeyExchangeState(chatId, 'active');
    flushQueueForPeer(theirPeerId);
    await decryptSealedMessages(chatId, chatId);
    return;
  }

  if (msg.type === 'PRIVATE_MSG') {
    const myPeerId = get(peerStore).peerId;
    if (!myPeerId) return;
    if (msg.to !== myPeerId) return;

    const theirPeerId = remotePeerId;
    const ciphertext = msg.payload?.ciphertext;
    const iv = msg.payload?.iv;
    const messageId = msg.payload?.messageId;
    if (typeof ciphertext !== 'string' || typeof iv !== 'string') return;
    if (typeof messageId !== 'string' || messageId.length === 0) return;

    const chatId = buildSessionId(myPeerId, theirPeerId);
    const cachedAvatar =
      get(avatarCache).get(theirPeerId) ?? get(peerStore).connectedPeers.get(theirPeerId)?.avatarBase64 ?? null;

    // Ensure chat exists in DB/store.
    const now = Date.now();
    const existing = await getPrivateChat(chatId);
    await upsertPrivateChat({
      ...(existing ?? {}),
      id: chatId,
      myPeerId,
      theirPeerId,
      theirUsername: msg.from.username,
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

    let text = '🔒 Encrypted message';
    if (isSessionActive(chatId)) {
      try {
        text = await decryptForSession(chatId, ciphertext, iv);
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

    addIncomingMessage(chatId, { id: messageId, text, timestamp: msg.timestamp ?? now });

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

    const theirPeerId = remotePeerId;
    const messageId = msg.payload?.messageId;
    if (typeof messageId !== 'string' || messageId.length === 0) return;

    const chatId = buildSessionId(myPeerId, theirPeerId);
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
    cachedProfile = profile;
    userProfileRef = profile;
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

    // Keep PeerJS internal logs quiet; use the in-app debug panel in dev instead (Phase 3).
    const debug = 0;

    const peerId = randomPeerId();
    mainPeer = new Peer(peerId, { ...PEERJS_CONFIG, debug });
    localPeerRef = mainPeer;

    mainPeer.on('open', (id) => {
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
        const res = await joinLobby(mainPeer, profile);
        if (res.role === 'guest') {
          setConnectionState('syncing', { isConnected: true, isLobbyHost: false });
        } else if (res.role === 'host') {
          setConnectionState('connected', { isConnected: true, isLobbyHost: true, currentLobbyHostId: id });
        } else {
          setConnectionState('standalone', { isConnected: true, isLobbyHost: false });
        }

        startGossipInterval(profile);
      })().catch((err) => console.error('joinLobby failed', err));
    });

    mainPeer.on('connection', (conn) => {
      handleIncomingConnection(conn, profile);
    });

    mainPeer.on('error', (err) => {
      console.error('PeerJS error:', err?.type, err?.message);

      switch (err?.type) {
        case 'peer-unavailable':
          // Expected: lobby not found -> host election logic handles this on the connection error path.
          return;
        case 'unavailable-id':
          // Expected: lobby ID race condition handled in becomeLobbyHost.
          return;
        case 'network':
        case 'server-error':
        case 'socket-error':
        case 'socket-closed':
          void handlePeerDisconnect();
          return;
        case 'browser-incompatible':
        case 'ssl-unavailable':
        case 'invalid-id':
        case 'invalid-key':
          peerStore.update((s) => ({ ...s, connectionState: 'failed' }));
          return;
        default:
          // When we're the first peer, connecting to the lobby ID is expected to fail.
          if (isLobbyUnavailableError(err)) return;
          console.warn('Unhandled PeerJS error type:', err?.type);
          peerStore.update((s) => ({ ...s, error: err?.type ?? 'peer-error' }));
      }
    });

    mainPeer.on('disconnected', () => {
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

  for (const entry of state.connectedPeers.values()) {
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

  // Always switch to the private tab first so UI never feels unresponsive.
  activeTab.set('private');

  const chatId = buildSessionId(myPeerId, theirPeerId);
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
  if (!state.connectedPeers.has(theirPeerId)) {
    setKeyExchangeState(chatId, 'idle');
    return;
  }

  setKeyExchangeState(chatId, 'initiated');
  const { publicKeyBase64 } = await createSession(myPeerId, theirPeerId);
  sendToPeer(theirPeerId, buildDirectMessage('PRIVATE_KEY_EXCHANGE', myPeerId, profile, theirPeerId, { publicKeyBase64 }, now));
}

export async function sendPrivateMessage(theirPeerId, plaintext) {
  const state = get(peerStore);
  const myPeerId = state.peerId;
  if (!myPeerId) throw new Error('Peer not initialized');
  if (!theirPeerId) throw new Error('Missing target peer id');
  if (!cachedProfile) throw new Error('Missing user profile');

  const trimmed = String(plaintext ?? '').trim();
  if (!trimmed) return;

  const chatId = buildSessionId(myPeerId, theirPeerId);
  if (!isSessionActive(chatId)) throw new Error('Encryption session is not active');

  const messageId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `pm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const timestamp = Date.now();

  const { ciphertext, iv } = await encryptForSession(chatId, trimmed);

  addOutgoingMessage(chatId, { id: messageId, text: trimmed, timestamp });

  await saveEncryptedPrivateMessage({
    id: messageId,
    chatId,
    direction: 'sent',
    ciphertext,
    iv,
    timestamp,
    delivered: false
  });

  try {
    await updateChatLastActivity(chatId, timestamp);
  } catch (err) {
    console.error('updateChatLastActivity failed', err);
  }

  const envelope = buildDirectMessage(
    'PRIVATE_MSG',
    myPeerId,
    cachedProfile,
    theirPeerId,
    { ciphertext, iv, messageId },
    timestamp
  );

  if (!state.connectedPeers.has(theirPeerId)) {
    queueMessage(theirPeerId, envelope);
    return;
  }

  sendToPeer(theirPeerId, envelope);
}

export async function closePrivateChat(theirPeerId) {
  const state = get(peerStore);
  const myPeerId = state.peerId;
  if (!myPeerId) return;
  if (!theirPeerId) return;
  if (!cachedProfile) return;

  const chatId = buildSessionId(myPeerId, theirPeerId);
  closeSession(chatId);

  await deleteChatFromStore(chatId);

  if (state.connectedPeers.has(theirPeerId)) {
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
  offlineMessageQueue.clear();
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
