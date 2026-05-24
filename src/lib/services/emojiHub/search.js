import { fetchAllEmojis } from './categories.js';

/**
 * @returns {Promise<import('./types.js').EmojiItem[]>}
 */
export async function buildSearchIndex() {
  return fetchAllEmojis();
}

/**
 * @param {string} query
 * @param {import('./types.js').EmojiItem[]} allEmojis
 * @returns {import('./types.js').EmojiItem[]}
 */
export function searchEmojis(query, allEmojis) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  const list = Array.isArray(allEmojis) ? allEmojis : [];
  const out = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const name = String(it.name ?? '').toLowerCase();
    if (!name.includes(q)) continue;
    out.push(it);
    if (out.length >= 50) break;
  }
  return out;
}

