import { db } from './schema.js';

/**
 * Get a stable (persisted) peerId for this username, or null if none exists yet.
 * @param {string} username
 * @returns {Promise<string|null>}
 */
export async function getStoredPeerId(username) {
  try {
    const key = String(username ?? '').trim();
    if (!key) return null;
    const entry = await db.peerIds.get(key);
    return entry?.peerId ?? null;
  } catch {
    return null;
  }
}

/**
 * Persist the preferred PeerJS id for this username (used as the stable peerId across reloads).
 * @param {string} username
 * @param {string} peerId
 */
export async function setStoredPeerId(username, peerId) {
  const u = String(username ?? '').trim();
  const pid = String(peerId ?? '').trim();
  if (!u || !pid) return;
  try {
    await db.peerIds.put({ username: u, peerId: pid });
  } catch {
    // ignore
  }
}
