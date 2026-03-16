import { writable } from 'svelte/store';
import { cleanOldGlobalMessages, getGlobalMessages, saveGlobalMessage } from '$lib/services/db.js';

/**
 * @typedef {import('$lib/services/db.js').GlobalMessage} GlobalMessage
 */

/** @type {import('svelte/store').Writable<GlobalMessage[]>} */
export const globalMessages = writable([]);

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
    globalMessages.update((arr) => [...arr, msg]);
    await saveGlobalMessage(msg);
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
