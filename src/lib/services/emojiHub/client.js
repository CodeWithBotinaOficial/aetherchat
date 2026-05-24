export class EmojiHubError extends Error {
  /**
   * @param {{ status?: number|null, message: string }} opts
   */
  constructor(opts) {
    super(opts?.message || 'EmojiHub request failed');
    this.name = 'EmojiHubError';
    /** @type {number|null} */
    this.status = typeof opts?.status === 'number' ? opts.status : null;
  }
}

const BASE_URL = 'https://emojihub.yurace.pro/api';

/**
 * @template T
 * @param {string} path
 * @returns {Promise<T>}
 */
export async function emojiHubFetch(path) {
  const p = String(path ?? '').startsWith('/') ? String(path ?? '') : `/${String(path ?? '')}`;
  const url = `${BASE_URL}${p}`;

  let res;
  try {
    res = await fetch(url, { method: 'GET' });
  } catch {
    throw new EmojiHubError({ status: null, message: 'Network error. Check your connection.' });
  }

  if (!res.ok) {
    let msg = `EmojiHub request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body && typeof body === 'object' && typeof body?.message === 'string') msg = body.message;
      if (body && typeof body === 'object' && typeof body?.error === 'string') msg = body.error;
    } catch {
      // ignore
    }
    throw new EmojiHubError({ status: res.status, message: msg });
  }

  try {
    return /** @type {T} */ (await res.json());
  } catch (err) {
    if (import.meta.env.DEV) console.error('EmojiHub invalid JSON', err);
    throw new EmojiHubError({ status: res.status, message: 'Invalid response from EmojiHub.' });
  }
}

