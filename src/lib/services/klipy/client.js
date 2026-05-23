import { PUBLIC_KLIPY_API_KEY } from '$env/static/public';

export class KlipyError extends Error {
  /**
   * @param {{ status?: number|null, message: string }} opts
   */
  constructor(opts) {
    super(opts?.message || 'Klipy request failed');
    this.name = 'KlipyError';
    /** @type {number|null} */
    this.status = typeof opts?.status === 'number' ? opts.status : null;
  }
}

const BASE_URL = 'https://api.klipy.com/v2';

/**
 * @param {Record<string, string | number | boolean | null | undefined>} params
 * @returns {string}
 */
function toQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === null || typeof v === 'undefined') continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Thin fetch wrapper around Klipy's Tenor-compatible v2 API.
 * Attaches the API key via query param (`key`) and a header (best-effort).
 *
 * @template T
 * @param {string} path
 * @param {{ params?: Record<string, any> }} [opts]
 * @returns {Promise<T>}
 */
export async function klipyFetch(path, opts = {}) {
  const key = String(PUBLIC_KLIPY_API_KEY ?? '').trim();
  if (!key) throw new KlipyError({ status: null, message: 'Klipy API key not found. Set PUBLIC_KLIPY_API_KEY.' });

  const p = String(path ?? '').startsWith('/') ? String(path ?? '') : `/${String(path ?? '')}`;
  const params = { ...(opts?.params ?? {}), key };
  const url = `${BASE_URL}${p}${toQuery(params)}`;

  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        // Klipy v2 is Tenor-compatible, but some deployments also accept header auth.
        // Never log this value.
        'X-KLIPY-API-KEY': key
      }
    });
  } catch {
    throw new KlipyError({ status: null, message: 'Network error. Check your connection.' });
  }

  if (!res.ok) {
    let msg = `Klipy request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body && typeof body === 'object' && typeof body?.error === 'string') msg = body.error;
      if (body && typeof body === 'object' && typeof body?.message === 'string') msg = body.message;
    } catch {
      // ignore
    }
    throw new KlipyError({ status: res.status, message: msg });
  }

  try {
    return /** @type {T} */ (await res.json());
  } catch {
    throw new KlipyError({ status: res.status, message: 'Invalid response from Klipy.' });
  }
}

