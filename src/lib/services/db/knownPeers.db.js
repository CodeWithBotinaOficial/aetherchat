import { db } from './schema.js';

/**
 * @param {import('./types.js').KnownPeer} peer
 */
export async function saveKnownPeer(peer) {
  try {
    await db.transaction('rw', db.knownPeers, async () => {
      // PeerJS IDs are ephemeral; de-duplicate by username so reconnection can update peerId.
      const uname = String(peer?.username ?? '').trim();
      const existing = uname ? await db.knownPeers.where('username').equals(uname).first() : null;
      if (existing) {
        await db.knownPeers.put({ ...existing, ...peer, id: existing.id });
        return;
      }
      await db.knownPeers.add({ ...peer });
    });
  } catch (err) {
    console.error('saveKnownPeer failed', err);
    throw err;
  }
}

/**
 * @returns {Promise<import('./types.js').KnownPeer[]>}
 */
export async function getKnownPeers() {
  try {
    return await db.knownPeers.orderBy('lastSeen').reverse().toArray();
  } catch (err) {
    console.error('getKnownPeers failed', err);
    throw err;
  }
}
