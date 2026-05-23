const PREFIX = 'klipy_cache_';

const TTL_TRENDING_MS = 10 * 60 * 1000;
const TTL_SEARCH_MS = 5 * 60 * 1000;

/**
 * @param {string} key
 * @returns {number}
 */
function ttlForKey(key) {
  const k = String(key ?? '');
  if (k.includes('_trending_') || k.includes('_trending')) return TTL_TRENDING_MS;
  if (k.includes('_search_') || k.includes('search')) return TTL_SEARCH_MS;
  // Default to search TTL to be conservative.
  return TTL_SEARCH_MS;
}

/**
 * @param {string} key
 * @returns {{ data: any[], cachedAt: number } | null}
 */
function readEntry(key) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.data)) return null;
    if (typeof parsed.cachedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @returns {any[] | null}
 */
export function getCached(key) {
  const k = String(key ?? '').trim();
  if (!k) return null;
  const entry = readEntry(k);
  if (!entry) return null;
  const age = Date.now() - entry.cachedAt;
  if (age < 0) return null;
  if (age > ttlForKey(k)) return null;
  return entry.data;
}

/**
 * @param {string} key
 * @param {any[]} data
 */
export function setCached(key, data) {
  const k = String(key ?? '').trim();
  if (!k) return;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      k,
      JSON.stringify({
        data: Array.isArray(data) ? data : [],
        cachedAt: Date.now()
      })
    );
  } catch {
    // ignore (quota/unavailable); never crash the app due to caching.
  }
}

export function clearExpired() {
  if (typeof localStorage === 'undefined') return;
  try {
    const now = Date.now();
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      const entry = readEntry(k);
      if (!entry) continue;
      const age = now - entry.cachedAt;
      if (age < 0) continue;
      if (age > ttlForKey(k)) localStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}

