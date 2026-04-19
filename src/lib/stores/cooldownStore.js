import { writable } from 'svelte/store';

/** @type {import('svelte/store').Writable<number|null>} */
export const deletionCooldownUntil = writable(null);

/**
 * @param {number|null} until
 */
export function setDeletionCooldownUntil(until) {
  const n = until === null ? null : Number(until);
  if (n === null) {
    deletionCooldownUntil.set(null);
    return;
  }
  if (!Number.isFinite(n)) return;
  deletionCooldownUntil.set(n);
}

