import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { mainPeer, buildMessage, safeSend } from '$lib/services/peer/shared.js';

const binaryChannels = new Map();

const PING_INTERVAL = 20_000; // 20s heartbeat

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

  // Start heartbeat monitoring for this channel
  startChannelHeartbeat(peerId, conn);

  return conn;
}

export async function probeChannel(conn, peerId, timeoutMs = 2000) {
  if (!conn || conn.open === false) return false;

  const state = get(peerStore);
  const myPeerId = state.peerId;
  if (!myPeerId) return false;

  const nonce = globalThis.crypto?.randomUUID?.() || String(Date.now());

  return await new Promise((resolve) => {
    let resolved = false;
    let unsubscribe = null;
    let timeout = null;

    function cleanup() {
      try {
        if (typeof unsubscribe === 'function') unsubscribe();
      } catch {
        // Intentionally ignored: unsubscribe may not be available
      }
      try {
        if (timeout) clearTimeout(timeout);
      } catch {
        // Intentionally ignored
      }
      // If probe failed, remove stale channel
      try {
        const cached = binaryChannels.get(peerId);
        if (cached && cached.conn === conn) {
          binaryChannels.delete(peerId);
          try { conn.close(); } catch {
            // Intentionally ignored: channel may already be closed
          }
        }
      } catch {
        // Intentionally ignored
      }
    }

    const onMsg = (msg) => {
      try {
        if (msg.type === 'IMAGE_PONG' && msg.payload?.nonce === nonce && msg.from.peerId === peerId) {
          if (!resolved) { resolved = true; cleanup(); resolve(true); }
        }
      } catch {
        // Intentionally ignored
      }
    };

    // Temporary global listener via window message hub: rely on router emitting messages
    // Import onMessage dynamically to avoid cycles
    import('$lib/services/peer/shared.js').then((mod) => {
      unsubscribe = mod.onMessage('IMAGE_PONG', onMsg);

      timeout = setTimeout(() => {
        if (!resolved) { resolved = true; cleanup(); resolve(false); }
      }, Number(timeoutMs) || 2000);

      // Send ping
      try {
        const profile = { username: 'system', color: '#000', dateOfBirth: null };
        const msg = buildMessage('IMAGE_PING', myPeerId, profile, { nonce });
        safeSend(conn, msg);
      } catch {
        cleanup();
        if (!resolved) { resolved = true; resolve(false); }
      }
    }).catch(() => {
      if (!resolved) { resolved = true; resolve(false); }
    });
  });
}

function startChannelHeartbeat(peerId, conn) {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const alive = await probeChannel(conn, peerId, 3000);
      if (!alive) {
        stopped = true;
        const cached = binaryChannels.get(peerId);
        if (cached && cached.conn === conn) binaryChannels.delete(peerId);
      }
    } catch {
      stopped = true;
      const cached = binaryChannels.get(peerId);
      if (cached && cached.conn === conn) binaryChannels.delete(peerId);
    }
  };

  const interval = setInterval(tick, PING_INTERVAL);

  conn.on('close', () => { clearInterval(interval); stopped = true; });
  conn.on('error', () => { clearInterval(interval); stopped = true; });
}
