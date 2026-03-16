<script>
  import { createEventDispatcher } from 'svelte';

  /**
   * @typedef {Object} Message
   * @property {string} username
   * @property {number} age
   * @property {string} color
   * @property {string} text
   * @property {number} timestamp
   */

  /** @type {{ message: Message, isOwn: boolean }} */
  export let message;
  export let messageKey = '';
  export let isOwn = false;
  export let tooltipId = '';

  const dispatch = createEventDispatcher();

  let hovered = false;
  let hideTimeout = null;

  function formatRelative(ts) {
    const diff = Date.now() - ts;
    if (diff < 10_000) return 'just now';
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  $: relativeTime = formatRelative(message.timestamp);
  $: initials = (message.username?.trim()?.[0] ?? '?').toUpperCase();

  function getPositionFromEvent(e) {
    if (typeof e?.clientX === 'number' && typeof e?.clientY === 'number') {
      return { x: e.clientX, y: e.clientY };
    }
    const rect = e.currentTarget?.getBoundingClientRect?.();
    if (rect) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    return { x: 0, y: 0 };
  }

  function handleBubbleMouseEnter(e) {
    hovered = true;
    cancelHide();
    dispatch('hoverEnter', {
      message,
      messageKey,
      position: getPositionFromEvent(e)
    });
  }

  function handleBubbleMouseLeave() {
    hovered = false;
    hideTimeout = setTimeout(() => {
      dispatch('hoverLeave', { message, messageKey });
    }, 120);
  }

  function onMove(e) {
    if (!hovered) return;
    dispatch('hoverMove', {
      message,
      messageKey,
      position: { x: e.clientX, y: e.clientY }
    });
  }

  export function cancelHide() {
    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = null;
  }

  function onPointerUp(e) {
    // Touch / pen: open tooltip on tap.
    const pointerType = e?.pointerType;
    if (pointerType && pointerType === 'mouse') return;
    dispatch('hoverEnter', {
      message,
      messageKey,
      position: getPositionFromEvent(e)
    });
  }

  $: bubbleShadow = hovered
    ? `0 0 0 3px color-mix(in srgb, ${message.color} 15%, transparent)`
    : 'none';
</script>

<div class={isOwn ? 'flex justify-end' : 'flex justify-start'}>
  <div
    class="max-w-[min(720px,100%)] w-fit rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] px-[var(--space-md)] py-[var(--space-sm)]"
    style={`border-left: 3px solid ${message.color}; box-shadow: ${bubbleShadow};`}
    role="group"
    data-aether-bubble="true"
    aria-label={`Message from ${message.username}`}
    aria-describedby={tooltipId || undefined}
    on:mouseenter={handleBubbleMouseEnter}
    on:mousemove={onMove}
    on:mouseleave={handleBubbleMouseLeave}
    on:pointerup={onPointerUp}
  >
    <div class="flex items-center gap-[var(--space-sm)]">
      <div
        class="h-[28px] w-[28px] rounded-[var(--radius-full)] bg-[var(--bg-elevated)] grid place-items-center text-[var(--font-size-xs)] text-[var(--text-secondary)]"
        style={`outline: 2px solid ${message.color}; outline-offset: 1px;`}
        aria-hidden="true"
      >
        {initials}
      </div>

      <div class="min-w-0 flex items-baseline gap-[var(--space-sm)]">
        <div class="truncate font-600 text-[var(--text-primary)]">{message.username}</div>
        <div class="text-[var(--font-size-xs)] text-[var(--text-muted)]">
          {message.age} · {relativeTime}
        </div>
      </div>
    </div>

    <div class="mt-[var(--space-xs)] whitespace-pre-wrap break-words text-[var(--text-primary)]">
      {message.text}
    </div>
  </div>
</div>
