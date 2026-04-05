import { writable } from 'svelte/store';
import { cleanOldGlobalMessages, getGlobalMessage, getGlobalMessages, saveGlobalMessage, updateGlobalMessage } from '$lib/services/db.js';
import { snapshotText } from '$lib/utils/replies.js';

/**
 * @typedef {import('$lib/services/db.js').GlobalMessage} GlobalMessage
 */

/** @type {import('svelte/store').Writable<GlobalMessage[]>} */
export const globalMessages = writable([]);

/**
 * Pending reply items for the global chat composer.
 * @typedef {{ messageId: string, authorUsername: string, authorColor: string, textSnapshot: string, timestamp?: number, deleted?: boolean }} PendingReply
 */

/** @type {import('svelte/store').Writable<PendingReply[]>} */
export const pendingReplies = writable([]);

/** @type {import('svelte/store').Writable<string|null>} */
export const editingMessageId = writable(null);

// Protect against an initial DB load overwriting messages added during that load.
let globalMutation = 0;

const GLOBAL_EDIT_WINDOW_MS = 30 * 60 * 1000;
export const GLOBAL_DELETED_PLACEHOLDER = '[ This message was deleted ]';
export const CITED_DELETED_PLACEHOLDER = '[ Original message deleted ]';

/**
 * @param {GlobalMessage} m
 * @returns {string}
 */
function msgKey(m) {
  if (m && typeof m.id !== 'undefined' && m.id !== null) return `id:${m.id}`;
  return `t:${m?.timestamp}|p:${m?.peerId}|u:${m?.username}|x:${m?.text}`;
}

/**
 * @param {GlobalMessage[]} dbMsgs
 * @param {GlobalMessage[]} curMsgs
 * @returns {GlobalMessage[]}
 */
function mergeMessages(dbMsgs, curMsgs) {
  const map = new Map();
  for (const m of dbMsgs ?? []) map.set(msgKey(m), m);
  for (const m of curMsgs ?? []) map.set(msgKey(m), m);
  return Array.from(map.values()).sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}

/**
 * @param {GlobalMessage} msg
 */
export async function addGlobalMessage(msg) {
  try {
    globalMutation += 1;
    const id =
      msg?.id ??
      (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `m-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const withId = { ...msg, id };

    globalMessages.update((arr) => {
      // Avoid duplicate inserts when receiving the same message via multiple paths (sync + live).
      if (arr.some((m) => m?.id && m.id === id)) return arr;
      return [...arr, withId];
    });

    await saveGlobalMessage(withId);
  } catch (err) {
    console.error('addGlobalMessage failed', err);
    throw err;
  }
}

export async function loadGlobalMessages(limit) {
  try {
    const mutationBefore = globalMutation;
    const msgs = await getGlobalMessages(limit);
    if (mutationBefore !== globalMutation) {
      globalMessages.update((cur) => mergeMessages(msgs, cur));
    } else {
      globalMessages.set(msgs);
    }
  } catch (err) {
    console.error('loadGlobalMessages failed', err);
    throw err;
  }
}

export async function clearExpiredMessages() {
  try {
    await cleanOldGlobalMessages();
    await loadGlobalMessages();
  } catch (err) {
    console.error('clearExpiredMessages failed', err);
    throw err;
  }
}

/**
 * Prepend/merge older messages into the in-memory list (used for scroll-to-original paging).
 * @param {GlobalMessage[]} msgs
 */
export function prependGlobalMessages(msgs) {
  globalMutation += 1;
  const list = Array.isArray(msgs) ? msgs : [];
  if (list.length === 0) return;
  globalMessages.update((cur) => mergeMessages(list, cur));
}

/**
 * @param {GlobalMessage} message
 */
export function addPendingReply(message) {
  const id = String(message?.id ?? '').trim();
  if (!id) return;
  pendingReplies.update((arr) => {
    if (arr.some((r) => r.messageId === id)) return arr;
    return [
      ...arr,
      {
        messageId: id,
        authorUsername: String(message?.username ?? '').trim() || 'unknown',
        authorColor: String(message?.color ?? '').trim() || 'hsl(0, 0%, 65%)',
        textSnapshot: snapshotText(message?.text, 120),
        timestamp: typeof message?.timestamp === 'number' ? message.timestamp : 0,
        deleted: Boolean(message?.deleted)
      }
    ];
  });
}

/**
 * @param {string} messageId
 */
export function removePendingReply(messageId) {
  const id = String(messageId ?? '').trim();
  if (!id) return;
  pendingReplies.update((arr) => arr.filter((r) => r.messageId !== id));
}

export function clearPendingReplies() {
  pendingReplies.set([]);
}

/**
 * Replace pending replies list (used by edit mode).
 * @param {any[]|null} list
 */
export function setPendingReplies(list) {
  const next = Array.isArray(list) ? list : [];
  pendingReplies.set(
    next
      .filter((r) => r && typeof r === 'object' && typeof r.messageId === 'string' && r.messageId.trim().length > 0)
      .map((r) => ({
        messageId: String(r.messageId),
        authorUsername: String(r.authorUsername ?? '').trim() || 'unknown',
        authorColor: String(r.authorColor ?? '').trim() || 'hsl(0, 0%, 65%)',
        textSnapshot: snapshotText(r.textSnapshot ?? '', 120),
        timestamp: typeof r.timestamp === 'number' ? r.timestamp : 0,
        deleted: Boolean(r.deleted)
      }))
  );
}

/**
 * @param {GlobalMessage} m
 * @param {string} actorUsername
 */
function canActorMutateGlobal(m, actorUsername) {
  if (!m || typeof m !== 'object') return false;
  const actor = String(actorUsername ?? '').trim();
  if (!actor) return false;
  if (String(m.username ?? '').trim() !== actor) return false;
  if (m.deleted) return false;
  const ts = typeof m.timestamp === 'number' ? m.timestamp : 0;
  return Date.now() - ts <= GLOBAL_EDIT_WINDOW_MS;
}

/**
 * Update a global message in-memory without changing its position (sort order unchanged).
 * Returns true if the update was applied.
 *
 * @param {string} messageId
 * @param {{ text?: string, editedAt?: number|null, replies?: any[]|null }} patch
 * @param {string} actorUsername
 */
export function updateMessage(messageId, patch, actorUsername) {
  const id = String(messageId ?? '').trim();
  if (!id) return false;
  if (!patch || typeof patch !== 'object') return false;

  let applied = false;
  globalMutation += 1;
  globalMessages.update((arr) => {
    const idx = arr.findIndex((m) => m?.id === id);
    if (idx < 0) return arr;
    const cur = arr[idx];
    if (!canActorMutateGlobal(cur, actorUsername)) return arr;

    const next = arr.slice();
    next[idx] = {
      ...cur,
      text: Object.prototype.hasOwnProperty.call(patch, 'text') ? String(patch.text ?? '') : cur.text,
      editedAt: Object.prototype.hasOwnProperty.call(patch, 'editedAt') ? (patch.editedAt ?? null) : cur.editedAt ?? null,
      replies: Object.prototype.hasOwnProperty.call(patch, 'replies')
        ? (Array.isArray(patch.replies) && patch.replies.length > 0 ? patch.replies : null)
        : cur.replies ?? null
    };
    applied = true;
    return next;
  });
  return applied;
}

/**
 * Soft-delete a global message in-memory (does not remove it from the array).
 * Returns true if the delete was applied.
 *
 * @param {string} messageId
 * @param {string} actorUsername
 */
export function deleteMessage(messageId, actorUsername) {
  const id = String(messageId ?? '').trim();
  if (!id) return false;

  let applied = false;
  globalMutation += 1;
  globalMessages.update((arr) => {
    const idx = arr.findIndex((m) => m?.id === id);
    if (idx < 0) return arr;
    const cur = arr[idx];
    if (!canActorMutateGlobal(cur, actorUsername)) return arr;

    const next = arr.slice();
    next[idx] = { ...cur, deleted: true, text: GLOBAL_DELETED_PLACEHOLDER };
    applied = true;
    return next;
  });
  return applied;
}

/**
 * Update quoted reply cards for all messages that cited `originalMessageId`.
 * Returns number of messages updated in-memory.
 *
 * @param {string} originalMessageId
 * @param {{ newSnapshot?: string, deleted?: boolean }} change
 */
export function cascadeUpdateCitations(originalMessageId, change) {
  const target = String(originalMessageId ?? '').trim();
  if (!target) return 0;
  const markDeleted = Boolean(change?.deleted);
  const newSnap = typeof change?.newSnapshot === 'string' ? change.newSnapshot : null;

  let touched = 0;
  globalMutation += 1;
  globalMessages.update((arr) => {
    let any = false;
    const next = arr.map((m) => {
      const replies = Array.isArray(m?.replies) ? m.replies : null;
      if (!replies) return m;
      let changed = false;
      const updatedReplies = replies.map((r) => {
        if (!r || typeof r !== 'object') return r;
        if (String(r.messageId ?? '') !== target) return r;
        changed = true;
        const base = { ...r };
        if (markDeleted) {
          base.deleted = true;
          base.textSnapshot = CITED_DELETED_PLACEHOLDER;
        } else if (newSnap !== null) {
          base.deleted = false;
          base.textSnapshot = snapshotText(newSnap, 120);
        }
        return base;
      });
      if (!changed) return m;
      any = true;
      touched += 1;
      return { ...m, replies: updatedReplies };
    });
    return any ? next : arr;
  });

  // Best-effort: keep composer pending previews in sync.
  pendingReplies.update((arr) => {
    let any = false;
    const next = arr.map((r) => {
      if (!r || typeof r !== 'object') return r;
      if (String(r.messageId ?? '') !== target) return r;
      any = true;
      if (markDeleted) return { ...r, deleted: true, textSnapshot: CITED_DELETED_PLACEHOLDER };
      if (newSnap !== null) return { ...r, deleted: false, textSnapshot: snapshotText(newSnap, 120) };
      return r;
    });
    return any ? next : arr;
  });

  return touched;
}

/**
 * Persist a global message patch, and cascade quoted previews in DB.
 * This is used by P2P handlers and UI flows.
 *
 * @param {string} messageId
 * @param {Partial<GlobalMessage>} patch
 * @param {{ cascadeFromText?: string, cascadeDeleted?: boolean }} cascade
 */
export async function persistMessagePatchWithCascade(messageId, patch, cascade = {}) {
  const id = String(messageId ?? '').trim();
  if (!id) return;

  await updateGlobalMessage(id, patch);

  const cascadeText = typeof cascade?.cascadeFromText === 'string' ? cascade.cascadeFromText : null;
  const cascadeDeleted = Boolean(cascade?.cascadeDeleted);
  if (!cascadeText && !cascadeDeleted) return;

  // No index for nested replies; scan the (small) globalMessages table.
  const all = await getGlobalMessages(500);
  const touched = [];
  for (const m of all) {
    const replies = Array.isArray(m?.replies) ? m.replies : null;
    if (!replies) continue;
    let changed = false;
    const updated = replies.map((r) => {
      if (!r || typeof r !== 'object') return r;
      if (String(r.messageId ?? '') !== id) return r;
      changed = true;
      if (cascadeDeleted) return { ...r, deleted: true, textSnapshot: CITED_DELETED_PLACEHOLDER };
      return { ...r, deleted: false, textSnapshot: snapshotText(cascadeText, 120) };
    });
    if (changed) touched.push({ id: m.id, replies: updated });
  }

  if (touched.length === 0) return;
  await Promise.all(touched.map((t) => updateGlobalMessage(t.id, { replies: t.replies })));
}

/**
 * @param {string} messageId
 * @param {string} actorUsername
 */
export async function isGlobalEditAllowed(messageId, actorUsername) {
  const id = String(messageId ?? '').trim();
  if (!id) return false;
  const m = await getGlobalMessage(id);
  if (!m) return false;
  return canActorMutateGlobal(m, actorUsername);
}
