import { get } from 'svelte/store';
import { user } from '$lib/stores/userStore.js';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { currentWall, isWallOpen, markWallViewed } from './state.js';
import {
  followUser,
  getFollowerCount,
  getFollowingCount,
  isFollowing as isFollowingDb,
  unfollowUser
} from '$lib/services/db/walls.db.js';
import { getWallComments, hardDeleteCommentsByAuthorOnWall } from '$lib/services/db/wallComments.db.js';
import {
  isPeerOnline,
  sendProtocolEnvelopeToPeer
} from '$lib/services/peer.js';

/**
 * @typedef {Pick<import('$lib/services/db.js').User, 'username'|'age'|'color'|'avatarBase64'|'bio'>} UserProfile
 */

function myPeerId() {
  return String(get(peerStore)?.peerId ?? '').trim();
}

/**
 * @param {UserProfile} u
 * @returns {{ peerId: string, username: string, color: string, age: number }}
 */
function buildFromLocalUser(u) {
  return {
    peerId: myPeerId(),
    username: String(u?.username ?? ''),
    color: String(u?.color ?? ''),
    age: Number(u?.age ?? 0)
  };
}

/**
 * @param {{ peerId: string, username: string, color: string, age: number, avatarBase64: string|null, bio?: string }} owner
 */
export async function openWall(owner) {
  const pid = String(owner?.peerId ?? '').trim();
  if (!pid) return;

  const u = get(user);
  const me = myPeerId();
  if (!u) return;

  markWallViewed(pid);

  const [comments, followerCount, followingCount, following] = await Promise.all([
    getWallComments(pid, 50),
    getFollowerCount(pid),
    getFollowingCount(pid),
    me ? isFollowingDb(me, pid) : Promise.resolve(false)
  ]);

  const isOwner = Boolean(me && pid === me);
  const offline = !isOwner && !isPeerOnline(pid);
  const canRequest = Boolean(me && !offline && !isOwner);

  currentWall.set({
    ownerPeerId: pid,
    ownerUsername: String(owner?.username ?? ''),
    ownerColor: String(owner?.color ?? ''),
    ownerAge: Number(owner?.age ?? 0),
    ownerAvatarBase64: owner?.avatarBase64 ?? null,
    ownerBio: String(owner?.bio ?? ''),
    comments,
    followerCount,
    followingCount,
    isFollowing: Boolean(following),
    isLoading: canRequest,
    isOffline: offline,
    isOwner
  });
  isWallOpen.set(true);

  if (canRequest) {
    const env = {
      type: 'WALL_DATA_REQUEST',
      from: buildFromLocalUser(u),
      payload: { wallOwnerPeerId: pid },
      timestamp: Date.now()
    };
    sendProtocolEnvelopeToPeer(pid, env);
  }
}

export async function openMyWall() {
  const u = get(user);
  const pid = myPeerId();
  if (!u || !pid) return;
  return await openWall({
    peerId: pid,
    username: u.username,
    color: u.color,
    age: u.age,
    avatarBase64: u.avatarBase64 ?? null,
    bio: u.bio ?? ''
  });
}

export function closeWall() {
  currentWall.set(null);
  isWallOpen.set(false);
}

/**
 * Re-loads counts and the latest comments from local DB for the open wall (if it matches).
 * Counts are local-node views and may differ between peers in the network.
 * @param {string} wallOwnerPeerId
 */
export async function refreshOpenWallFromDb(wallOwnerPeerId) {
  const pid = String(wallOwnerPeerId ?? '').trim();
  if (!pid) return;
  const w = get(currentWall);
  if (!w || w.ownerPeerId !== pid) return;

  const [comments, followerCount, followingCount] = await Promise.all([
    getWallComments(pid, 50),
    getFollowerCount(pid),
    getFollowingCount(pid)
  ]);

  currentWall.update((prev) => {
    if (!prev || prev.ownerPeerId !== pid) return prev;
    return { ...prev, comments, followerCount, followingCount };
  });
}

export async function ensureFollowingWallOwner() {
  const w = get(currentWall);
  if (!w || w.isOwner) return;
  if (w.isFollowing) return;
  await followWallOwner();
}

export async function followWallOwner() {
  const w = get(currentWall);
  const u = get(user);
  const me = myPeerId();
  if (!w || !u || !me) return;
  if (w.isOwner) return;

  const followedAt = Date.now();
  const inserted = await followUser(me, u.username, w.ownerPeerId, w.ownerUsername, followedAt);
  // Even if it already exists, align UI state.
  currentWall.update((prev) => {
    if (!prev) return prev;
    if (prev.ownerPeerId !== w.ownerPeerId) return prev;
    return {
      ...prev,
      isFollowing: true,
      followerCount: inserted ? prev.followerCount + 1 : prev.followerCount
    };
  });

  if (isPeerOnline(w.ownerPeerId)) {
    sendProtocolEnvelopeToPeer(w.ownerPeerId, {
      type: 'FOLLOW',
      from: buildFromLocalUser(u),
      payload: {
        targetPeerId: w.ownerPeerId,
        targetUsername: w.ownerUsername,
        followerPeerId: me,
        followerUsername: u.username,
        followedAt
      },
      timestamp: Date.now()
    });
  }
}

export async function unfollowWallOwner() {
  const w = get(currentWall);
  const u = get(user);
  const me = myPeerId();
  if (!w || !u || !me) return;
  if (w.isOwner) return;

  const removed = await unfollowUser(me, w.ownerPeerId);

  // Non-negotiable: cascade comment deletion BEFORE UNFOLLOW broadcast.
  const deletedIds = await hardDeleteCommentsByAuthorOnWall(w.ownerPeerId, me);

  if (isPeerOnline(w.ownerPeerId)) {
    for (const id of deletedIds) {
      sendProtocolEnvelopeToPeer(w.ownerPeerId, {
        type: 'WALL_COMMENT_DELETED',
        from: buildFromLocalUser(u),
        payload: { id, wallOwnerPeerId: w.ownerPeerId, authorPeerId: me },
        timestamp: Date.now()
      });
    }

    sendProtocolEnvelopeToPeer(w.ownerPeerId, {
      type: 'UNFOLLOW',
      from: buildFromLocalUser(u),
      payload: { targetPeerId: w.ownerPeerId, followerPeerId: me },
      timestamp: Date.now()
    });
  }

  currentWall.update((prev) => {
    if (!prev) return prev;
    if (prev.ownerPeerId !== w.ownerPeerId) return prev;
    const nextComments = deletedIds.length > 0 ? prev.comments.filter((c) => !deletedIds.includes(c.id)) : prev.comments;
    return {
      ...prev,
      isFollowing: false,
      followerCount: removed ? Math.max(0, prev.followerCount - 1) : prev.followerCount,
      comments: nextComments
    };
  });
}

export async function toggleFollowWallOwner() {
  const w = get(currentWall);
  if (!w || w.isOwner) return;
  if (w.isFollowing) await unfollowWallOwner();
  else await followWallOwner();
}
