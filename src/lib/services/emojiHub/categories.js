import { emojiHubFetch } from './client.js';
import { getCached, setCached } from './cache.js';

export const EMOJI_CATEGORIES = [
  { id: 'smileys-and-people', label: 'Smileys & People', emoji: '😀' },
  { id: 'animals-and-nature', label: 'Animals & Nature', emoji: '🐶' },
  { id: 'food-and-drink', label: 'Food & Drink', emoji: '🍔' },
  { id: 'travel-and-places', label: 'Travel & Places', emoji: '✈️' },
  { id: 'activities', label: 'Activities', emoji: '⚽' },
  { id: 'objects', label: 'Objects', emoji: '💡' },
  { id: 'symbols', label: 'Symbols', emoji: '❤️' },
  { id: 'flags', label: 'Flags', emoji: '🏳️' }
];

/**
 * @param {string} entity
 * @returns {string}
 */
function decodeHtmlEntity(entity) {
  const s = String(entity ?? '').trim();
  if (!s.startsWith('&#') || !s.endsWith(';')) return '';
  const inner = s.slice(2, -1).trim();
  if (!inner) return '';
  const cp = inner[0] === 'x' || inner[0] === 'X' ? Number.parseInt(inner.slice(1), 16) : Number.parseInt(inner, 10);
  if (!Number.isFinite(cp)) return '';
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

/**
 * @param {string} u
 * @returns {string}
 */
function decodeUnicodeCodepoint(u) {
  const s = String(u ?? '').trim().toUpperCase();
  if (!s.startsWith('U+')) return '';
  const hex = s.slice(2);
  const cp = Number.parseInt(hex, 16);
  if (!Number.isFinite(cp)) return '';
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

/**
 * @param {any} raw
 * @param {string} categoryId
 * @returns {import('./types.js').EmojiItem|null}
 */
function mapEmoji(raw, categoryId) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name ?? '').trim();
  const group = String(raw.group ?? '').trim();
  const htmlCode = Array.isArray(raw.htmlCode) ? raw.htmlCode.map((x) => String(x ?? '')) : [];
  const unicode = Array.isArray(raw.unicode) ? raw.unicode.map((x) => String(x ?? '')) : [];

  const fromHtml = htmlCode.map(decodeHtmlEntity).filter(Boolean).join('');
  const fromUni = unicode.map(decodeUnicodeCodepoint).filter(Boolean).join('');
  const char = fromHtml || fromUni;
  if (!name || !char) return null;

  return { name, category: String(categoryId ?? ''), group, htmlCode, unicode, char };
}

/**
 * @param {string} categoryId
 * @returns {Promise<import('./types.js').EmojiItem[]>}
 */
export async function fetchCategory(categoryId) {
  const id = String(categoryId ?? '').trim();
  const key = `aetherchat_emoji_cache_${id}`;
  const hit = getCached(key);
  if (hit) return /** @type {import('./types.js').EmojiItem[]} */ (hit);

  /** @type {any[]} */
  const raw = await emojiHubFetch(`/all/category/${encodeURIComponent(id)}`);
  const items = (Array.isArray(raw) ? raw : []).map((x) => mapEmoji(x, id)).filter(Boolean);
  setCached(key, items);
  return items;
}

/**
 * @returns {Promise<import('./types.js').EmojiItem[]>}
 */
export async function fetchAllEmojis() {
  const key = 'aetherchat_emoji_all';
  const hit = getCached(key);
  if (hit) return /** @type {import('./types.js').EmojiItem[]} */ (hit);

  /** @type {any[]} */
  const raw = await emojiHubFetch('/all');
  const items = (Array.isArray(raw) ? raw : []).map((x) => mapEmoji(x, String(x?.category ?? '').trim())).filter(Boolean);
  setCached(key, items);
  return items;
}
