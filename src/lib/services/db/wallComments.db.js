import Dexie from 'dexie';
import { db } from './schema.js';

/**
 * @returns {string}
 */
function createWallCommentId() {
  return globalThis.crypto?.randomUUID?.() ?? `wc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * @param {any} c
 * @returns {c is import('./schema.js').WallComment}
 */
function isWallCommentRecord(c) {
  if (!c || typeof c !== 'object') return false;
  if (typeof c.id !== 'string' || c.id.length === 0) return false;
  if (typeof c.wallOwnerPeerId !== 'string' || c.wallOwnerPeerId.length === 0) return false;
  if (typeof c.authorPeerId !== 'string' || c.authorPeerId.length === 0) return false;
  if (typeof c.authorUsername !== 'string') return false;
  if (typeof c.authorColor !== 'string') return false;
  if (typeof c.text !== 'string') return false;
  if (typeof c.createdAt !== 'number') return false;
  if (typeof c.editedAt !== 'number' && c.editedAt !== null) return false;
  if (typeof c.deleted !== 'boolean') return false;
  if (typeof c.authorAvatarBase64 !== 'string' && c.authorAvatarBase64 !== null) return false;
  return true;
}

/**
 * Inserts a new local comment with a generated UUID.
 * @param {Omit<import('./schema.js').WallComment, 'id'|'editedAt'|'deleted'> & { id?: string }} input
 * @returns {Promise<import('./schema.js').WallComment>}
 */
export async function addLocalWallComment(input) {
  const id = typeof input?.id === 'string' && input.id ? input.id : createWallCommentId();
  const record = {
    id,
    wallOwnerPeerId: String(input.wallOwnerPeerId ?? ''),
    authorPeerId: String(input.authorPeerId ?? ''),
    authorUsername: String(input.authorUsername ?? ''),
    authorColor: String(input.authorColor ?? ''),
    authorAvatarBase64: input.authorAvatarBase64 ?? null,
    text: String(input.text ?? ''),
    createdAt: Number(input.createdAt ?? Date.now()),
    editedAt: null,
    deleted: false
  };

  await db.wallComments.put(record);
  return record;
}

/**
 * @param {string} wallOwnerPeerId
 * @param {number} [limit=50]
 * @returns {Promise<import('./schema.js').WallComment[]>} newest-first, non-deleted
 */
export async function getWallComments(wallOwnerPeerId, limit = 50) {
  const owner = String(wallOwnerPeerId ?? '').trim();
  const max = Math.max(0, Math.min(50, Math.floor(Number(limit) || 0) || 0));
  if (!owner || max === 0) return [];

  /** @type {import('./schema.js').WallComment[]} */
  const out = [];

  await db.wallComments
    .where('[wallOwnerPeerId+createdAt]')
    .between([owner, Dexie.minKey], [owner, Dexie.maxKey])
    .reverse()
    .each((c) => {
      if (!c || c.deleted) return;
      out.push(c);
      if (out.length >= max) return false;
      return undefined;
    });

  return out;
}

/**
 * @param {string} id
 * @returns {Promise<import('./schema.js').WallComment|null>}
 */
export async function getWallComment(id) {
  const key = String(id ?? '').trim();
  if (!key) return null;
  const existing = await db.wallComments.get(key);
  return existing ?? null;
}

/**
 * @param {string} id
 * @param {string} text
 * @param {number} [editedAt]
 * @returns {Promise<boolean>}
 */
export async function editWallCommentText(id, text, editedAt) {
  const key = String(id ?? '').trim();
  if (!key) return false;
  const existing = await db.wallComments.get(key);
  if (!existing || existing.deleted) return false;

  const nextText = String(text ?? '').trim();
  const ts = typeof editedAt === 'number' ? editedAt : Date.now();
  await db.wallComments.update(key, { text: nextText, editedAt: ts });
  return true;
}

/**
 * Soft-delete a comment (keeps row for conflict resolution / P2P).
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function softDeleteWallComment(id) {
  const key = String(id ?? '').trim();
  if (!key) return false;
  const existing = await db.wallComments.get(key);
  if (!existing) return false;
  if (existing.deleted) return true;
  await db.wallComments.update(key, { deleted: true });
  return true;
}

/**
 * Hard-delete all comments authored by `authorPeerId` on `wallOwnerPeerId`.
 * Used for the UNFOLLOW cascade.
 * @param {string} wallOwnerPeerId
 * @param {string} authorPeerId
 * @returns {Promise<string[]>} deleted comment IDs
 */
export async function hardDeleteCommentsByAuthorOnWall(wallOwnerPeerId, authorPeerId) {
  const wall = String(wallOwnerPeerId ?? '').trim();
  const author = String(authorPeerId ?? '').trim();
  if (!wall || !author) return [];

  const rows = await db.wallComments
    .where('[wallOwnerPeerId+authorPeerId]')
    .equals([wall, author])
    .toArray();

  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  await db.wallComments.bulkDelete(ids);
  return ids;
}

/**
 * Hard-delete ALL comments authored by `authorPeerId` across all walls.
 * Used for account deletion cascades.
 * @param {string} authorPeerId
 * @returns {Promise<Pick<import('./schema.js').WallComment, 'id'|'wallOwnerPeerId'>[]>}
 */
export async function hardDeleteAllCommentsByAuthor(authorPeerId) {
  const author = String(authorPeerId ?? '').trim();
  if (!author) return [];
  const rows = await db.wallComments.where('authorPeerId').equals(author).toArray();
  if (rows.length === 0) return [];
  await db.wallComments.bulkDelete(rows.map((r) => r.id));
  return rows.map((r) => ({ id: r.id, wallOwnerPeerId: r.wallOwnerPeerId }));
}

/**
 * Hard-delete ALL comments on a wall.
 * Used for account deletion cascades when deleting your own wall.
 * @param {string} wallOwnerPeerId
 * @returns {Promise<number>}
 */
export async function hardDeleteAllCommentsOnWall(wallOwnerPeerId) {
  const wall = String(wallOwnerPeerId ?? '').trim();
  if (!wall) return 0;
  const rows = await db.wallComments.where('wallOwnerPeerId').equals(wall).toArray();
  if (rows.length === 0) return 0;
  await db.wallComments.bulkDelete(rows.map((r) => r.id));
  return rows.length;
}

/**
 * Upsert a single comment received via P2P. Conflict rule: newer `(editedAt ?? createdAt)` wins.
 * @param {import('./schema.js').WallComment} incoming
 * @returns {Promise<boolean>} true if stored/updated, false if ignored
 */
export async function upsertWallCommentFromPeer(incoming) {
  if (!isWallCommentRecord(incoming)) return false;

  const existing = await db.wallComments.get(incoming.id);
  if (!existing) {
    await db.wallComments.put(incoming);
    return true;
  }

  const existingV = (typeof existing.editedAt === 'number' ? existing.editedAt : existing.createdAt) ?? 0;
  const incomingV = (typeof incoming.editedAt === 'number' ? incoming.editedAt : incoming.createdAt) ?? 0;

  if (incomingV > existingV) {
    await db.wallComments.put(incoming);
    return true;
  }

  // If versions tie, prefer preserving deletes.
  if (incomingV === existingV && existing.deleted && !incoming.deleted) return false;
  if (incomingV === existingV && incoming.deleted && !existing.deleted) {
    await db.wallComments.update(existing.id, { deleted: true });
    return true;
  }

  return false;
}

/**
 * @param {import('./schema.js').WallComment[]} comments
 * @returns {Promise<number>} number of applied upserts
 */
export async function upsertWallCommentsFromPeer(comments) {
  const list = Array.isArray(comments) ? comments : [];
  let applied = 0;
  for (const c of list) {
    const ok = await upsertWallCommentFromPeer(c);
    if (ok) applied += 1;
  }
  return applied;
}
