import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';

/**
 * @typedef {'GLOBAL_MSG'|'PRIVATE_MSG'|'HANDSHAKE'|'USER_LIST'|'PEER_DISCONNECT'} MessageType
 */

/**
 * @typedef {Object} ProtocolFrom
 * @property {string} username
 * @property {string} peerId
 * @property {string} color
 * @property {number} age
 */

/**
 * @typedef {Object} ProtocolMessage
 * @property {MessageType} type
 * @property {ProtocolFrom} from
 * @property {any} payload
 * @property {number} timestamp
 */

/** @type {any|null} */
let peerInstance = null;

const ALLOWED_TYPES = new Set([
  'GLOBAL_MSG',
  'PRIVATE_MSG',
  'HANDSHAKE',
  'USER_LIST',
  'PEER_DISCONNECT'
]);

/**
 * @param {any} msg
 * @returns {msg is ProtocolMessage}
 */
export function validateProtocolMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (!ALLOWED_TYPES.has(msg.type)) return false;
  if (!msg.from || typeof msg.from !== 'object') return false;
  if (typeof msg.from.username !== 'string' || msg.from.username.length === 0) return false;
  if (typeof msg.from.peerId !== 'string' || msg.from.peerId.length === 0) return false;
  if (typeof msg.from.color !== 'string' || msg.from.color.length === 0) return false;
  if (typeof msg.from.age !== 'number') return false;
  if (typeof msg.timestamp !== 'number') return false;
  // payload can be anything type-specific, but must exist.
  if (typeof msg.payload === 'undefined') return false;
  return true;
}

/**
 * @param {any} conn PeerJS DataConnection
 */
function registerConnection(conn) {
  const remotePeerId = conn?.peer;
  if (!remotePeerId) return;

  peerStore.update((s) => {
    const next = new Map(s.connectedPeers);
    next.set(remotePeerId, {
      username: s.connectedPeers.get(remotePeerId)?.username ?? 'unknown',
      color: s.connectedPeers.get(remotePeerId)?.color ?? '',
      connection: conn
    });
    return { ...s, connectedPeers: next };
  });

  conn.on?.('close', () => {
    peerStore.update((s) => {
      const next = new Map(s.connectedPeers);
      next.delete(remotePeerId);
      return { ...s, connectedPeers: next };
    });
  });

  conn.on?.('error', (err) => {
    console.error('Peer connection error', err);
  });

  conn.on?.('data', (data) => {
    // Phase 1: protocol plumbing only. Higher-level handling comes later.
    if (!validateProtocolMessage(data)) return;
  });
}

/**
 * Creates a new Peer instance with the PeerJS public server.
 * PeerJS is imported dynamically to avoid SSR bundling issues.
 * @param {string} _username
 * @returns {Promise<any>} Peer instance
 */
export async function initPeer(_username) {
  try {
    if (peerInstance) return peerInstance;

    const mod = await import('peerjs');
    const PeerCtor = mod.default ?? mod.Peer ?? mod;

    peerInstance = new PeerCtor({ host: '0.peerjs.com', secure: true });

    peerInstance.on?.('open', (id) => {
      peerStore.update((s) => ({ ...s, peerId: id, isConnected: true }));
    });

    peerInstance.on?.('connection', (conn) => {
      registerConnection(conn);
    });

    peerInstance.on?.('error', (err) => {
      console.error('PeerJS error', err);
    });

    return peerInstance;
  } catch (err) {
    console.error('initPeer failed', err);
    throw err;
  }
}

/**
 * @param {string} remotePeerId
 * @returns {any} DataConnection
 */
export function connectToPeer(remotePeerId) {
  if (!peerInstance) throw new Error('Peer not initialized.');
  const conn = peerInstance.connect(remotePeerId);
  registerConnection(conn);
  return conn;
}

/**
 * @param {ProtocolMessage} message
 */
export function broadcastToAll(message) {
  const state = get(peerStore);
  for (const entry of state.connectedPeers.values()) {
    try {
      entry.connection?.send?.(message);
    } catch (err) {
      console.error('broadcastToAll send failed', err);
    }
  }
}

/**
 * @param {string} peerId
 * @param {ProtocolMessage} message
 */
export function sendToPeer(peerId, message) {
  const state = get(peerStore);
  const entry = state.connectedPeers.get(peerId);
  if (!entry) return;
  try {
    entry.connection?.send?.(message);
  } catch (err) {
    console.error('sendToPeer failed', err);
  }
}

export function disconnectPeer() {
  const state = get(peerStore);

  for (const entry of state.connectedPeers.values()) {
    try {
      entry.connection?.close?.();
    } catch (err) {
      console.error('disconnectPeer close failed', err);
    }
  }

  try {
    peerInstance?.destroy?.();
  } catch (err) {
    console.error('disconnectPeer destroy failed', err);
  } finally {
    peerInstance = null;
  }

  peerStore.set({ peerId: null, isConnected: false, connectedPeers: new Map() });
}
