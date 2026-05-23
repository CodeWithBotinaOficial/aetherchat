import { getCached, setCached } from './cache.js';
import { klipyFetch } from './client.js';
import { normalizeV2Result } from './_map.js';

/**
 * @param {string} type
 * @param {string} query
 * @param {number} limit
 * @returns {string}
 */
function cacheKey(type, query, limit) {
  const q = encodeURIComponent(String(query ?? ''));
  const n = Math.max(1, Math.min(50, Math.floor(Number(limit) || 0) || 20));
  return `klipy_cache_${type}_${q}_${n}`;
}

/**
 * @param {number} [limit]
 * @returns {Promise<import('./types.js').KlipyItem[]>}
 */
export async function fetchTrendingGifs(limit = 20) {
  const n = Math.max(1, Math.min(50, Math.floor(Number(limit) || 0) || 20));
  const key = cacheKey('gifs_trending', 'trending', n);
  const hit = getCached(key);
  if (hit) return /** @type {any} */ (hit);

  const json = await klipyFetch('/featured', {
    params: {
      limit: n,
      contentfilter: 'low',
      media_filter: 'gif,tinygif,mediumgif,nanogif,preview'
    }
  });

  const results = Array.isArray(json?.results) ? json.results : [];
  const items = results
    .map((r) => normalizeV2Result(r))
    .filter(Boolean)
    .map((x) => ({ ...x, type: 'gif' }));

  setCached(key, items);
  return /** @type {any} */ (items);
}

/**
 * @param {string} query
 * @param {number} [limit]
 * @returns {Promise<import('./types.js').KlipyItem[]>}
 */
export async function searchGifs(query, limit = 20) {
  const q = String(query ?? '').trim();
  if (!q) return fetchTrendingGifs(limit);
  const n = Math.max(1, Math.min(50, Math.floor(Number(limit) || 0) || 20));
  const key = cacheKey('gifs_search', q, n);
  const hit = getCached(key);
  if (hit) return /** @type {any} */ (hit);

  const json = await klipyFetch('/search', {
    params: {
      q,
      limit: n,
      contentfilter: 'low',
      media_filter: 'gif,tinygif,mediumgif,nanogif,preview'
    }
  });

  const results = Array.isArray(json?.results) ? json.results : [];
  const items = results
    .map((r) => normalizeV2Result(r))
    .filter(Boolean)
    .map((x) => ({ ...x, type: 'gif' }));

  setCached(key, items);
  return /** @type {any} */ (items);
}

