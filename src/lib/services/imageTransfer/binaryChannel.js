import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { mainPeer } from '$lib/services/peer/shared.js';

const binaryChannels = new Map();

export function ensureBinaryChannel(peerId) {
  const existing = binaryChannels.get(peerId);
  
  if (existing) {
    if (existing.open) {
      return existing;
    } else {
      binaryChannels.delete(peerId);
    }
  }

  const state = get(peerStore);
  let conn = state.connectedPeers.get(peerId)?.connection;

  if (!conn || !conn.open) {
    if (!mainPeer) throw new Error('Peer not initialized');
    conn = mainPeer.connect(peerId);
  }

  binaryChannels.set(peerId, conn);

  conn.on('close', () => {
    if (binaryChannels.get(peerId) === conn) {
      binaryChannels.delete(peerId);
    }
  });

  conn.on('error', () => {
    if (binaryChannels.get(peerId) === conn) {
      binaryChannels.delete(peerId);
    }
  });

  return conn;
}
