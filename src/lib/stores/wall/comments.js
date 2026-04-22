import { get } from 'svelte/store';
import { user } from '$lib/stores/userStore.js';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import {
  addLocalWallComment,
  editWallCommentText,
  getWallComment,
  softDeleteWallComment
} from '$lib/services/db/wallComments.db.js';
import { broadcastProtocolEnvelope } from '$lib/services/peer.js';
import { currentWall } from './state.js';
import { ensureFollowingWallOwner } from './actions.js';

function myPeerId() {
  return String(get(peerStore)?.peerId ?? '').trim();
}

function buildFromLocalUser(u) {
  return {
    peerId: myPeerId(),
    username: String(u?.username ?? ''),
    color: String(u?.color ?? ''),
    age: Number(u?.age ?? 0)
  };
}

function clampText(raw) {
  const t = String(raw ?? '');
  if (t.length > 500) return t.slice(0, 500);
  return t;
}

export async function postWallComment(text) {
  const w = get(currentWall);
  const u = get(user);
  const me = myPeerId();
  const body = clampText(text).trim();
  if (!w || !u || !me) return;
  if (!body) return;

  // Auto-follow on first comment.
  if (!w.isOwner) await ensureFollowingWallOwner();

  const createdAt = Date.now();
  const comment = await addLocalWallComment({
    wallOwnerPeerId: w.ownerPeerId,
    authorPeerId: me,
    authorUsername: u.username,
    authorColor: u.color,
    authorAvatarBase64: u.avatarBase64 ?? null,
    text: body,
    createdAt
  });

  currentWall.update((prev) => {
    if (!prev || prev.ownerPeerId !== w.ownerPeerId) return prev;
    return { ...prev, comments: [comment, ...prev.comments].slice(0, 50) };
  });

  broadcastProtocolEnvelope({
    type: 'WALL_COMMENT_ADDED',
    from: buildFromLocalUser(u),
    payload: {
      id: comment.id,
      wallOwnerPeerId: comment.wallOwnerPeerId,
      authorPeerId: comment.authorPeerId,
      authorUsername: comment.authorUsername,
      authorColor: comment.authorColor,
      authorAvatarBase64: comment.authorAvatarBase64,
      text: comment.text,
      createdAt: comment.createdAt
    },
    timestamp: Date.now()
  });
}

export async function editWallComment(commentId, nextText) {
  const w = get(currentWall);
  const u = get(user);
  const me = myPeerId();
  if (!w || !u || !me) return;

  const id = String(commentId ?? '').trim();
  if (!id) return;

  const existing = await getWallComment(id);
  if (!existing || existing.deleted) return;
  if (existing.authorPeerId !== me) return;

  const text = clampText(nextText).trim();
  if (!text) return;

  const editedAt = Date.now();
  const ok = await editWallCommentText(id, text, editedAt);
  if (!ok) return;

  currentWall.update((prev) => {
    if (!prev || prev.ownerPeerId !== existing.wallOwnerPeerId) return prev;
    const next = prev.comments.map((c) => (c.id === id ? { ...c, text, editedAt } : c));
    return { ...prev, comments: next };
  });

  broadcastProtocolEnvelope({
    type: 'WALL_COMMENT_EDITED',
    from: buildFromLocalUser(u),
    payload: { id, wallOwnerPeerId: existing.wallOwnerPeerId, text, editedAt },
    timestamp: Date.now()
  });
}

export async function deleteWallComment(commentId) {
  const w = get(currentWall);
  const u = get(user);
  const me = myPeerId();
  if (!w || !u || !me) return;

  const id = String(commentId ?? '').trim();
  if (!id) return;

  const existing = await getWallComment(id);
  if (!existing) return;

  const canDelete = existing.authorPeerId === me || w.isOwner;
  if (!canDelete) return;

  const ok = await softDeleteWallComment(id);
  if (!ok) return;

  currentWall.update((prev) => {
    if (!prev || prev.ownerPeerId !== existing.wallOwnerPeerId) return prev;
    return { ...prev, comments: prev.comments.filter((c) => c.id !== id) };
  });

  broadcastProtocolEnvelope({
    type: 'WALL_COMMENT_DELETED',
    from: buildFromLocalUser(u),
    payload: { id, wallOwnerPeerId: existing.wallOwnerPeerId, authorPeerId: existing.authorPeerId },
    timestamp: Date.now()
  });
}

