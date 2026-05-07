/**
 * Creates a document-level outside-click closer for tooltips/overlays.
 * @param {{
 *   isOpen: () => boolean,
 *   isHit: (node: any) => boolean,
 *   onClose: () => void
 * }} opts
 */
export function createOutsideClose(opts) {
  let attached = false;

  const handler = (ev) => {
    if (!opts.isOpen()) return;
    const path = ev.composedPath?.() ?? [];
    const hit = path.some((n) => opts.isHit(n));
    if (!hit) opts.onClose();
  };

  return {
    attach() {
      if (attached) return;
      attached = true;
      document.addEventListener('pointerdown', handler, true);
      document.addEventListener('mousedown', handler, true);
    },
    detach() {
      if (!attached) return;
      attached = false;
      document.removeEventListener('pointerdown', handler, true);
      document.removeEventListener('mousedown', handler, true);
    }
  };
}

