/**
 * Keeps the first item for each non-empty id.
 * @template {{ id?: string }} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function deduplicateById(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    const id = String(item?.id ?? '').trim();
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
