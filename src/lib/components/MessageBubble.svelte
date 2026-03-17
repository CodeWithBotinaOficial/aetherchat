	<script>
	  import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
	  import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';
	  import { formatMessageTime } from '$lib/utils/time.js';

	  /**
	   * @typedef {Object} Message
	   * @property {string} [id]
	   * @property {string} [peerId]
	   * @property {string} username
	   * @property {number} age
	   * @property {string} color
	   * @property {string} text
	   * @property {number} timestamp
	   * @property {string|null} [avatarBase64]
	   * @property {'sent'|'received'} [direction]
	   * @property {boolean} [delivered]
	   * @property {boolean} [queued]
	   */

  /** @type {{ message: Message, isOwn: boolean }} */
  export let message;
  export let messageKey = '';
  export let isOwn = false;
  export let tooltipId = '';

  const dispatch = createEventDispatcher();

	  let hovered = false;
	  let hideTimeout = null;

	  let displayTime = formatMessageTime(message.timestamp);
	  const timer = setInterval(() => {
	    displayTime = formatMessageTime(message.timestamp);
	  }, 30000);
	  onDestroy(() => clearInterval(timer));

  /** @type {MediaQueryList|null} */
  let mqMobile = null;
  /** @type {MediaQueryList|null} */
  let mqDesktop = null;
  let isMobile = false;
  let isDesktop = false;

  /** @type {HTMLDivElement|null} */
  let bubbleEl = null;
  let isNarrow = false;

  function updateMqFlags() {
    isMobile = Boolean(mqMobile?.matches);
    isDesktop = Boolean(mqDesktop?.matches);
  }

  async function updateNarrow() {
    await tick();
    if (!bubbleEl) return;
    // On mobile, very short messages can be narrow enough that the username/age row feels cramped.
    isNarrow = bubbleEl.clientWidth < 240;
  }

  onMount(() => {
    mqMobile = window.matchMedia?.('(max-width: 639px)') ?? null;
    mqDesktop = window.matchMedia?.('(min-width: 1024px)') ?? null;
    updateMqFlags();
    const onMobileChange = () => {
      updateMqFlags();
      void updateNarrow();
    };
    const onDesktopChange = () => updateMqFlags();
    mqMobile?.addEventListener?.('change', onMobileChange);
    mqDesktop?.addEventListener?.('change', onDesktopChange);

    const onResize = () => void updateNarrow();
    window.addEventListener('resize', onResize, { passive: true });
    void updateNarrow();

    return () => {
      window.removeEventListener('resize', onResize);
      mqMobile?.removeEventListener?.('change', onMobileChange);
      mqDesktop?.removeEventListener?.('change', onDesktopChange);
    };
  });

  function getPositionFromEvent(e) {
    const rect = e.currentTarget?.getBoundingClientRect?.();
    if (rect) return { x: rect.left + rect.width / 2, y: rect.top };
    if (typeof e?.clientX === 'number' && typeof e?.clientY === 'number') {
      return { x: e.clientX, y: e.clientY };
    }
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

  $: avatarSize = isDesktop ? 36 : 28;
  $: showMetaRow = !isMobile || !isNarrow || hovered || Boolean(tooltipId);
</script>

<div class={isOwn ? 'flex justify-end' : 'flex justify-start'}>
  <div
    bind:this={bubbleEl}
    class="bubble w-fit rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] px-[var(--space-md)] py-[var(--space-sm)]"
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
      <AvatarDisplay username={message.username} avatarBase64={message.avatarBase64 ?? null} size={avatarSize} showRing={true} />

      {#if showMetaRow}
        <div class="min-w-0 flex items-center gap-[var(--space-sm)]">
          <div class="truncate font-700 text-[var(--text-primary)]">{message.username}</div>
          <div class="age-badge" aria-label="User age">{message.age}</div>
        </div>
      {/if}
    </div>

    <div class="mt-[var(--space-xs)] whitespace-pre-wrap break-words text-[var(--text-primary)]">
      {message.text}
    </div>

    <div class="time-row" title={new Date(message.timestamp).toLocaleString()}>
      <span class="time">{displayTime}</span>
      {#if isOwn}
        {#if message.queued}
          <span class="status" title="Will be sent when peer reconnects">⏳</span>
        {:else if message.delivered === true}
          <span class="status" title="Delivered">✓</span>
        {:else if message.delivered === false}
          <span class="status" title="Sent">○</span>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .bubble {
    max-width: 85%;
  }

  .age-badge {
    flex: none;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    padding: 2px 8px;
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    line-height: 1.2;
  }

  .time-row {
    margin-top: 6px;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    align-items: center;
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .status {
    color: var(--text-secondary);
  }

  @media (min-width: 1024px) {
    .bubble {
      max-width: 70%;
    }
  }
</style>
