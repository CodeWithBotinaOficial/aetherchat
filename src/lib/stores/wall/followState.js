import { derived, writable } from 'svelte/store';
import { getFollowingPeerIds as getFollowingPeerIdsFromDb } from '$lib/services/db/follows.db.js';

/** @type {import('svelte/store').Writable<Set<string>>} */
const _followingPeerIds = writable(new Set());

let snapshot = new Set();
_followingPeerIds.subscribe((v) => {
  snapshot = v instanceof Set ? v : new Set();
});

/**
 * Derived readable store with the peerIds the local user currently follows.
 * @type {import('svelte/store').Readable<Set<string>>}
 */
export const followingPeerIds = derived(_followingPeerIds, ($s) => $s);

/**
 * Load follow relationships (outgoing follows) from IndexedDB for the given peerId.
 * Must be called during boot after the local user is loaded.
 * @param {string} myPeerId
 */
export async function loadFollowState(myPeerId) {
  const pid = String(myPeerId ?? '').trim();
  if (!pid) {
    _followingPeerIds.set(new Set());
    return;
  }
  const ids = await getFollowingPeerIdsFromDb(pid);
  _followingPeerIds.set(new Set((ids ?? []).map((x) => String(x ?? '').trim()).filter(Boolean)));
}

/**
 * Update store after a successful follow action.
 * @param {string} peerId
 */
export function markFollowed(peerId) {
  const pid = String(peerId ?? '').trim();
  if (!pid) return;
  _followingPeerIds.update((prev) => {
    const next = new Set(prev);
    next.add(pid);
    return next;
  });
}

/**
 * Update store after a successful unfollow action.
 * @param {string} peerId
 */
export function markUnfollowed(peerId) {
  const pid = String(peerId ?? '').trim();
  if (!pid) return;
  _followingPeerIds.update((prev) => {
    const next = new Set(prev);
    next.delete(pid);
    return next;
  });
}

/**
 * Synchronous helper for template expressions.
 * @param {string} peerId
 * @returns {boolean}
 */
export function isFollowing(peerId) {
  const pid = String(peerId ?? '').trim();
  if (!pid) return false;
  return snapshot.has(pid);
}

/**
 * Test-only helper: overwrite the current follow snapshot.
 * @param {string[]} peerIds
 */
export function __setFollowingForTests(peerIds) {
  const list = Array.isArray(peerIds) ? peerIds : [];
  _followingPeerIds.set(new Set(list.map((x) => String(x ?? '').trim()).filter(Boolean)));
}
