import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { addGlobalMessage } from '$lib/stores/chatStore.js';
import { saveKnownPeer } from '$lib/services/db.js';
import {
  decryptMessage,
  deriveSharedSecret,
  encryptMessage,
  exportPublicKey,
  generateKeyPair,
  importPublicKey
} from '$lib/services/crypto.js';

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

/**
 * @typedef {'HANDSHAKE'|'HANDSHAKE_ACK'|'PEER_LIST'|'GLOBAL_MSG'|'PRIVATE_MSG'|'PRIVATE_KEY_EXCHANGE'|'USER_LIST'|'PEER_DISCONNECT'} MessageType
 */

/**
 * @typedef {Object} UserProfile
 * @property {string} username
 * @property {string} color
 * @property {number} age
 * @property {string} [avatarBase64]
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
/** @type {any|null} */
let lobbyPeer = null;
/** @type {any|null} */
let lobbyConn = null;

/** @type {UserProfile|null} */
let cachedProfile = null;

/** @type {Promise<{publicKey: CryptoKey, privateKey: CryptoKey}>|null} */
let localKeyPairPromise = null;
/** @type {Promise<string>|null} */
let localPublicKeyBase64Promise = null;

/** @type {Map<string, CryptoKey>} */
const sharedKeys = new Map(); // peerId -> AES-GCM key
/** @type {Map<string, string>} */
const remoteIdentityKeys = new Map(); // peerId -> base64 public key (from HANDSHAKE/ACK)
/** @type {Map<string, string>} */
const remoteExchangeKeys = new Map(); // peerId -> base64 public key (from PRIVATE_KEY_EXCHANGE)

/** @type {Map<string, { resolve: (k: string) => void, reject: (e: any) => void }>} */
const pendingKeyExchange = new Map();

/** @type {Map<string, any>} */
const lobbyConnections = new Map(); // peerId -> DataConnection (to lobby peer)

/** @type {Map<string, { peerId: string, username: string, color: string, age: number }>} */
const lobbyPeerList = new Map(); // peerId -> peer info (main peer IDs)

const ALLOWED_TYPES = new Set([
  'HANDSHAKE',
  'HANDSHAKE_ACK',
  'PEER_LIST',
  'GLOBAL_MSG',
  'PRIVATE_MSG',
  'PRIVATE_KEY_EXCHANGE',
  'USER_LIST',
  'PEER_DISCONNECT'
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
function buildMessage(type, peerId, profile, payload) {
  return {
    type,
    from: {
      peerId,
      username: profile.username,
      color: profile.color,
      age: profile.age
    },
    payload,
    timestamp: Date.now()
  };
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

async function becomeLobbyHost(profile) {
  if (!mainPeer) return;
  if (lobbyPeer) return;

  const Peer = await ensurePeerCtor();

  lobbyPeerList.set(mainPeer.id, { peerId: mainPeer.id, username: profile.username, color: profile.color, age: profile.age });

  lobbyPeer = new Peer(LOBBY_PEER_ID, PEERJS_CONFIG);

  lobbyPeer.on('open', () => {
    peerStore.update((s) => ({ ...s, isLobbyHost: true }));
  });

  lobbyPeer.on('connection', (conn) => {
    const remotePeerId = conn?.peer;
    if (!remotePeerId) return;

    lobbyConnections.set(remotePeerId, conn);

    conn.on('data', (data) => {
      if (!validateProtocolMessage(data)) return;
      if (data.type !== 'HANDSHAKE') return;

      const p = data.from;
      lobbyPeerList.set(p.peerId, { peerId: p.peerId, username: p.username, color: p.color, age: p.age });

      // Reply with the current list.
      safeSend(
        conn,
        buildMessage('PEER_LIST', LOBBY_PEER_ID, profile, {
          peers: Array.from(lobbyPeerList.values()).map((x) => ({ peerId: x.peerId, username: x.username, color: x.color }))
        })
      );

      // Broadcast updated list to all lobby connections.
      for (const c of lobbyConnections.values()) {
        safeSend(
          c,
          buildMessage('PEER_LIST', LOBBY_PEER_ID, profile, {
            peers: Array.from(lobbyPeerList.values()).map((x) => ({ peerId: x.peerId, username: x.username, color: x.color }))
          })
        );
      }
    });

    conn.on('close', () => {
      lobbyConnections.delete(remotePeerId);
      // Best-effort cleanup: keep peer list entry until it expires (phase 2 could add TTL).
    });
  });

  lobbyPeer.on('error', (err) => {
    // If lobby ID is taken, someone else is host; we should join as client.
    if (err?.type === 'unavailable-id') {
      try {
        lobbyPeer?.destroy?.();
      } catch {
        // ignore
      }
      lobbyPeer = null;
      peerStore.update((s) => ({ ...s, isLobbyHost: false }));
      return;
    }
    console.error('Lobby PeerJS error', err);
  });
}

async function joinLobby(profile) {
  if (!mainPeer) return;

  setConnectionState('connecting', { error: null });

  // Attempt to connect to lobby host first.
  const conn = mainPeer.connect(LOBBY_PEER_ID);

  const joined = await new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve(ok);
    };

    const timer = setTimeout(() => {
      safeClose(conn);
      finish(false);
    }, 1200);

    conn.on('open', async () => {
      lobbyConn = conn;
      clearTimeout(timer);
      await sendHandshake(conn, profile);
      finish(true);
    });

    conn.on('error', () => {
      clearTimeout(timer);
      finish(false);
    });
  });

  if (!joined) {
    await becomeLobbyHost(profile);
    setConnectionState('connected', { isConnected: true });
    return;
  }

  // Listen for peer list updates (and any future lobby messages).
  conn.on('data', (data) => {
    if (!validateProtocolMessage(data)) return;
    if (data.type === 'PEER_LIST') {
      const peers = data.payload?.peers ?? [];
      for (const p of peers) {
        if (!p?.peerId || p.peerId === mainPeer.id) continue;
        connectToPeer(p.peerId, profile);
      }
      return;
    }
  });

  conn.on('close', () => {
    lobbyConn = null;
    // Phase 2: host election. For now, try re-joining.
    if (cachedProfile) void joinLobby(cachedProfile);
  });

  setConnectionState('connected', { isConnected: true });
}

export function handleIncomingConnection(conn, profile) {
  if (!conn) return;
  const remotePeerId = conn.peer;

  upsertConnectedPeer(remotePeerId, conn, null);

  conn.on('open', async () => {
    try {
      await sendHandshake(conn, profile);
    } catch (err) {
      console.error('sendHandshake failed', err);
    }
  });

  conn.on('data', (data) => {
    handleMessage(data, conn, profile).catch((err) => console.error('handleMessage failed', err));
  });

  conn.on('close', () => {
    removeConnectedPeer(remotePeerId);
  });

  conn.on('error', (err) => {
    console.error('Peer connection error', err);
    removeConnectedPeer(remotePeerId);
  });
}

export async function handleMessage(msg, fromConn, profile) {
  if (!validateProtocolMessage(msg)) return;

  const remotePeerId = msg.from.peerId;

  if (msg.type === 'HANDSHAKE') {
    remoteIdentityKeys.set(remotePeerId, msg.payload?.publicKey ?? '');
    upsertConnectedPeer(remotePeerId, fromConn, {
      username: msg.from.username,
      color: msg.from.color,
      age: msg.from.age
    });
    await saveKnownPeer({ username: msg.from.username, peerId: remotePeerId, lastSeen: Date.now() });
    await sendHandshakeAck(fromConn, profile);
    return;
  }

  if (msg.type === 'HANDSHAKE_ACK') {
    remoteIdentityKeys.set(remotePeerId, msg.payload?.publicKey ?? '');
    upsertConnectedPeer(remotePeerId, fromConn, {
      username: msg.from.username,
      color: msg.from.color,
      age: msg.from.age
    });
    await saveKnownPeer({ username: msg.from.username, peerId: remotePeerId, lastSeen: Date.now() });
    return;
  }

  if (msg.type === 'PEER_LIST') {
    const peers = msg.payload?.peers ?? [];
    for (const p of peers) {
      if (!p?.peerId || p.peerId === mainPeer?.id) continue;
      connectToPeer(p.peerId, profile);
    }
    return;
  }

  if (msg.type === 'GLOBAL_MSG') {
    const text = msg.payload?.text;
    if (typeof text !== 'string' || text.trim().length === 0) return;
    await addGlobalMessage({
      peerId: msg.from.peerId,
      username: msg.from.username,
      age: msg.from.age,
      color: msg.from.color,
      text,
      timestamp: msg.timestamp
    });
    return;
  }

  if (msg.type === 'PRIVATE_KEY_EXCHANGE') {
    const publicKey = msg.payload?.publicKey;
    if (typeof publicKey !== 'string' || publicKey.length === 0) return;
    remoteExchangeKeys.set(remotePeerId, publicKey);

    // If we initiated, resolve the wait.
    const pending = pendingKeyExchange.get(remotePeerId);
    if (pending) {
      pendingKeyExchange.delete(remotePeerId);
      pending.resolve(publicKey);
    }

    // Reply with our public key if we haven't yet.
    const id = get(peerStore).peerId;
    if (id) {
      const ours = await ensureLocalPublicKeyBase64();
      safeSend(fromConn, buildMessage('PRIVATE_KEY_EXCHANGE', id, profile, { publicKey: ours }));
    }

    // Derive and store shared key.
    const kp = await ensureLocalKeyPair();
    const their = await importPublicKey(publicKey);
    const shared = await deriveSharedSecret(kp.privateKey, their);
    sharedKeys.set(remotePeerId, shared);
    return;
  }

  if (msg.type === 'PRIVATE_MSG') {
    const key = sharedKeys.get(remotePeerId);
    if (!key) return;
    const ciphertext = msg.payload?.ciphertext;
    const iv = msg.payload?.iv;
    if (typeof ciphertext !== 'string' || typeof iv !== 'string') return;
    await decryptMessage(key, ciphertext, iv);
    return;
  }
}

export async function initPeer(profile) {
  try {
    cachedProfile = profile;
    setConnectionState('connecting', { error: null, reconnectAttempt: 0 });

    if (mainPeer) return mainPeer;

    const Peer = await ensurePeerCtor();

    const debug = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV ? 2 : 0;

    const peerId = randomPeerId();
    mainPeer = new Peer(peerId, { ...PEERJS_CONFIG, debug });

    mainPeer.on('open', (id) => {
      peerStore.update((s) => ({
        ...s,
        peerId: id,
        isConnected: true,
        error: null,
        reconnectAttempt: 0
      }));
      void joinLobby(profile);
    });

    mainPeer.on('connection', (conn) => {
      handleIncomingConnection(conn, profile);
    });

    mainPeer.on('error', (err) => {
      console.error('PeerJS error', err);
      peerStore.update((s) => ({ ...s, error: err?.type ?? 'peer-error' }));
    });

    mainPeer.on('disconnected', () => {
      void attemptReconnect(mainPeer, profile, 0);
    });

    return mainPeer;
  } catch (err) {
    console.error('initPeer failed', err);
    peerStore.update((s) => ({ ...s, error: 'init-failed', connectionState: 'failed' }));
    throw err;
  }
}

export async function attemptReconnect(peer, profile, attempt = 0) {
  if (!peer) return;
  if (attempt >= RECONNECT_DELAYS.length) {
    setConnectionState('failed', { isConnected: false });
    return;
  }

  setConnectionState('reconnecting', { reconnectAttempt: attempt + 1 });
  await sleep(RECONNECT_DELAYS[attempt]);

  try {
    peer.reconnect?.();
    // If reconnect succeeds, PeerJS should emit `open` again; joinLobby happens there.
  } catch (err) {
    console.error('reconnect failed', err);
    await attemptReconnect(peer, profile, attempt + 1);
    return;
  }

  // Some PeerJS reconnect failures don't throw; they simply never re-open.
  // Treat a missing 'open' within a short window as a failed attempt.
  const opened = await new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try {
        peer.off?.('open', onOpen);
      } catch {
        // ignore
      }
      resolve(ok);
    };

    const onOpen = () => finish(true);
    try {
      peer.on?.('open', onOpen);
    } catch {
      // ignore
    }

    setTimeout(() => finish(false), 1500);
  });

  if (!opened) {
    await attemptReconnect(peer, profile, attempt + 1);
  }
}

export async function broadcastGlobalMessage(text, profile) {
  const state = get(peerStore);
  const id = state.peerId;
  if (!id) return;

  const trimmed = String(text ?? '').trim();
  if (!trimmed) return;

  const envelope = buildMessage('GLOBAL_MSG', id, profile, { text: trimmed });

  // Optimistic update.
  await addGlobalMessage({
    peerId: id,
    username: profile.username,
    age: profile.age,
    color: profile.color,
    text: trimmed,
    timestamp: envelope.timestamp
  });

  for (const entry of state.connectedPeers.values()) {
    safeSend(entry.connection, envelope);
  }
}

export async function sendPrivateMessage(targetPeerId, text, sharedKey) {
  const state = get(peerStore);
  const id = state.peerId;
  if (!id) return;
  if (!targetPeerId) return;

  const trimmed = String(text ?? '').trim();
  if (!trimmed) return;

  const { ciphertext, iv } = await encryptMessage(sharedKey, trimmed);
  const envelope = buildMessage('PRIVATE_MSG', id, cachedProfile, { ciphertext, iv });

  const entry = state.connectedPeers.get(targetPeerId);
  if (entry) safeSend(entry.connection, envelope);
}

export async function initiatePrivateChat(targetPeerId, _targetUsername) {
  const state = get(peerStore);
  const id = state.peerId;
  if (!id) throw new Error('Peer not initialized');
  if (!targetPeerId) throw new Error('Missing target peer id');
  if (!cachedProfile) throw new Error('Missing user profile');

  const kp = await ensureLocalKeyPair();
  const ours = await ensureLocalPublicKeyBase64();

  const entry = state.connectedPeers.get(targetPeerId);
  if (!entry) throw new Error('Peer not connected');

  // Send exchange request.
  safeSend(entry.connection, buildMessage('PRIVATE_KEY_EXCHANGE', id, cachedProfile, { publicKey: ours }));

  const theirBase64 = await new Promise((resolve, reject) => {
    pendingKeyExchange.set(targetPeerId, { resolve, reject });
    setTimeout(() => {
      if (!pendingKeyExchange.has(targetPeerId)) return;
      pendingKeyExchange.delete(targetPeerId);
      reject(new Error('Key exchange timed out'));
    }, 2500);
  });

  const their = await importPublicKey(theirBase64);
  const shared = await deriveSharedSecret(kp.privateKey, their);
  sharedKeys.set(targetPeerId, shared);
  return shared;
}

export function disconnectPeer() {
  const state = get(peerStore);
  const id = state.peerId;

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
  lobbyPeer = null;
  lobbyConn = null;
  cachedProfile = null;
  PeerCtor = null;

  sharedKeys.clear();
  remoteIdentityKeys.clear();
  remoteExchangeKeys.clear();
  pendingKeyExchange.clear();
  lobbyConnections.clear();
  lobbyPeerList.clear();

  peerStore.set({
    peerId: null,
    isConnected: false,
    connectionState: 'offline',
    error: null,
    reconnectAttempt: 0,
    isLobbyHost: false,
    connectedPeers: new Map()
  });
}
