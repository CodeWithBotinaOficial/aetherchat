import { readable } from 'svelte/store';

const KEY = 'aetherchat_emoji_recents';
const MAX = 24;

/**
 * @returns {string[]}
 */
function load() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => String(x ?? ''))
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, MAX);
  } catch {
    return [];
  }
}

/**
 * @param {string[]} items
 */
function save(items) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

/** @type {string[] | null} */
let cached = null;
/** @type {Set<(items: string[]) => void>} */
const listeners = new Set();

export const recentEmojis = readable([], (set) => {
  if (cached === null) cached = load();
  set(cached);
  listeners.add(set);
  return () => listeners.delete(set);
});

/**
 * @param {string} char
 */
export function addRecentEmoji(char) {
  const c = String(char ?? '').trim();
  if (!c) return;
  if (cached === null) cached = load();

  const next = [c, ...(cached ?? []).filter((x) => x !== c)].slice(0, MAX);
  cached = next;
  save(next);
  for (const fn of listeners) fn(next);
}

export function __resetEmojiRecentsForTest() {
  cached = null;
  for (const fn of listeners) fn([]);
}

