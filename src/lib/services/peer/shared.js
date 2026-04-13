import { get, writable } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { privateChatStore, setKeyExchangeState } from '$lib/stores/privateChatStore.js';
import { ALLOWED_TYPES, REQUIRES_TO } from './config.js';

/**
 * @typedef {import('./types.js').MessageType} MessageType
 * @typedef {import('./types.js').UserProfile} UserProfile
 * @typedef {import('./types.js').ProtocolEnvelope} ProtocolEnvelope
 */

let registrySyncResolve = null;
export let registrySyncReady = new Promise((resolve) => {
  registrySyncResolve = resolve;
});

export function resolveRegistrySync(reason) {
  if (!registrySyncResolve) return;
  try {
    registrySyncResolve(reason);
  } finally {
    registrySyncResolve = null;
  }
}

export function resetRegistrySyncReadyForTest() {
  registrySyncReady = new Promise((resolve) => {
    registrySyncResolve = resolve;
  });
}

export const avatarCache = writable(new Map());

export function setCachedAvatar(peerId, avatarBase64) {
  if (!peerId || typeof avatarBase64 !== 'string' || avatarBase64.length === 0) return;
  // Base64 strings can be large; keep a hard cap to avoid blowing up memory from malformed payloads.
  if (avatarBase64.length > 750_000) return;
  avatarCache.update((cache) => {
    const next = new Map(cache);
    next.set(peerId, avatarBase64);
    return next;
  });
}

/** @type {any|null} */
export let PeerCtor = null;
/** @type {any|null} */
export let mainPeer = null;
export let localPeerRef = null;
/** @type {any|null} */
export let lobbyPeer = null;
/** @type {any|null} */
export let lobbyConn = null;
/** @type {string|null} */
export let activeLobbyId = null;
/** @type {UserProfile|null} */
export let cachedProfile = null;
export let userProfileRef = null;
// These are mutated by peer runtime modules; ESLint cannot see cross-module assignments.
// eslint-disable-next-line prefer-const
export let reconnectAttempts = 0;
// eslint-disable-next-line prefer-const
export let reconnectTimer = null;
// eslint-disable-next-line prefer-const
export let unavailableIdAttempts = 0;
// eslint-disable-next-line prefer-const
export let unavailableIdRetryTimer = null;
// eslint-disable-next-line prefer-const
export let unloadHookInstalled = false;
/** @type {string|null} */
// eslint-disable-next-line prefer-const
export let forcedPeerId = null;

export const setActiveLobbyId = (id) => { activeLobbyId = id; };
export const setPeerCtor = (ctor) => { PeerCtor = ctor; };
export const setMainPeer = (p) => { mainPeer = p; };
export function setLocalPeerRef(p) {
  localPeerRef = p;
  mainPeer = p;
}
export function setLobbyPeer(p) {
  lobbyPeer = p;
}
export function setLobbyConn(c) {
  lobbyConn = c;
}
export function setCachedProfile(p) {
  cachedProfile = p;
}
export function setUserProfileRef(p) {
  userProfileRef = p;
  cachedProfile = p;
}
/** @type {Map<string, string>} */
export const remoteIdentityKeys = new Map(); // peerId -> base64 public key (from HANDSHAKE/ACK)
/** @type {Map<string, any>} */
export const lobbyConnections = new Map(); // peerId -> DataConnection (to lobby peer)
/** @type {Map<string, { peerId: string, username: string, color: string, age: number }>} */
export const lobbyPeerList = new Map(); // peerId -> peer info (main peer IDs)
/** @type {Map<string, ProtocolEnvelope>} */
export const pendingGlobalOutbox = new Map(); // messageId -> envelope (flush when peers connect)
/** @type {Map<string, ProtocolEnvelope>} */
export const pendingGlobalActionOutbox = new Map(); // actionKey -> envelope (flush when peers connect)
export const keyExchangeTimeouts = new Map(); // chatId -> timeoutId

/** @type {Set<string>} */
export const confirmedPrivateSessions = new Set(); // chatId/sessionId

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

export function emitMessage(msg) {
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
 * @param {MessageType} type
 * @param {string} peerId
 * @param {UserProfile} profile
 * @param {any} payload
 * @returns {ProtocolEnvelope}
 */
export function buildMessage(type, peerId, profile, payload, timestamp = Date.now()) {
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

export function buildDirectMessage(type, peerId, profile, to, payload, timestamp = Date.now()) {
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
export function buildFromProfile(profile, peerIdOverride) {
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


export function setConnectionState(state, extra = {}) {
  peerStore.update((s) => ({ ...s, connectionState: state, ...extra }));
}

export function upsertConnectedPeer(peerId, conn, info) {
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

export function removeConnectedPeer(peerId) {
  peerStore.update((s) => {
    const next = new Map(s.connectedPeers);
    next.delete(peerId);
    return { ...s, connectedPeers: next };
  });
}


export function safeSend(conn, msg) {
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

export function safeClose(conn) {
  try {
    conn?.close?.();
  } catch (err) {
    console.error('Peer close failed', err);
  }
}

export function broadcastToAll(envelope) {
  const state = get(peerStore);
  for (const entry of state.connectedPeers.values()) safeSend(entry.connection, envelope);
}

export function sendToPeer(peerId, envelope) {
  const state = get(peerStore);
  const entry = state.connectedPeers.get(peerId);
  if (!entry) return;
  if (entry.connection?.open === false) return;
  safeSend(entry.connection, envelope);
}

export function flushGlobalOutbox() {
  const state = get(peerStore);
  const openPeers = [...state.connectedPeers.values()].filter((e) => e.connection?.open !== false);
  if (openPeers.length === 0) return;
  for (const [msgId, env] of pendingGlobalOutbox.entries()) {
    for (const entry of openPeers) safeSend(entry.connection, env);
    pendingGlobalOutbox.delete(msgId);
  }
  for (const [key, env] of pendingGlobalActionOutbox.entries()) {
    for (const entry of openPeers) safeSend(entry.connection, env);
    pendingGlobalActionOutbox.delete(key);
  }
}


export function isSessionKeyMismatch(err) {
  return err?.name === 'OperationError';
}

export function decryptFailurePlaceholder(err) {
  if (isSessionKeyMismatch(err)) return '🔒 Encrypted in a previous session';
  if (String(err?.message ?? '').includes('No active session')) return '🔒 Encrypted message (no active session)';
  return '🔒 Encrypted message (decryption error)';
}

export function isPrivateSessionConfirmed(chatId) {
  return confirmedPrivateSessions.has(String(chatId ?? '').trim());
}

export function confirmPrivateSession(chatId) {
  const id = String(chatId ?? '').trim();
  if (!id) return;
  confirmedPrivateSessions.add(id);
}

export function clearConfirmedSessionsForPeer(theirPeerId) {
  const pid = String(theirPeerId ?? '').trim();
  if (!pid) return;
  try {
    for (const [chatId, chat] of get(privateChatStore).chats.entries()) {
      if (chat?.theirPeerId === pid) confirmedPrivateSessions.delete(chatId);
    }
  } catch {
    // ignore
  }
}

export function startKeyExchangeTimeout(chatId) {
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

export function clearKeyExchangeTimeout(chatId) {
  const existing = keyExchangeTimeouts.get(chatId);
  if (existing) {
    clearTimeout(existing);
    keyExchangeTimeouts.delete(chatId);
  }
}
let handleMessageImpl = null;

export function setHandleMessageImpl(fn) {
  handleMessageImpl = fn;
}

export async function dispatchIncomingMessage(msg, fromConn, profile) {
  if (!handleMessageImpl) return;
  return await handleMessageImpl(msg, fromConn, profile);
}
let broadcastStateDigestImpl = null;

export function setBroadcastStateDigestImpl(fn) {
  broadcastStateDigestImpl = fn;
}

export async function broadcastStateDigestFromShared(profile) {
  if (!broadcastStateDigestImpl) return;
  return await broadcastStateDigestImpl(profile);
}

let electNewLobbyHostImpl = null;

export function setElectNewLobbyHostImpl(fn) {
  electNewLobbyHostImpl = fn;
}

export function electNewLobbyHostFromShared() {
  if (!electNewLobbyHostImpl) return;
  return electNewLobbyHostImpl();
}
