import { writable } from 'svelte/store';
import { cleanOldGlobalMessages, getGlobalMessages, saveGlobalMessage } from '$lib/services/db.js';

/**
 * @typedef {import('$lib/services/db.js').GlobalMessage} GlobalMessage
 */

/** @type {import('svelte/store').Writable<GlobalMessage[]>} */
export const globalMessages = writable([]);

/**
 * @param {GlobalMessage} msg
 */
export async function addGlobalMessage(msg) {
  try {
    globalMessages.update((arr) => [...arr, msg]);
    await saveGlobalMessage(msg);
  } catch (err) {
    console.error('addGlobalMessage failed', err);
    throw err;
  }
}

export async function loadGlobalMessages(limit) {
  try {
    const msgs = await getGlobalMessages(limit);
    globalMessages.set(msgs);
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

