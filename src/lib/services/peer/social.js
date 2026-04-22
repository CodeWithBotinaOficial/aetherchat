import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { user as userStore } from '$lib/stores/userStore.js';
import {
  followUser,
  unfollowUser,
  getFollowerCount,
  getFollowingCount,
  deleteFollowsInvolvingPeer
} from '$lib/services/db/walls.db.js';
import {
  editWallCommentText,
  getWallComment,
  getWallComments,
  hardDeleteAllCommentsByAuthor,
  softDeleteWallComment,
  upsertWallCommentFromPeer,
  upsertWallCommentsFromPeer
} from '$lib/services/db/wallComments.db.js';
import {
  applyIncomingWallCommentAdded,
  applyIncomingWallCommentDeleted,
  applyIncomingWallCommentEdited,
  applyIncomingWallDataResponseMeta,
  currentWall,
  isWallOpen
} from '$lib/stores/wall/state.js';

function myPeerId() {
  return String(get(peerStore)?.peerId ?? '').trim();
}

function localUser() {
  return get(userStore);
}

function buildFromLocalUser(u) {
  return {
    peerId: myPeerId(),
    username: String(u?.username ?? ''),
    color: String(u?.color ?? ''),
    age: Number(u?.age ?? 0)
  };
}

function isString(x) {
  return typeof x === 'string' && x.length > 0;
}

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * @param {any} msg
 * @returns {Promise<void>}
 */
export async function handleFollowMessage(msg) {
  const p = msg?.payload;
  if (!p || typeof p !== 'object') return;
  if (!isString(p.targetPeerId) || !isString(p.followerPeerId)) return;

  const me = myPeerId();
  if (!me || p.targetPeerId !== me) return;

  await followUser(
    p.followerPeerId,
    String(p.followerUsername ?? ''),
    p.targetPeerId,
    String(p.targetUsername ?? ''),
    isFiniteNumber(p.followedAt) ? p.followedAt : undefined
  );

  // Update counts if your wall is open.
  if (get(isWallOpen)) {
    const w = get(currentWall);
    if (w?.ownerPeerId === me) {
      const followerCount = await getFollowerCount(me);
      applyIncomingWallDataResponseMeta(me, followerCount, w.followingCount);
    }
  }
}

export async function handleUnfollowMessage(msg) {
  const p = msg?.payload;
  if (!p || typeof p !== 'object') return;
  if (!isString(p.targetPeerId) || !isString(p.followerPeerId)) return;

  const me = myPeerId();
  if (!me || p.targetPeerId !== me) return;

  await unfollowUser(p.followerPeerId, p.targetPeerId);

  if (get(isWallOpen)) {
    const w = get(currentWall);
    if (w?.ownerPeerId === me) {
      const followerCount = await getFollowerCount(me);
      applyIncomingWallDataResponseMeta(me, followerCount, w.followingCount);
    }
  }
}

export async function handleWallCommentAddedMessage(msg) {
  const p = msg?.payload;
  if (!p || typeof p !== 'object') return;
  if (!isString(p.id)) return;
  if (!isString(p.wallOwnerPeerId) || !isString(p.authorPeerId)) return;
  if (!isString(p.authorUsername) || !isString(p.authorColor)) return;
  if (!isString(p.text)) return;
  if (!isFiniteNumber(p.createdAt)) return;

  const record = {
    id: p.id,
    wallOwnerPeerId: p.wallOwnerPeerId,
    authorPeerId: p.authorPeerId,
    authorUsername: p.authorUsername,
    authorColor: p.authorColor,
    authorAvatarBase64: typeof p.authorAvatarBase64 === 'string' ? p.authorAvatarBase64 : null,
    text: p.text,
    createdAt: p.createdAt,
    editedAt: null,
    deleted: false
  };

  const applied = await upsertWallCommentFromPeer(record);
  if (!applied) return;
  applyIncomingWallCommentAdded(record);
}

export async function handleWallCommentEditedMessage(msg) {
  const p = msg?.payload;
  if (!p || typeof p !== 'object') return;
  if (!isString(p.id) || !isString(p.wallOwnerPeerId)) return;
  if (!isString(p.text) || !isFiniteNumber(p.editedAt)) return;

  const fromPeerId = String(msg?.from?.peerId ?? '').trim();
  if (!fromPeerId) return;

  const existing = await getWallComment(p.id);
  if (!existing || existing.deleted) return;

  // Authorization: only the comment author can edit.
  if (existing.authorPeerId !== fromPeerId) return;
  if (existing.wallOwnerPeerId !== p.wallOwnerPeerId) return;

  const ok = await editWallCommentText(p.id, p.text, p.editedAt);
  if (!ok) return;
  applyIncomingWallCommentEdited(p.wallOwnerPeerId, p.id, p.text, p.editedAt);
}

export async function handleWallCommentDeletedMessage(msg) {
  const p = msg?.payload;
  if (!p || typeof p !== 'object') return;
  if (!isString(p.id) || !isString(p.wallOwnerPeerId) || !isString(p.authorPeerId)) return;

  const fromPeerId = String(msg?.from?.peerId ?? '').trim();
  if (!fromPeerId) return;

  const existing = await getWallComment(p.id);
  if (!existing) return;

  // Consistency: require payload to match stored author/wall IDs.
  if (existing.wallOwnerPeerId !== p.wallOwnerPeerId) return;
  if (existing.authorPeerId !== p.authorPeerId) return;

  // Authorization: comment author OR wall owner.
  if (fromPeerId !== existing.authorPeerId && fromPeerId !== existing.wallOwnerPeerId) return;

  const ok = await softDeleteWallComment(p.id);
  if (!ok) return;
  applyIncomingWallCommentDeleted(p.wallOwnerPeerId, p.id);
}

/**
 * @param {any} msg
 * @returns {Promise<any|null>} response envelope or null
 */
export async function handleWallDataRequestMessage(msg) {
  const p = msg?.payload;
  if (!p || typeof p !== 'object') return null;
  if (!isString(p.wallOwnerPeerId)) return null;

  const me = myPeerId();
  if (!me || p.wallOwnerPeerId !== me) return null;

  const u = localUser();
  if (!u) return null;

  const [comments, followerCount, followingCount] = await Promise.all([
    getWallComments(me, 50),
    getFollowerCount(me),
    getFollowingCount(me)
  ]);

  return {
    type: 'WALL_DATA_RESPONSE',
    from: buildFromLocalUser(u),
    payload: { comments, followerCount, followingCount },
    timestamp: Date.now()
  };
}

export async function handleWallDataResponseMessage(msg) {
  const p = msg?.payload;
  if (!p || typeof p !== 'object') return;
  if (!Array.isArray(p.comments)) return;
  if (!isFiniteNumber(p.followerCount) || !isFiniteNumber(p.followingCount)) return;

  const wallOwnerPeerId = String(msg?.from?.peerId ?? '').trim();
  if (!wallOwnerPeerId) return;

  const cleaned = p.comments
    .map((c) => {
      if (!c || typeof c !== 'object') return null;
      const rec = {
        id: String(c.id ?? ''),
        wallOwnerPeerId: String(c.wallOwnerPeerId ?? ''),
        authorPeerId: String(c.authorPeerId ?? ''),
        authorUsername: String(c.authorUsername ?? ''),
        authorColor: String(c.authorColor ?? ''),
        authorAvatarBase64: typeof c.authorAvatarBase64 === 'string' ? c.authorAvatarBase64 : null,
        text: String(c.text ?? ''),
        createdAt: Number(c.createdAt ?? 0),
        editedAt: typeof c.editedAt === 'number' ? c.editedAt : null,
        deleted: Boolean(c.deleted)
      };
      if (!isWallCommentShaped(rec)) return null;
      return rec;
    })
    .filter(Boolean);

  await upsertWallCommentsFromPeer(cleaned);

  // Refresh comments in the open wall (if it matches).
  if (get(isWallOpen)) {
    const w = get(currentWall);
    if (w?.ownerPeerId === wallOwnerPeerId) {
      const comments = await getWallComments(wallOwnerPeerId, 50);
      currentWall.update((prev) => (prev && prev.ownerPeerId === wallOwnerPeerId ? { ...prev, comments } : prev));
    }
  }

  applyIncomingWallDataResponseMeta(wallOwnerPeerId, p.followerCount, p.followingCount);
}

function isWallCommentShaped(c) {
  return (
    isString(c.id) &&
    isString(c.wallOwnerPeerId) &&
    isString(c.authorPeerId) &&
    isString(c.authorUsername) &&
    isString(c.authorColor) &&
    typeof c.text === 'string' &&
    isFiniteNumber(c.createdAt) &&
    (c.editedAt === null || isFiniteNumber(c.editedAt)) &&
    typeof c.deleted === 'boolean' &&
    (typeof c.authorAvatarBase64 === 'string' || c.authorAvatarBase64 === null)
  );
}

/**
 * Social cleanup when receiving USER_DELETED.
 * @param {string} peerId
 */
export async function handleRemoteUserDeletedSocial(peerId) {
  const pid = String(peerId ?? '').trim();
  if (!pid) return;

  await deleteFollowsInvolvingPeer(pid);
  await hardDeleteAllCommentsByAuthor(pid);

  // If their wall is open, close it.
  const w = get(currentWall);
  if (w?.ownerPeerId === pid) {
    currentWall.set(null);
    isWallOpen.set(false);
  }
}

