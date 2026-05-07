// Net layer public surface.
// Split into smaller modules to keep files under the line cap.

export * from './net.core.js';
export * from './net.connections.js';

import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { safeSend } from './shared.js';

export function broadcastProtocolEnvelope(envelope) {
  const state = get(peerStore);
  for (const entry of state.connectedPeers.values()) safeSend(entry.connection, envelope);
}

export function sendProtocolEnvelopeToPeer(peerId, envelope) {
  const pid = String(peerId ?? '').trim();
  if (!pid) return;
  const entry = get(peerStore).connectedPeers.get(pid);
  if (!entry) return;
  if (entry.connection?.open === false) return;
  safeSend(entry.connection, envelope);
}

export function isPeerOnline(peerId) {
  const pid = String(peerId ?? '').trim();
  if (!pid) return false;
  const entry = get(peerStore).connectedPeers.get(pid);
  return Boolean(entry && entry.connection?.open !== false);
}

