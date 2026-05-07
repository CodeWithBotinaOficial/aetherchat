import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { refreshStablePeerId } from '$lib/stores/userStore.js';
import { getStoredPeerId, registerUsernameLocally, setStoredPeerId } from '$lib/services/db.js';

import {
  MAX_RECONNECT_ATTEMPTS,
  PEERJS_CONFIG,
  RECONNECT_DELAYS,
  UNAVAILABLE_ID_RETRY_DELAYS_MS
} from './config.js';
import {
  PeerCtor,
  cachedProfile,
  forcedPeerId,
  localPeerRef,
  mainPeer,
  reconnectAttempts,
  reconnectTimer,
  unavailableIdAttempts,
  unavailableIdRetryTimer,
  unloadHookInstalled,
  setCachedProfile,
  setForcedPeerId,
  setLocalPeerRef,
  setMainPeer,
  setPeerCtor,
  setReconnectAttempts,
  setReconnectTimer,
  setUnavailableIdAttempts,
  setUnavailableIdRetryTimer,
  setUnloadHookInstalled,
  setUserProfileRef,
  userProfileRef,
  setConnectionState,
  buildFromProfile
} from './shared.js';

import { joinLobby } from './lobby.js';
import { announcePresence, startHeartbeat, stopHeartbeat } from './presence.js';
import { startGossipInterval, stopGossipInterval } from './sync.js';
import { handleIncomingConnection, reconnectToKnownPeers, sendHandshake } from './net.connections.js';

let isInitializing = false;

function getPeerJsDebugLevel() {
  const raw = import.meta.env?.VITE_PEERJS_DEBUG;
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(3, n));
}

function generateEphemeralPeerId() {
  return globalThis.crypto?.randomUUID?.() ?? `p-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isLobbyUnavailableError(err) {
  return Boolean(String(err?.message ?? '').includes('Could not connect to peer'));
}

async function ensurePeerCtor() {
  if (PeerCtor) return PeerCtor;
  const mod = await import('peerjs');
  const Peer = mod?.Peer ?? mod?.default ?? mod;
  globalThis._PeerJS = { ...(globalThis._PeerJS ?? {}), Peer };
  setPeerCtor(Peer);
  return Peer;
}

function scheduleUnavailableIdRetry(profile) {
  const delays = UNAVAILABLE_ID_RETRY_DELAYS_MS;
  const attempt = unavailableIdAttempts ?? 0;

  if (attempt >= 3) {
    console.error('PeerJS: max unavailable-id retries reached');
    setUnavailableIdAttempts(0);
    setUnavailableIdRetryTimer(null);
    isInitializing = false;
    peerStore.update((s) => ({ ...s, connectionState: 'failed', error: 'unavailable-id' }));
    return;
  }

  const delay = Math.max(1000, delays[Math.min(attempt, delays.length - 1)] ?? 1500);
  if (unavailableIdRetryTimer) clearTimeout(unavailableIdRetryTimer);

  setUnavailableIdRetryTimer(setTimeout(() => {
    (async () => {
      setUnavailableIdAttempts(attempt + 1);

      // Clean up previous failed instance properly before retrying.
      if (localPeerRef) {
        try {
          localPeerRef.destroy();
        } catch {
          // ignore
        }
        setLocalPeerRef(null);
        setMainPeer(null);
      }
      await Promise.resolve();

      // Force a fresh ID on retry so we don't keep trying an ID that the server still considers taken.
      const newId = generateEphemeralPeerId();
      setForcedPeerId(newId);

      // Persist the new ID so future boots use this one instead of the taken one.
      if (profile?.username && profile.username !== 'pre-registration') {
        await setStoredPeerId(profile.username, newId).catch(() => {});
        await refreshStablePeerId().catch(() => {});
      }

      isInitializing = false;
      await initPeer(profile);
    })().catch((err) => console.error('unavailable-id retry failed', err));
  }, delay));
}

async function handlePeerDisconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    setReconnectTimer(null);
  }

  if ((reconnectAttempts ?? 0) >= MAX_RECONNECT_ATTEMPTS) {
    stopHeartbeat();
    peerStore.update((s) => ({ ...s, connectionState: 'failed' }));
    return;
  }

  peerStore.update((s) => ({ ...s, connectionState: 'reconnecting', reconnectAttempt: (reconnectAttempts ?? 0) + 1 }));

  const delay = RECONNECT_DELAYS[Math.min(reconnectAttempts ?? 0, RECONNECT_DELAYS.length - 1)] ?? 2000;
  setReconnectTimer(setTimeout(() => {
    (async () => {
      setReconnectAttempts((reconnectAttempts ?? 0) + 1);

      if (localPeerRef && !localPeerRef.destroyed) {
        if (localPeerRef.disconnected) {
          try {
            localPeerRef.reconnect();
            return;
          } catch (err) {
            console.warn('Reconnect failed, destroying and recreating:', err);
          }
        }
        try {
          localPeerRef.destroy();
        } catch {
          // ignore
        }
      }

      setLocalPeerRef(null);
      setMainPeer(null);
      await Promise.resolve();
      await initPeer(userProfileRef);
    })().catch((err) => console.error('handlePeerDisconnect timer failed', err));
  }, delay));
}

export async function initPeer(profile) {
  if (isInitializing) return mainPeer;
  isInitializing = true;

  try {
    setUserProfileRef(profile ?? null);
    setCachedProfile(
      profile && profile.username
        ? profile
        : {
            username: 'pre-registration',
            color: 'hsl(0, 0%, 70%)',
            dateOfBirth: null,
            avatarBase64: null,
            bio: '',
            createdAt: Date.now()
          }
    );
    setConnectionState('connecting', { error: null, reconnectAttempt: 0 });

    if (mainPeer && !mainPeer.destroyed) {
      isInitializing = false;
      const shouldRefresh = Boolean(profile?.createdAt) && profile?.username && profile.username !== 'pre-registration';
      if (shouldRefresh) {
        for (const entry of get(peerStore).connectedPeers.values()) {
          sendHandshake(entry.connection, profile).catch((err) => console.error('refresh handshake failed', err));
        }
      }
      return mainPeer;
    }

    const Peer = await ensurePeerCtor();
    const debug = getPeerJsDebugLevel();

    const stored =
      profile?.username && profile.username !== 'pre-registration'
        ? await getStoredPeerId(profile.username).catch(() => null)
        : null;

    const localId = forcedPeerId || stored || generateEphemeralPeerId();
    setForcedPeerId(null);

    const peer = new Peer(localId, { ...PEERJS_CONFIG, debug });
    setMainPeer(peer);
    setLocalPeerRef(peer);

    peerStore.update((s) => ({ ...s, peerId: null }));

    if (typeof window !== 'undefined' && !unloadHookInstalled) {
      setUnloadHookInstalled(true);
      const cleanup = () => {
        try {
          peer.destroy?.();
        } catch {
          // ignore
        }
      };
      window.addEventListener('pagehide', cleanup, { once: true });
      window.addEventListener('beforeunload', cleanup, { once: true });
    }

    peer.on('open', (id) => {
      isInitializing = false;
      setUnavailableIdAttempts(0);
      setUnavailableIdRetryTimer(null);
      setReconnectAttempts(0);
      setReconnectTimer(null);

      peerStore.update((s) => ({ ...s, peerId: id, isConnected: true, error: null, reconnectAttempt: 0 }));

      const shouldRegisterLocally = Boolean(profile?.createdAt) && Boolean(profile?.username) && profile.username !== 'pre-registration';
      if (shouldRegisterLocally) {
        registerUsernameLocally({
          username: profile.username,
          peerId: id,
          registeredAt: profile.createdAt,
          lastSeenAt: Date.now()
        }).catch((err) => console.error('registerUsernameLocally failed', err));
      }

      // Persist stable peerId mapping (used for ownership checks during boot).
      if (profile?.username && profile.username !== 'pre-registration') {
        (async () => {
          await setStoredPeerId(profile.username, id).catch(() => {});
          await refreshStablePeerId().catch(() => {});
        })().catch(() => {});
      }

      (async () => {
        const p = cachedProfile;
        const res = await joinLobby(peer, p);
        if (res.role === 'guest') setConnectionState('syncing', { isConnected: true, isLobbyHost: false });
        else if (res.role === 'host') setConnectionState('connected', { isConnected: true, isLobbyHost: true, currentLobbyHostId: id });
        else setConnectionState('standalone', { isConnected: true, isLobbyHost: false });

        await reconnectToKnownPeers(p);
        const retryDelays = [1500, 3500];
        for (const d of retryDelays) {
          setTimeout(() => {
            try {
              const st = get(peerStore);
              const hasOpen = [...st.connectedPeers.values()].some((e) => e.connection?.open !== false);
              if (!hasOpen) void reconnectToKnownPeers(p);
            } catch {
              // ignore
            }
          }, d);
        }

        startHeartbeat(p);
        startGossipInterval(p);

        if (p?.username && p.username !== 'pre-registration') announcePresence(p);
      })().catch((err) => console.error('post-open init failed', err));
    });

    peer.on('connection', (conn) => handleIncomingConnection(conn, cachedProfile));

    peer.on('error', (err) => {
      if (err?.type === 'unavailable-id') {
        console.warn('PeerJS: unavailable-id', err?.message);
        scheduleUnavailableIdRetry(profile);
        return;
      }

      isInitializing = false;

      switch (err?.type) {
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
          if (isLobbyUnavailableError(err)) return;
          console.error('PeerJS error:', err?.type, err?.message);
          peerStore.update((s) => ({ ...s, error: err?.type ?? 'peer-error' }));
      }
    });

    peer.on('disconnected', () => {
      peerStore.update((s) => ({ ...s, connectionState: 'reconnecting' }));
      void handlePeerDisconnect();
    });

    return peer;
  } catch (err) {
    isInitializing = false;
    console.error('initPeer failed', err);
    peerStore.update((s) => ({ ...s, error: 'init-failed', connectionState: 'failed' }));
    throw err;
  }
}

export async function attemptReconnect() {
  await handlePeerDisconnect();
}

/** @internal test-only */
export function resetInitializingForTest() {
  isInitializing = false;
}

export function setLocalUserProfile(profile) {
  setUserProfileRef(profile ?? null);
  if (profile) setCachedProfile(profile);

  if (!profile || profile.username === 'pre-registration') return;
  try {
    for (const entry of get(peerStore).connectedPeers.values()) {
      sendHandshake(entry.connection, profile).catch((err) => console.error('refresh handshake failed', err));
    }
    announcePresence(profile);
  } catch {
    // ignore
  }
}

export function broadcastProfileUpdated(patch, profile) {
  const state = get(peerStore);
  const id = state.peerId;
  if (!id) return;
  if (!profile?.username || profile.username === 'pre-registration') return;

  const payload = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'bio')) payload.bio = patch.bio ?? '';
  if (Object.prototype.hasOwnProperty.call(patch, 'avatarBase64')) payload.avatarBase64 = patch.avatarBase64 ?? null;

  // Note: envelope format matches validateProtocolMessage expectations.
  const env = { type: 'PROFILE_UPDATED', from: buildFromProfile(profile), payload, timestamp: Date.now() };
  for (const entry of state.connectedPeers.values()) {
    if (entry.connection?.open === false) continue;
    entry.connection?.send?.(env);
  }
  announcePresence(profile);
}

export function disconnectPeer() {
  const state = get(peerStore);
  const id = state.peerId;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    setReconnectTimer(null);
  }
  setReconnectAttempts(0);

  stopGossipInterval();
  stopHeartbeat();

  if (id && cachedProfile) {
    const msg = { type: 'PEER_DISCONNECT', from: buildFromProfile(cachedProfile), payload: {}, timestamp: Date.now() };
    for (const entry of state.connectedPeers.values()) {
      try {
        entry.connection?.send?.(msg);
      } catch {
        // ignore
      }
    }
  }

  for (const entry of state.connectedPeers.values()) {
    try {
      entry.connection?.close?.();
    } catch {
      // ignore
    }
  }

  try {
    mainPeer?.destroy?.();
  } catch {
    // ignore
  }

  setMainPeer(null);
  setLocalPeerRef(null);
  setCachedProfile(null);
  setUserProfileRef(null);
  setPeerCtor(null);

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
