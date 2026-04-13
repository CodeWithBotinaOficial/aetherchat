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

