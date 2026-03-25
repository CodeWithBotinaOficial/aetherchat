/**
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export function truncateWithEllipsis(text, max) {
  const s = String(text ?? '');
  const n = Number(max);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (s.length <= n) return s;
  // Use a single Unicode ellipsis character (matches the product spec).
  return `${s.slice(0, Math.max(0, n - 1))}…`;
}

/**
 * Normalizes and snapshots message text for quotes/replies.
 * @param {string} text
 * @param {number} [max=120]
 * @returns {string}
 */
export function snapshotText(text, max = 120) {
  return truncateWithEllipsis(String(text ?? '').trim(), max);
}

/**
 * @param {string} text
 * @param {number} [max=80]
 * @returns {string}
 */
export function previewText(text, max = 80) {
  return truncateWithEllipsis(String(text ?? '').trim(), max);
}

/**
 * @param {string} messageId
 * @returns {string}
 */
export function cssEscape(messageId) {
  const raw = String(messageId ?? '');
  // Prefer built-in escape where available.
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(raw);
  // Minimal escape: safe for UUID-like IDs used by this app.
  return raw.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

