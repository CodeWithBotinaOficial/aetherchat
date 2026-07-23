import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { mainPeer } from '$lib/services/peer/shared.js';

const binaryChannels = new Map();

export function ensureBinaryChannel(peerId) {
  const isFirefox = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('firefox');
  const existing = binaryChannels.get(peerId);
  
  if (existing) {
    const { conn, createdAt } = existing;
    const age = Date.now() - createdAt;
    
    if (conn.open && age <= 30000 && !isFirefox) {
      return conn;
    } else {
      binaryChannels.delete(peerId);
    }
  }

  let conn;
  if (!isFirefox) {
    const state = get(peerStore);
    conn = state.connectedPeers.get(peerId)?.connection;
  }

  if (!conn || !conn.open || isFirefox) {
    if (!mainPeer) throw new Error('Peer not initialized');
    console.warn(`Creating fresh binary channel for ${peerId} (Firefox: ${isFirefox})`);
    conn = mainPeer.connect(peerId, { reliable: true });
  } else {
    console.warn(`Reusing binary channel for ${peerId}`);
  }

  binaryChannels.set(peerId, { conn, createdAt: Date.now() });

  const cleanup = () => {
    const cached = binaryChannels.get(peerId);
    if (cached && cached.conn === conn) {
      binaryChannels.delete(peerId);
    }
  };

  conn.on('close', cleanup);
  conn.on('error', cleanup);

  return conn;
}
