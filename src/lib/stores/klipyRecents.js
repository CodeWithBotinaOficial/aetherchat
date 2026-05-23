import { readable } from 'svelte/store';

const KEY = 'aetherchat_klipy_recents';
const MAX = 10;

/**
 * @returns {import('$lib/services/klipy/types.js').KlipyItem[]}
 */
function load() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x === 'object' && typeof x.id === 'string' && (x.type === 'gif' || x.type === 'sticker'))
      .slice(0, MAX);
  } catch {
    return [];
  }
}

/**
 * @param {import('$lib/services/klipy/types.js').KlipyItem[]} items
 */
function save(items) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

/** @type {import('$lib/services/klipy/types.js').KlipyItem[] | null} */
let cached = null;
/** @type {Set<(items: any[]) => void>} */
const listeners = new Set();

export const recentItems = readable([], (set) => {
  if (cached === null) cached = load();
  set(cached);
  listeners.add(set);
  return () => listeners.delete(set);
});

/**
 * @param {import('$lib/services/klipy/types.js').KlipyItem} item
 */
export function addRecentItem(item) {
  if (!item || typeof item !== 'object') return;
  const id = String(item.id ?? '').trim();
  if (!id) return;
  const type = item.type === 'gif' || item.type === 'sticker' ? item.type : null;
  if (!type) return;
  if (cached === null) cached = load();

  const next = [item, ...(cached ?? []).filter((x) => x?.id !== id)].slice(0, MAX);
  cached = next;
  save(next);
  for (const fn of listeners) fn(next);
}

// Test-only helper (kept tiny; no production usage).
export function __resetRecentsForTest() {
  cached = null;
  for (const fn of listeners) fn([]);
}
