import { cssEscape } from '$lib/utils/replies.js';

/**
 * Scrolls to a message id, paging older messages into memory if needed.
 * @param {{
 *   messageId: string,
 *   listEl: HTMLDivElement | null,
 *   getMessages: () => any[],
 *   windowed: boolean,
 *   estItemH: number,
 *   computeRange: (msgs: any[]) => void,
 *   tick: () => Promise<void>,
 *   getGlobalMessagesPage: (beforeTimestamp: number, limit?: number) => Promise<any[]>,
 *   prependGlobalMessages: (msgs: any[]) => void,
 *   showToast: (msg: string) => void
 * }} opts
 */
export async function scrollToAndHighlight(opts) {
  const id = String(opts.messageId ?? '').trim();
  if (!id || !opts.listEl) return;

  const listEl = opts.listEl;
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  const tryFindEl = () => listEl?.querySelector?.(`[data-message-id="${cssEscape(id)}"]`) ?? null;

  // Ensure the message is in memory (page older messages if needed).
  let guard = 0;
  while (!(opts.getMessages() ?? []).some((m) => m?.id === id) && guard < 12) {
    guard += 1;
    const msgs = opts.getMessages() ?? [];
    const oldest = msgs?.[0]?.timestamp ?? Date.now();
    const page = await opts.getGlobalMessagesPage(oldest, 80);
    if (!page || page.length === 0) break;
    opts.prependGlobalMessages(page);
    await opts.tick();
  }

  const msgs2 = opts.getMessages() ?? [];
  const idx = msgs2.findIndex((m) => m?.id === id);
  if (idx < 0) {
    opts.showToast('Original message not available.');
    return;
  }

  if (opts.windowed) {
    listEl.scrollTop = Math.max(0, idx * opts.estItemH - opts.estItemH * 2);
    opts.computeRange(msgs2);
    await opts.tick();
  }

  if (!tryFindEl()) {
    opts.computeRange(msgs2);
    await opts.tick();
  }

  const el2 = tryFindEl();
  if (!el2) {
    opts.showToast('Original message not available.');
    return;
  }

  el2.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'center' });
  if (prefersReduced) return;
  el2.classList.add('aether-highlight');
  setTimeout(() => el2.classList.remove('aether-highlight'), 1500);
}

