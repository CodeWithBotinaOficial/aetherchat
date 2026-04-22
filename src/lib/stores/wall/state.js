import { writable } from 'svelte/store';

/**
 * @typedef {Object} WallComment
 * @property {string} id
 * @property {string} wallOwnerPeerId
 * @property {string} authorPeerId
 * @property {string} authorUsername
 * @property {string} authorColor
 * @property {string|null} authorAvatarBase64
 * @property {string} text
 * @property {number} createdAt
 * @property {number|null} editedAt
 * @property {boolean} deleted
 */

/**
 * @typedef {Object} WallData
 * @property {string} ownerPeerId
 * @property {string} ownerUsername
 * @property {string} ownerColor
 * @property {number} ownerAge
 * @property {string|null} ownerAvatarBase64
 * @property {string} ownerBio
 * @property {WallComment[]} comments
 * @property {number} followerCount
 * @property {number} followingCount
 * @property {boolean} isFollowing
 * @property {boolean} isLoading
 * @property {boolean} isOffline
 * @property {boolean} isOwner
 */

/** @type {import('svelte/store').Writable<WallData|null>} */
export const currentWall = writable(null);

/** @type {import('svelte/store').Writable<boolean>} */
export const isWallOpen = writable(false);

/** @type {Set<string>} */
const viewedWalls = new Set();

export function markWallViewed(peerId) {
  const pid = String(peerId ?? '').trim();
  if (!pid) return;
  viewedWalls.add(pid);
}

export function hasWallViewed(peerId) {
  const pid = String(peerId ?? '').trim();
  if (!pid) return false;
  return viewedWalls.has(pid);
}

/**
 * Apply incoming P2P comment add/update/delete while the wall is open.
 * These are intentionally store-only mutations (no network/db side effects).
 */
export function applyIncomingWallCommentAdded(comment) {
  if (!comment || typeof comment !== 'object') return;
  const pid = String(comment.wallOwnerPeerId ?? '').trim();
  const id = String(comment.id ?? '').trim();
  if (!pid || !id) return;

  currentWall.update((prev) => {
    if (!prev || prev.ownerPeerId !== pid) return prev;
    if (comment.deleted) return prev;
    if (prev.comments.some((c) => c.id === id)) return prev;
    return { ...prev, comments: [comment, ...prev.comments].slice(0, 50) };
  });
}

export function applyIncomingWallCommentEdited(wallOwnerPeerId, id, text, editedAt) {
  const pid = String(wallOwnerPeerId ?? '').trim();
  const cid = String(id ?? '').trim();
  if (!pid || !cid) return;
  currentWall.update((prev) => {
    if (!prev || prev.ownerPeerId !== pid) return prev;
    const next = prev.comments.map((c) =>
      c.id === cid ? { ...c, text: String(text ?? ''), editedAt: Number(editedAt ?? Date.now()) } : c
    );
    return { ...prev, comments: next };
  });
}

export function applyIncomingWallCommentDeleted(wallOwnerPeerId, id) {
  const pid = String(wallOwnerPeerId ?? '').trim();
  const cid = String(id ?? '').trim();
  if (!pid || !cid) return;
  currentWall.update((prev) => {
    if (!prev || prev.ownerPeerId !== pid) return prev;
    return { ...prev, comments: prev.comments.filter((c) => c.id !== cid) };
  });
}

export function applyIncomingWallDataResponseMeta(wallOwnerPeerId, followerCount, followingCount) {
  const pid = String(wallOwnerPeerId ?? '').trim();
  if (!pid) return;
  currentWall.update((prev) => {
    if (!prev || prev.ownerPeerId !== pid) return prev;
    return {
      ...prev,
      followerCount: typeof followerCount === 'number' ? followerCount : prev.followerCount,
      followingCount: typeof followingCount === 'number' ? followingCount : prev.followingCount,
      isLoading: false,
      isOffline: false
    };
  });
}
