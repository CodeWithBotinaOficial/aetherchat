/**
 * Swipe-to-reply controller for MessageBubble (touch devices only).
 * Keeps state in a mutable object so the Svelte component can bind to `state.dragX`.
 *
 * @param {{
 *   isEnabled: () => boolean,
 *   isOwn: () => boolean,
 *   onReply: () => void,
 * }} opts
 * @returns {{
 *   state: { dragX: number, animatingBack: boolean, suppressTap: boolean },
 *   onTouchStart: (e: any) => void,
 *   onTouchMove: (e: any) => void,
 *   onTouchEnd: () => void,
 *   destroy: () => void
 * }}
 */
export const SWIPE_THRESHOLD_PX = 64;

export function createSwipeToReply(opts) {
  const state = { dragX: 0, animatingBack: false, suppressTap: false };
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let animTimer = 0;

  const SWIPE_MAX = 96;
  // Keep this exported so MessageBubble can derive underlay opacity consistently.
  // Tests depend on this threshold being ~60px.
  const SWIPE_THRESHOLD = SWIPE_THRESHOLD_PX;

  function snapBack() {
    state.animatingBack = true;
    state.dragX = 0;
    clearTimeout(animTimer);
    animTimer = setTimeout(() => {
      state.animatingBack = false;
    }, 180);
  }

  function onTouchStart(e) {
    if (!opts.isEnabled()) return;
    if (!e?.touches?.length) return;
    state.suppressTap = false;
    dragging = true;
    state.animatingBack = false;
    state.dragX = 0;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }

  function onTouchMove(e) {
    if (!opts.isEnabled()) return;
    if (!dragging) return;
    if (!e?.touches?.length) return;
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const dx = x - startX;
    const dy = y - startY;

    // Cancel if the user is scrolling vertically.
    if (Math.abs(dy) > Math.abs(dx)) {
      dragging = false;
      state.dragX = 0;
      return;
    }

    // Only accept the "reply" swipe direction.
    // Own (right-aligned): swipe LEFT. Other (left-aligned): swipe RIGHT.
    const dir = opts.isOwn() ? -1 : 1;
    if (dx * dir < 0) {
      state.dragX = 0;
      return;
    }

    const dist = Math.min(SWIPE_MAX, Math.abs(dx));
    state.dragX = dir * dist;
    if (dist > 10) state.suppressTap = true;
    if (e.cancelable) e.preventDefault();
  }

  function onTouchEnd() {
    if (!opts.isEnabled()) return;
    if (!dragging && state.dragX === 0) return;
    const dist = Math.abs(state.dragX);
    dragging = false;
    if (dist >= SWIPE_THRESHOLD) opts.onReply();
    snapBack();
  }

  function destroy() {
    clearTimeout(animTimer);
  }

  return { state, onTouchStart, onTouchMove, onTouchEnd, destroy };
}
