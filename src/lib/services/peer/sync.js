import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { globalMessages as globalMessagesStore } from '$lib/stores/chatStore.js';

import {
  db,
  getFullUsernameRegistry,
  getGlobalMessages,
  mergeUsernameRegistry
} from '$lib/services/db.js';

import { MAX_DIRECT_PEERS } from './config.js';
import {
  broadcastToAll,
  buildFromProfile,
  resolveRegistrySync,
  setConnectionState
} from './shared.js';
import { sendToPeer } from './shared.js';
import { connectToPeerIfUnknownFromShared } from './shared.js';

/** @type {ReturnType<typeof setInterval>|null} */
let gossipIntervalId = null;

export function startGossipInterval(profile) {
  if (gossipIntervalId) clearInterval(gossipIntervalId);
  gossipIntervalId = setInterval(() => {
    broadcastStateDigest(profile).catch((err) => console.error('gossip tick failed', err));
  }, 30_000);
}

export function stopGossipInterval() {
  if (!gossipIntervalId) return;
  clearInterval(gossipIntervalId);
  gossipIntervalId = null;
}

/**
 * Gossip digest: a tiny "what I have" summary so peers can request sync on demand.
 * @param {import('./types.js').UserProfile} profile
 */
export async function broadcastStateDigest(profile) {
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

async function handleNetworkState(payload, profile) {
  const peers = payload?.peers ?? [];
  const usernameRegistry = payload?.usernameRegistry ?? [];
  const globalHistory = payload?.globalHistory ?? [];

  try {
    await mergeUsernameRegistry(usernameRegistry);
  } catch (err) {
    console.error('handleNetworkState mergeUsernameRegistry failed', err);
  } finally {
    resolveRegistrySync('network');
  }

  try {
    await db.transaction('rw', db.globalMessages, async () => {
      for (const msg of globalHistory) {
        if (!msg || typeof msg !== 'object') continue;
        await db.globalMessages.put(msg);
      }
    });
  } catch (err) {
    console.error('handleNetworkState merge messages failed', err);
  }

  try {
    const allMessages = await getGlobalMessages(100);
    globalMessagesStore.set(allMessages);
  } catch (err) {
    console.error('handleNetworkState refresh store failed', err);
  }

  const localPeerId = get(peerStore).peerId;
  const connectedIds = new Set(get(peerStore).connectedPeers.keys());
  for (const p of peers) {
    if (!p?.peerId) continue;
    if (p.peerId === localPeerId) continue;
    if (connectedIds.has(p.peerId)) continue;
    if (get(peerStore).connectedPeers.size >= MAX_DIRECT_PEERS) break;
    connectToPeerIfUnknownFromShared(p, profile);
  }

  setConnectionState('connected', { isConnected: true, lastSyncAt: Date.now() });
}

export async function handleNetworkStateMessage(msg, profile) {
  return await handleNetworkState(msg?.payload, profile);
}

export async function handleNewPeerMessage(msg, profile) {
  if (get(peerStore).connectedPeers.size >= MAX_DIRECT_PEERS) return;
  await connectToPeerIfUnknownFromShared(msg?.payload?.newPeer, profile);
}

async function getKnownUsernamesList() {
  const entries = await getFullUsernameRegistry();
  return entries.map((e) => e.username);
}

export async function handleStateDigestMessage(msg, profile) {
  const latestRemote = Number(msg.payload?.latestGlobalMsgTimestamp ?? 0);
  const remoteRegistryCount = Number(msg.payload?.usernameRegistryCount ?? 0);

  const myLatest = await db.globalMessages.orderBy('timestamp').last();
  const myCount = await db.usernameRegistry.count();

  if ((myLatest?.timestamp ?? 0) < latestRemote || myCount < remoteRegistryCount) {
    const knownUsernames = await getKnownUsernamesList();
    sendToPeer(msg.from.peerId, {
      type: 'SYNC_REQUEST',
      from: buildFromProfile(profile),
      payload: { sinceTimestamp: myLatest?.timestamp ?? 0, knownUsernames },
      timestamp: Date.now()
    });
  }
}

export async function handleSyncRequestMessage(msg, profile) {
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
}

export async function handleSyncResponseMessage(msg) {
  const newMessages = Array.isArray(msg.payload?.newMessages) ? msg.payload.newMessages : [];
  const registryEntries = Array.isArray(msg.payload?.registryEntries) ? msg.payload.registryEntries : [];

  try {
    await mergeUsernameRegistry(registryEntries);
  } catch (err) {
    console.error('SYNC_RESPONSE mergeUsernameRegistry failed', err);
  }

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

  try {
    const allMessages = await getGlobalMessages(100);
    globalMessagesStore.set(allMessages);
  } catch (err) {
    console.error('SYNC_RESPONSE refresh store failed', err);
  }

  peerStore.update((s) => ({ ...s, lastSyncAt: Date.now() }));
}
