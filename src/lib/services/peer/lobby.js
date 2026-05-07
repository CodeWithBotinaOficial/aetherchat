import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { getFullUsernameRegistry, getGlobalMessages } from '$lib/services/db.js';

import { JOIN_LOBBY_TIMEOUT_MS, LOBBY_ID_PREFIX, LOBBY_SHARDS, PEERJS_CONFIG } from './config.js';
import {
  PeerCtor,
  activeLobbyId,
  broadcastToAll,
  buildFromProfile,
  dispatchIncomingMessage,
  lobbyConnections,
  lobbyPeerList,
  mainPeer,
  resolveRegistrySync,
  safeClose,
  safeSend,
  setActiveLobbyId,
  setLobbyConn,
  setLobbyPeer
} from './shared.js';
import { connectToPeerIfUnknownFromShared, cachedProfile } from './shared.js';

/**
 * @param {number|string} index
 */
export function getLobbyPeerId(index) {
  const i = Number(index);
  if (!Number.isFinite(i)) return `${LOBBY_ID_PREFIX}-0`;
  return `${LOBBY_ID_PREFIX}-${Math.max(0, Math.min(LOBBY_SHARDS - 1, i))}`;
}

export function getLobbyIdCandidates(seed) {
  // Stable order: always try shard 0 first (better testability + easier debugging),
  // then fall back to other shards when needed.
  void seed;
  return Array.from({ length: LOBBY_SHARDS }, (_, i) => getLobbyPeerId(i));
}

function getNetworkPeerList(profile) {
  const state = get(peerStore);
  const map = new Map();

  for (const p of lobbyPeerList.values()) {
    if (!p?.peerId) continue;
    if (p.peerId !== state.peerId) {
      const joinConn = lobbyConnections.get(p.peerId);
      if (!joinConn || joinConn.open === false) continue;
    }
    map.set(p.peerId, { peerId: p.peerId, username: p.username, color: p.color, dateOfBirth: p.dateOfBirth ?? null });
  }

  if (state.peerId) {
    map.set(state.peerId, { peerId: state.peerId, username: profile.username, color: profile.color, dateOfBirth: profile.dateOfBirth ?? null });
  }

  for (const [peerId, info] of state.connectedPeers.entries()) {
    if (!peerId) continue;
    map.set(peerId, { peerId, username: info.username, color: info.color, dateOfBirth: info.dateOfBirth ?? null });
  }

  return Array.from(map.values());
}

async function setupLobbyHostHandlers(hostPeer, localPeer, profile) {
  if (localPeer?.id) {
    lobbyPeerList.set(localPeer.id, {
      peerId: localPeer.id,
      username: profile.username,
      color: profile.color,
      dateOfBirth: profile.dateOfBirth ?? null
    });
  }

  hostPeer.on('connection', (conn) => {
    conn.on('close', () => {
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
        if (!msg || typeof msg !== 'object') return;
        if (msg.type !== 'LOBBY_JOIN') return;
        if (!msg.from?.peerId) return;

        const newPeer = msg.from;
        lobbyPeerList.set(newPeer.peerId, {
          peerId: newPeer.peerId,
          username: newPeer.username,
          color: newPeer.color,
          dateOfBirth: newPeer.dateOfBirth ?? null
        });
        lobbyConnections.set(newPeer.peerId, conn);
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

        // Connect-back to joining peer (best-effort), with a small delay to reduce thrash.
        setTimeout(() => {
          try {
            connectToPeerIfUnknownFromShared(newPeer, profile);
          } catch (err) {
            console.error('lobby host connect-back failed', err);
          }
        }, 350);
      })().catch((err) => console.error('lobby host handler failed', err));
    });
  });

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
 * @param {import('./types.js').UserProfile} profile
 * @returns {Promise<{ role: 'guest', lobbyConn: any } | { role: 'host', lobbyPeer: any } | { role: 'standalone' }>}
 */
export async function joinLobby(localPeer, profile, attempt = 0) {
  return await new Promise((resolve) => {
    if (!localPeer || localPeer.destroyed || localPeer.disconnected) {
      resolveRegistrySync('timeout');
      resolve({ role: 'standalone' });
      return;
    }

    const candidates = getLobbyIdCandidates(localPeer.id ?? '');
    const preferred = candidates[0] ?? getLobbyPeerId(0);
    const perAttemptMs = Math.max(250, Math.ceil(JOIN_LOBBY_TIMEOUT_MS / Math.max(1, candidates.length)));

    let idx = 0;
    let settled = false;
    let finalizing = false;
    /** @type {any|null} */
    let activeConn = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let overallTimer = null;

    function cleanupOverallTimer() {
      if (!overallTimer) return;
      clearTimeout(overallTimer);
      overallTimer = null;
    }

    function finish(result) {
      if (settled) return;
      settled = true;
      cleanupOverallTimer();
      resolve(result);
    }

    function finalizeAsHost() {
      if (finalizing || settled) return;
      finalizing = true;
      cleanupOverallTimer();
      resolveRegistrySync('timeout');
      becomeLobbyHost(localPeer, profile, attempt, preferred).then(finish);
    }

    overallTimer = setTimeout(() => {
      safeClose(activeConn);
      finalizeAsHost();
    }, JOIN_LOBBY_TIMEOUT_MS);

    const tryConnect = () => {
      const lobbyId = candidates[idx++];
      if (!lobbyId) {
        finalizeAsHost();
        return;
      }

      /** @type {any} */
      let conn;
      try {
        conn = localPeer.connect(lobbyId, { reliable: true, metadata: { type: 'lobby-join' } });
      } catch (err) {
        console.error('joinLobby: connect failed', err);
        resolveRegistrySync('timeout');
        finish({ role: 'standalone' });
        return;
      }

      if (!conn || typeof conn.on !== 'function') {
        resolveRegistrySync('timeout');
        finish({ role: 'standalone' });
        return;
      }

      activeConn = conn;

      conn.on('data', (data) => {
        (async () => {
          await dispatchIncomingMessage(data, conn, profile);
        })().catch((err) => console.error('lobbyConn dispatchIncomingMessage failed', err));
      });

      const timeout = setTimeout(() => {
        safeClose(conn);
        if (settled || finalizing) return;
        if (idx < candidates.length) tryConnect();
        else finalizeAsHost();
      }, perAttemptMs);

      conn.on('open', () => {
        clearTimeout(timeout);
        setLobbyConn(conn);
        setActiveLobbyId(lobbyId);
        cleanupOverallTimer();

        safeSend(conn, {
          type: 'LOBBY_JOIN',
          from: buildFromProfile(profile, localPeer.id),
          payload: {},
          timestamp: Date.now()
        });

        peerStore.update((s) => ({ ...s, isLobbyHost: false }));
        finish({ role: 'guest', lobbyConn: conn });
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        safeClose(conn);
        if (settled || finalizing) return;

        if (err?.type === 'disconnected') {
          resolveRegistrySync('timeout');
          finish({ role: 'standalone' });
          return;
        }

        if (err?.type === 'peer-unavailable' || isLobbyUnavailableError(err)) {
          finalizeAsHost();
          return;
        }

        if (idx < candidates.length) tryConnect();
        else finalizeAsHost();
      });

      conn.on('close', () => {
        clearTimeout(timeout);
        // If the lobby peer disappears, elect a new host so newcomers can join.
        setTimeout(electNewLobbyHost, 2000);
      });
    };

    tryConnect();
  });
}

/**
 * Claim the lobby ID (become host). If the chosen ID is unavailable, retry with another shard.
 * @param {any} localPeer
 * @param {import('./types.js').UserProfile} profile
 */
export async function becomeLobbyHost(localPeer, profile, attempt = 0, lobbyId = null) {
  return await new Promise((resolve) => {
    const mod = globalThis._PeerJS;
    const Peer = mod?.Peer ?? mod?.default ?? PeerCtor;
    const desired = String(lobbyId ?? activeLobbyId ?? getLobbyIdCandidates(localPeer?.id ?? '')[0] ?? getLobbyPeerId(0));
    const debug = getPeerJsDebugLevel();
    const hostPeer = new Peer(desired, { ...PEERJS_CONFIG, debug });

    hostPeer.on('open', () => {
      setLobbyPeer(hostPeer);
      setActiveLobbyId(desired);
      resolveRegistrySync('first-peer');
      peerStore.update((s) => ({
        ...s,
        isLobbyHost: true,
        lobbyPeer: hostPeer,
        currentLobbyHostId: get(peerStore).peerId
      }));
      void setupLobbyHostHandlers(hostPeer, localPeer, profile);

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

export function electNewLobbyHost() {
  const state = get(peerStore);
  const ourId = state.peerId;
  if (!ourId) return;
  if (!mainPeer || !cachedProfile) return;
  if (state.isLobbyHost) return;

  const allPeerIds = [ourId, ...state.connectedPeers.keys()].sort();
  if (allPeerIds[0] !== ourId) return;

  becomeLobbyHost(mainPeer, cachedProfile, 0, activeLobbyId).catch((err) => console.error('electNewLobbyHost failed', err));
}

export async function handleLobbyHostChangedMessage(msg) {
  const newHostPeerId = msg?.payload?.newHostPeerId;
  if (typeof newHostPeerId === 'string' && newHostPeerId.length > 0) {
    peerStore.update((s) => ({ ...s, currentLobbyHostId: newHostPeerId }));
  }
}

function getPeerJsDebugLevel() {
  const raw = import.meta.env?.VITE_PEERJS_DEBUG;
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(3, n));
}

function isLobbyUnavailableError(err) {
  return Boolean(String(err?.message ?? '').includes('Could not connect to peer'));
}
