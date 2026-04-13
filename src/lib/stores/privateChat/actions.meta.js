import { snapshotText } from '$lib/utils/replies.js';
import { updateChatMeta } from '$lib/services/db.js';

import { CITED_DELETED_PLACEHOLDER, PRIVATE_DELETED_PLACEHOLDER, withChat } from './state.js';

export function setChatOnlineStatus(theirPeerId, isOnline) {
  withChat((chats) => {
    for (const [id, chat] of chats.entries()) {
      if (chat.theirPeerId === theirPeerId) chats.set(id, { ...chat, isOnline });
    }
  });
}

export function markChatAsRead(chatId) {
  withChat((chats) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    chats.set(chatId, { ...chat, unreadCount: 0 });
  });
  updateChatMeta(chatId, { unreadCount: 0 }).catch((err) => console.error('updateChatMeta failed', err));
}

/**
 * @typedef {{ messageId: string, authorUsername: string, authorColor: string, textSnapshot: string, timestamp?: number, deleted?: boolean }} PendingReply
 */

/**
 * @param {string} chatId
 * @param {{ id?: string, username?: string, color?: string, text?: string }} message
 */
export function addPendingReply(chatId, message) {
  const cid = String(chatId ?? '').trim();
  if (!cid) return;
  const mid = String(message?.id ?? '').trim();
  if (!mid) return;

  withChat((chats) => {
    const chat = chats.get(cid);
    if (!chat) return;
    /** @type {PendingReply[]} */
    const cur = Array.isArray(chat.pendingReplies) ? chat.pendingReplies : [];
    if (cur.some((r) => r.messageId === mid)) return;
    const next = [
      ...cur,
      {
        messageId: mid,
        authorUsername: String(message?.username ?? '').trim() || 'unknown',
        authorColor: String(message?.color ?? '').trim() || 'hsl(0, 0%, 65%)',
        textSnapshot: snapshotText(message?.text, 120),
        timestamp: typeof message?.timestamp === 'number' ? message.timestamp : 0,
        deleted: Boolean(message?.deleted)
      }
    ];
    chats.set(cid, { ...chat, pendingReplies: next });
  });
}

/**
 * @param {string} chatId
 * @param {string} messageId
 */
export function removePendingReply(chatId, messageId) {
  const cid = String(chatId ?? '').trim();
  const mid = String(messageId ?? '').trim();
  if (!cid || !mid) return;
  withChat((chats) => {
    const chat = chats.get(cid);
    if (!chat) return;
    const cur = Array.isArray(chat.pendingReplies) ? chat.pendingReplies : [];
    chats.set(cid, { ...chat, pendingReplies: cur.filter((r) => r.messageId !== mid) });
  });
}

/**
 * @param {string} chatId
 */
export function clearPendingReplies(chatId) {
  const cid = String(chatId ?? '').trim();
  if (!cid) return;
  withChat((chats) => {
    const chat = chats.get(cid);
    if (!chat) return;
    chats.set(cid, { ...chat, pendingReplies: [] });
  });
}

/**
 * Replace pending replies list for a given chat (used by edit mode).
 * @param {string} chatId
 * @param {any[]|null} list
 */
export function setPendingReplies(chatId, list) {
  const cid = String(chatId ?? '').trim();
  if (!cid) return;
  const next = Array.isArray(list) ? list : [];
  withChat((chats) => {
    const chat = chats.get(cid);
    if (!chat) return;
    chats.set(cid, {
      ...chat,
      pendingReplies: next
        .filter((r) => r && typeof r === 'object' && typeof r.messageId === 'string' && r.messageId.trim().length > 0)
        .map((r) => ({
          messageId: String(r.messageId),
          authorUsername: String(r.authorUsername ?? '').trim() || 'unknown',
          authorColor: String(r.authorColor ?? '').trim() || 'hsl(0, 0%, 65%)',
          textSnapshot: snapshotText(r.textSnapshot ?? '', 120),
          timestamp: typeof r.timestamp === 'number' ? r.timestamp : 0,
          deleted: Boolean(r.deleted)
        }))
    });
  });
}

function normalizeActor(actor) {
  return actor === 'them' ? 'them' : 'me';
}

/**
 * Update a private message in-memory without changing its position.
 * Returns true if applied.
 *
 * @param {string} chatId
 * @param {string} messageId
 * @param {{ text?: string, editedAt?: number|null, replies?: any[]|null, deleted?: boolean }} patch
 * @param {'me'|'them'} actor
 */
export function updateMessage(chatId, messageId, patch, actor = 'me') {
  const cid = String(chatId ?? '').trim();
  const mid = String(messageId ?? '').trim();
  if (!cid || !mid) return false;
  if (!patch || typeof patch !== 'object') return false;
  const who = normalizeActor(actor);

  let applied = false;
  withChat((chats) => {
    const chat = chats.get(cid);
    if (!chat) return;
    const idx = chat.messages.findIndex((m) => m?.id === mid);
    if (idx < 0) return;
    const cur = chat.messages[idx];
    // Deleted messages stay deleted; editing a deleted message is not allowed.
    if (cur?.deleted && patch.deleted !== true) return;
    const allowed =
      who === 'me'
        ? cur?.direction === 'sent'
        : cur?.direction === 'received';
    if (!allowed) return;

    const nextMessages = chat.messages.slice();
    nextMessages[idx] = {
      ...cur,
      text: Object.prototype.hasOwnProperty.call(patch, 'text') ? String(patch.text ?? '') : cur.text,
      editedAt: Object.prototype.hasOwnProperty.call(patch, 'editedAt') ? (patch.editedAt ?? null) : cur.editedAt ?? null,
      replies: Object.prototype.hasOwnProperty.call(patch, 'replies')
        ? (Array.isArray(patch.replies) && patch.replies.length > 0 ? patch.replies : null)
        : cur.replies ?? null,
      deleted: Object.prototype.hasOwnProperty.call(patch, 'deleted') ? Boolean(patch.deleted) : Boolean(cur.deleted),
      ciphertext: Object.prototype.hasOwnProperty.call(patch, 'ciphertext') ? patch.ciphertext : cur.ciphertext,
      iv: Object.prototype.hasOwnProperty.call(patch, 'iv') ? patch.iv : cur.iv,
      repliesCiphertext: Object.prototype.hasOwnProperty.call(patch, 'repliesCiphertext') ? patch.repliesCiphertext : cur.repliesCiphertext,
      repliesIv: Object.prototype.hasOwnProperty.call(patch, 'repliesIv') ? patch.repliesIv : cur.repliesIv,
      sealed: Object.prototype.hasOwnProperty.call(patch, 'sealed') ? Boolean(patch.sealed) : Boolean(cur.sealed)
    };
    chats.set(cid, { ...chat, messages: nextMessages });
    applied = true;
  });
  return applied;
}

/**
 * Soft-delete a private message in-memory.
 * Returns true if applied.
 *
 * @param {string} chatId
 * @param {string} messageId
 * @param {'me'|'them'} actor
 */
export function deleteMessage(chatId, messageId, actor = 'me') {
  return updateMessage(chatId, messageId, { deleted: true, text: PRIVATE_DELETED_PLACEHOLDER }, actor);
}

/**
 * Cascade update quoted reply cards for all messages in a chat that cited `originalMessageId`.
 * Returns count of messages updated in-memory.
 *
 * @param {string} chatId
 * @param {string} originalMessageId
 * @param {{ newSnapshot?: string, deleted?: boolean }} change
 */
export function cascadeUpdateCitations(chatId, originalMessageId, change) {
  const cid = String(chatId ?? '').trim();
  const target = String(originalMessageId ?? '').trim();
  if (!cid || !target) return 0;
  const markDeleted = Boolean(change?.deleted);
  const newSnap = typeof change?.newSnapshot === 'string' ? change.newSnapshot : null;

  let touched = 0;
  withChat((chats) => {
    const chat = chats.get(cid);
    if (!chat) return;
    let any = false;
    const nextMessages = chat.messages.map((m) => {
      const replies = Array.isArray(m?.replies) ? m.replies : null;
      if (!replies) return m;
      let changed = false;
      const updated = replies.map((r) => {
        if (!r || typeof r !== 'object') return r;
        if (String(r.messageId ?? '') !== target) return r;
        changed = true;
        if (markDeleted) return { ...r, deleted: true, textSnapshot: CITED_DELETED_PLACEHOLDER };
        if (newSnap !== null) return { ...r, deleted: false, textSnapshot: snapshotText(newSnap, 120) };
        return r;
      });
      if (!changed) return m;
      any = true;
      touched += 1;
      return { ...m, replies: updated };
    });
    if (!any) return;

    // Keep composer pending previews in sync too.
    const pending = Array.isArray(chat.pendingReplies) ? chat.pendingReplies : [];
    const nextPending = pending.map((r) => {
      if (!r || typeof r !== 'object') return r;
      if (String(r.messageId ?? '') !== target) return r;
      if (markDeleted) return { ...r, deleted: true, textSnapshot: CITED_DELETED_PLACEHOLDER };
      if (newSnap !== null) return { ...r, deleted: false, textSnapshot: snapshotText(newSnap, 120) };
      return r;
    });

    chats.set(cid, { ...chat, messages: nextMessages, pendingReplies: nextPending });
  });
  return touched;
}
