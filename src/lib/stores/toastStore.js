import { writable } from 'svelte/store';

/**
 * @typedef {{ id: string, message: string, createdAt: number }} Toast
 */

/** @type {import('svelte/store').Writable<Toast[]>} */
export const toasts = writable([]);

/**
 * @param {string} message
 * @param {{ durationMs?: number }} [opts]
 */
export function showToast(message, opts = {}) {
  const text = String(message ?? '').trim();
  if (!text) return;
  const id = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `t-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const createdAt = Date.now();
  const durationMs = Number.isFinite(opts.durationMs) ? Math.max(800, Math.min(8000, opts.durationMs)) : 2200;

  toasts.update((arr) => [...arr, { id, message: text, createdAt }]);
  setTimeout(() => dismissToast(id), durationMs);
}

/**
 * @param {string} id
 */
export function dismissToast(id) {
  const key = String(id ?? '').trim();
  if (!key) return;
  toasts.update((arr) => arr.filter((t) => t.id !== key));
}

