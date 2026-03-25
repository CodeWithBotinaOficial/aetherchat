import { writable } from 'svelte/store';
import { cleanOldGlobalMessages, getGlobalMessages, saveGlobalMessage } from '$lib/services/db.js';
import { snapshotText } from '$lib/utils/replies.js';

/**
 * @typedef {import('$lib/services/db.js').GlobalMessage} GlobalMessage
 */

/** @type {import('svelte/store').Writable<GlobalMessage[]>} */
export const globalMessages = writable([]);

/**
 * Pending reply items for the global chat composer.
 * @typedef {{ messageId: string, authorUsername: string, authorColor: string, textSnapshot: string }} PendingReply
 */

/** @type {import('svelte/store').Writable<PendingReply[]>} */
export const pendingReplies = writable([]);

// Protect against an initial DB load overwriting messages added during that load.
let globalMutation = 0;

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
        textSnapshot: snapshotText(message?.text, 120)
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
