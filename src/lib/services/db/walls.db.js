import { db } from './schema.js';

/**
 * @param {string} followerPeerId
 * @param {string} followerUsername
 * @param {string} targetPeerId
 * @param {string} targetUsername
 * @param {number} [followedAt]
 * @returns {Promise<boolean>} true if inserted, false if already exists
 */
export async function followUser(followerPeerId, followerUsername, targetPeerId, targetUsername, followedAt) {
  const existing = await db.follows
    .where('[followerPeerId+targetPeerId]')
    .equals([followerPeerId, targetPeerId])
    .first();
  if (existing) return false;

  await db.follows.add({
    followerPeerId,
    followerUsername,
    targetPeerId,
    targetUsername,
    followedAt: typeof followedAt === 'number' ? followedAt : Date.now()
  });
  return true;
}

/**
 * @param {string} followerPeerId
 * @param {string} targetPeerId
 * @returns {Promise<boolean>} true if deleted, false if not found
 */
export async function unfollowUser(followerPeerId, targetPeerId) {
  const existing = await db.follows
    .where('[followerPeerId+targetPeerId]')
    .equals([followerPeerId, targetPeerId])
    .first();
  if (!existing) return false;

  await db.follows.delete(existing.id);
  return true;
}

/**
 * @param {string} followerPeerId
 * @param {string} targetPeerId
 * @returns {Promise<boolean>}
 */
export async function isFollowing(followerPeerId, targetPeerId) {
  const count = await db.follows
    .where('[followerPeerId+targetPeerId]')
    .equals([followerPeerId, targetPeerId])
    .count();
  return count > 0;
}

/**
 * @param {string} targetPeerId
 * @returns {Promise<number>}
 */
export async function getFollowerCount(targetPeerId) {
  return await db.follows.where('targetPeerId').equals(targetPeerId).count();
}

/**
 * @param {string} followerPeerId
 * @returns {Promise<number>}
 */
export async function getFollowingCount(followerPeerId) {
  return await db.follows.where('followerPeerId').equals(followerPeerId).count();
}

/**
 * @param {string} peerId
 * @returns {Promise<import('./schema.js').Follow[]>}
 */
export async function getFollowsForPeer(peerId) {
  return await db.follows
    .where('followerPeerId')
    .equals(peerId)
    .or('targetPeerId')
    .equals(peerId)
    .toArray();
}

/**
 * @param {string} peerId
 * @returns {Promise<string[]>} array of followed peerIds
 */
export async function getFollowingPeerIds(peerId) {
  const follows = await db.follows.where('followerPeerId').equals(peerId).toArray();
  return follows.map(f => f.targetPeerId);
}

/**
 * @param {string} peerId
 * @returns {Promise<string[]>} array of follower peerIds
 */
export async function getFollowerPeerIds(peerId) {
  const follows = await db.follows.where('targetPeerId').equals(peerId).toArray();
  return follows.map(f => f.followerPeerId);
}

/**
 * @param {string} followerPeerId
 * @returns {Promise<import('./schema.js').Follow[]>}
 */
export async function getOutgoingFollows(followerPeerId) {
  return await db.follows.where('followerPeerId').equals(followerPeerId).toArray();
}

/**
 * @param {string} followerPeerId
 * @returns {Promise<number>} number of deleted rows
 */
export async function deleteOutgoingFollows(followerPeerId) {
  return await db.follows.where('followerPeerId').equals(followerPeerId).delete();
}

/**
 * @param {string} targetPeerId
 * @returns {Promise<number>} number of deleted rows
 */
export async function deleteIncomingFollows(targetPeerId) {
  return await db.follows.where('targetPeerId').equals(targetPeerId).delete();
}

/**
 * Removes all follows where `peerId` is follower or target.
 * Used when receiving USER_DELETED for a remote peer.
 * @param {string} peerId
 * @returns {Promise<number>} number of deleted rows
 */
export async function deleteFollowsInvolvingPeer(peerId) {
  const pid = String(peerId ?? '').trim();
  if (!pid) return 0;
  const rows = await db.follows
    .where('followerPeerId')
    .equals(pid)
    .or('targetPeerId')
    .equals(pid)
    .toArray();
  if (rows.length === 0) return 0;
  await db.follows.bulkDelete(rows.map((r) => r.id));
  return rows.length;
}
