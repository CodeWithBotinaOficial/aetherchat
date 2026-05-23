/**
 * @param {any} formats
 * @param {string[]} order
 * @returns {{ url: string, width: number, height: number } | null}
 */
function pickFormat(formats, order) {
  for (const key of order) {
    const f = formats?.[key];
    const url = typeof f?.url === 'string' ? f.url : null;
    const dims = Array.isArray(f?.dims) ? f.dims : null;
    const width = typeof dims?.[0] === 'number' ? dims[0] : null;
    const height = typeof dims?.[1] === 'number' ? dims[1] : null;
    if (url && width && height) return { url, width, height };
    if (url) return { url, width: width ?? 0, height: height ?? 0 };
  }
  return null;
}

/**
 * Normalize a Tenor/Klipy v2 result item into {url, previewUrl, width, height}.
 * @param {any} r
 * @returns {{ id: string, url: string, previewUrl: string, width: number, height: number } | null}
 */
export function normalizeV2Result(r) {
  const id = typeof r?.id === 'string' ? r.id : null;
  if (!id) return null;

  const formats = r?.media_formats ?? r?.mediaFormats ?? null;
  if (!formats || typeof formats !== 'object') return null;

  const full = pickFormat(formats, ['gif', 'mediumgif', 'tinygif', 'nanogif', 'preview']);
  const prev = pickFormat(formats, ['tinygif', 'nanogif', 'preview', 'mediumgif', 'gif']);
  if (!full || !prev) return null;

  const w = full.width || prev.width || 0;
  const h = full.height || prev.height || 0;
  return {
    id,
    url: full.url,
    previewUrl: prev.url,
    width: w,
    height: h
  };
}

