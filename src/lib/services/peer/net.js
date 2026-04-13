import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { getKnownPeers } from '$lib/services/db.js';
import { exportPublicKey, generateKeyPair } from '$lib/services/crypto.js';
import { setChatOnlineStatus } from '$lib/stores/privateChatStore.js';

import { CONNECT_FAIL_COOLDOWN_MS, CONNECT_PENDING_TIMEOUT_MS, MAX_DIRECT_PEERS } from './config.js';
import {
  broadcastStateDigestFromShared,
  cachedProfile,
  clearConfirmedSessionsForPeer,
  dispatchIncomingMessage,
  electNewLobbyHostFromShared,
  flushGlobalOutbox,
  mainPeer,
  removeConnectedPeer,
  safeClose,
  safeSend,
  upsertConnectedPeer,
  userProfileRef
} from './shared.js';
import { buildMessage } from './shared.js';
import { flushQueueForPeer } from './queue.js';

// Avoid repeatedly trying to connect to peer IDs that just failed.
const recentConnectFailures = new Map(); // peerId -> { lastFailedAt, count }
const pendingConnectAttempts = new Map(); // peerId -> startedAt

function hashStringToUint(seed) {
  const s = String(seed ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

function hashStringToIndex(seed, mod) {
  const m = Number(mod);
  if (!Number.isFinite(m) || m <= 0) return 0;
  return hashStringToUint(seed) % m;
}

export function countOpenDirectPeers() {
  const state = get(peerStore);
  let n = 0;
  for (const entry of state.connectedPeers.values()) {
    if (entry?.connection?.open === false) continue;
    n += 1;
  }
  return n;
}

export function pickPeersToConnect(peers, limit, seed) {
  const list = Array.isArray(peers) ? peers.filter((p) => p?.peerId) : [];
  if (list.length <= limit) return list;
  // Deterministic selection based on seed so not every peer chooses the same first N.
  const start = hashStringToIndex(seed ?? '', list.length);
  const rotated = list.slice(start).concat(list.slice(0, start));
  return rotated.slice(0, limit);
}

function isInConnectCooldown(peerId) {
  const key = String(peerId ?? '').trim();
  if (!key) return false;
  const entry = recentConnectFailures.get(key);
  if (!entry) return false;
  return Date.now() - entry.lastFailedAt < CONNECT_FAIL_COOLDOWN_MS;
}

function isConnectPending(peerId) {
  const key = String(peerId ?? '').trim();
  if (!key) return false;
  const t = pendingConnectAttempts.get(key);
  if (!t) return false;
  if (Date.now() - t > CONNECT_PENDING_TIMEOUT_MS) {
    pendingConnectAttempts.delete(key);
    return false;
  }
  return true;
}

function noteConnectPending(peerId) {
  const key = String(peerId ?? '').trim();
  if (!key) return;
  pendingConnectAttempts.set(key, Date.now());
}

function clearConnectPending(peerId) {
  const key = String(peerId ?? '').trim();
  if (!key) return;
  pendingConnectAttempts.delete(key);
}

function noteConnectFailure(peerId) {
  const key = String(peerId ?? '').trim();
  if (!key) return;
  const prev = recentConnectFailures.get(key);
  recentConnectFailures.set(key, {
    lastFailedAt: Date.now(),
    count: (prev?.count ?? 0) + 1
  });
  clearConnectPending(key);
}

function noteConnectSuccess(peerId) {
  const key = String(peerId ?? '').trim();
  if (!key) return;
  recentConnectFailures.delete(key);
  clearConnectPending(key);
}

/** @type {Promise<{publicKey: CryptoKey, privateKey: CryptoKey}>|null} */
let localKeyPairPromise = null;
/** @type {Promise<string>|null} */
let localPublicKeyBase64Promise = null;

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

export async function sendHandshake(conn, profile) {
  const effectiveProfile = profile ?? userProfileRef ?? cachedProfile;
  if (!effectiveProfile) return;
  const id = get(peerStore).peerId;
  if (!id) return;
  const publicKey = await ensureLocalPublicKeyBase64();
  safeSend(conn, buildMessage('HANDSHAKE', id, effectiveProfile, { publicKey, avatarBase64: effectiveProfile.avatarBase64 ?? null }));
}

export async function sendHandshakeAck(conn, profile) {
  const effectiveProfile = profile ?? userProfileRef ?? cachedProfile;
  if (!effectiveProfile) return;
  const id = get(peerStore).peerId;
  if (!id) return;
  const publicKey = await ensureLocalPublicKeyBase64();
  safeSend(conn, buildMessage('HANDSHAKE_ACK', id, effectiveProfile, { publicKey, avatarBase64: effectiveProfile.avatarBase64 ?? null }));
}

export function connectToPeer(peerId, profile) {
  if (!mainPeer) return null;
  // PeerJS throws "Cannot connect to new Peer after disconnecting from server." when
  // attempting to create a DataConnection while `peer.disconnected === true`.
  if (mainPeer.destroyed || mainPeer.disconnected) return null;
  if (countOpenDirectPeers() >= MAX_DIRECT_PEERS) return null;
  if (!peerId || peerId === mainPeer.id) return null;
  if (isInConnectCooldown(peerId)) return null;
  if (isConnectPending(peerId)) return null;

  const state = get(peerStore);
  if (state.connectedPeers.has(peerId)) return state.connectedPeers.get(peerId)?.connection ?? null;

  try {
    noteConnectPending(peerId);
    const conn = mainPeer.connect(peerId);
    handleIncomingConnection(conn, profile);
    return conn;
  } catch (err) {
    noteConnectFailure(peerId);
    console.error('connectToPeer failed', err);
    return null;
  }
}

export function connectToPeerIfUnknown(peerInfo, profile) {
  const pid = peerInfo?.peerId;
  if (!pid || pid === get(peerStore).peerId) return;
  if (isInConnectCooldown(pid)) return;
  if (isConnectPending(pid)) return;
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

export async function reconnectToKnownPeers(profile) {
  try {
    // If we're not connected to the PeerJS server, do not attempt to open new DataConnections.
    if (!mainPeer || mainPeer.destroyed || mainPeer.disconnected) return;

    const known = await getKnownPeers();
    const myPeerId = get(peerStore).peerId;
    const connected = get(peerStore).connectedPeers;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;

    const remainingSlots = Math.max(0, MAX_DIRECT_PEERS - countOpenDirectPeers());
    const candidates = pickPeersToConnect(known, remainingSlots, myPeerId ?? '');

    for (const p of candidates) {
      if (!p?.peerId) continue;
      if (p.peerId === myPeerId) continue;
      if (typeof p.lastSeen === 'number' && p.lastSeen < cutoff) continue;
      const existing = connected.get(p.peerId);
      if (existing?.connection?.open) continue;
      if (countOpenDirectPeers() >= MAX_DIRECT_PEERS) break;
      connectToPeerIfUnknown({ peerId: p.peerId }, profile);
    }
  } catch (err) {
    console.error('reconnectToKnownPeers failed', err);
  }
}

export function handleIncomingConnection(conn, profile) {
  if (!conn) return;
  const remotePeerId = conn.peer;
  const effectiveProfile = profile ?? userProfileRef ?? cachedProfile;
  let opened = false;

  // If we already have a connection for this peerId (stale), close it and replace.
  const existing = get(peerStore).connectedPeers.get(remotePeerId);
  if (existing?.connection && existing.connection !== conn) {
    safeClose(existing.connection);
  }

  upsertConnectedPeer(remotePeerId, conn, null);

  conn.on('open', () => {
    (async () => {
      noteConnectSuccess(remotePeerId);
      opened = true;
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
      // Trigger an immediate digest after a peer link comes up so refreshed peers can sync.
      void broadcastStateDigestFromShared(effectiveProfile);
    })().catch((err) => console.error('sendHandshake failed', err));
  });

  conn.on('data', (data) => {
    (async () => {
      await dispatchIncomingMessage(data, conn, effectiveProfile);
    })().catch((err) => console.error('handleMessage failed', err));
  });

  conn.on('close', () => {
    clearConnectPending(remotePeerId);
    if (!opened) noteConnectFailure(remotePeerId);
    clearConfirmedSessionsForPeer(remotePeerId);
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
      setTimeout(electNewLobbyHostFromShared, 2000);
    }
  });

  conn.on('error', (err) => {
    noteConnectFailure(remotePeerId);
    console.error('Peer connection error', err);
    clearConfirmedSessionsForPeer(remotePeerId);
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
