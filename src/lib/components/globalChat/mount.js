/**
 * Extracted GlobalChat onMount setup to keep the Svelte file small.
 * @param {{
 *   getComposerEl: () => HTMLDivElement | null,
 *   setComposerPad: (n: number) => void,
 *   getListEl: () => HTMLDivElement | null,
 *   setIsTouch: (v: boolean) => void,
 *   setNow: (n: number) => void,
 *   globalMessagesStore: import('svelte/store').Writable<any[]>,
 *   loadGlobalMessages: (limit?: number) => Promise<void>,
 *   tick: () => Promise<void>,
 *   getMessages: () => any[],
 *   computeRange: (msgs: any[]) => void,
 *   maybeAutoScroll: () => boolean,
 *   scrollToBottom: () => Promise<void>
 * }} opts
 */
export function setupGlobalChatMount(opts) {
  const isTouch = window.matchMedia?.('(hover: none)')?.matches || (navigator.maxTouchPoints ?? 0) > 0;
  opts.setIsTouch(Boolean(isTouch));

  const nowTimer = setInterval(() => opts.setNow(Date.now()), 30_000);

  // Keep enough bottom padding so the fixed composer never covers messages on mobile.
  let cleanupResize = () => {};
  try {
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        const el = opts.getComposerEl();
        if (!el) return;
        opts.setComposerPad(el.offsetHeight + 20);
      });
      const el = opts.getComposerEl();
      if (el) ro.observe(el);
      if (el) opts.setComposerPad(el.offsetHeight + 20);
      cleanupResize = () => ro.disconnect();
    }
  } catch {
    cleanupResize = () => {};
  }

  const unsub = opts.globalMessagesStore.subscribe((msgs) => {
    opts.computeRange(msgs);
    if (opts.getListEl() && opts.maybeAutoScroll()) void opts.scrollToBottom();
  });

  (async () => {
    try {
      await opts.loadGlobalMessages();
      await opts.tick();
      await opts.scrollToBottom();
      opts.computeRange(opts.getMessages());
    } catch (err) {
      console.error('GlobalChat init failed', err);
    }
  })();

  return () => {
    unsub();
    try {
      cleanupResize();
    } catch {
      // ignore
    }
    clearInterval(nowTimer);
  };
}

