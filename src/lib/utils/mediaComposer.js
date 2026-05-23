import { derived, get, writable } from 'svelte/store';

/**
 * @param {import('$lib/services/klipy/types.js').KlipyItem} item
 * @returns {import('$lib/services/klipy/types.js').MessageMedia}
 */
function toMessageMedia(item) {
  return {
    id: String(item.id),
    type: item.type,
    url: String(item.url),
    previewUrl: String(item.previewUrl),
    width: Number(item.width) || 0,
    height: Number(item.height) || 0
  };
}

export function createComposer() {
  const text = writable('');
  /** @type {import('svelte/store').Writable<import('$lib/services/klipy/types.js').MessageMedia[]>} */
  const mediaItems = writable([]);

  const canAddMore = derived(mediaItems, (list) => (Array.isArray(list) ? list.length : 0) < 2);
  const hasContent = derived([text, mediaItems], ([$t, $m]) => String($t ?? '').trim().length > 0 || ($m?.length ?? 0) > 0);
  const isSoloMedia = derived([text, mediaItems], ([$t, $m]) => String($t ?? '').trim().length === 0 && ($m?.length ?? 0) > 0);

  /**
   * @param {import('$lib/services/klipy/types.js').KlipyItem} item
   */
  function addItem(item) {
    if (!get(canAddMore)) return;
    const mm = toMessageMedia(item);
    mediaItems.update((arr) => {
      const cur = Array.isArray(arr) ? arr : [];
      if (cur.some((x) => x.id === mm.id)) return cur;
      if (cur.length >= 2) return cur;
      return [...cur, mm];
    });
  }

  /**
   * @param {string} itemId
   */
  function removeItem(itemId) {
    const id = String(itemId ?? '').trim();
    if (!id) return;
    mediaItems.update((arr) => (Array.isArray(arr) ? arr.filter((x) => x.id !== id) : []));
  }

  function reset() {
    text.set('');
    mediaItems.set([]);
  }

  /**
   * @param {string} v
   */
  function setText(v) {
    text.set(String(v ?? ''));
  }

  /**
   * @param {import('$lib/services/klipy/types.js').MessageMedia[]|null|undefined} list
   */
  function setMedia(list) {
    const arr = Array.isArray(list) ? list.slice(0, 2) : [];
    mediaItems.set(arr);
  }

  function toPayload() {
    const t = String(get(text) ?? '');
    const m = get(mediaItems);
    const media = Array.isArray(m) && m.length > 0 ? m.slice(0, 2) : null;
    return { text: t, media };
  }

  return { text, mediaItems, canAddMore, hasContent, isSoloMedia, addItem, removeItem, reset, setText, setMedia, toPayload };
}
