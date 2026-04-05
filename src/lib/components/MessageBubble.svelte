	<script>
		  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
	  import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';
	  import { formatMessageTime } from '$lib/utils/time.js';
	  import { previewText } from '$lib/utils/replies.js';

	  /**
	   * @typedef {Object} Message
	   * @property {string} [id]
	   * @property {string} [peerId]
	   * @property {string} username
	   * @property {number} age
	   * @property {string} color
	   * @property {string} text
	   * @property {{ messageId: string, authorUsername: string, authorColor: string, textSnapshot: string, timestamp: number }[] | null} [replies]
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

  // Swipe-to-reply (touch devices only)
  let isTouch = false;
  let dragging = false;
  let dragX = 0;
  let startX = 0;
  let startY = 0;
  let suppressTap = false;
  let animatingBack = false;
  let animTimer = 0;
  const SWIPE_MAX = 96;
  const SWIPE_THRESHOLD = 64; // ~60-80px

  function updateMqFlags() {
    isMobile = Boolean(mqMobile?.matches);
    isDesktop = Boolean(mqDesktop?.matches);
  }

	  onMount(() => {
	    mqMobile = window.matchMedia?.('(max-width: 639px)') ?? null;
	    mqDesktop = window.matchMedia?.('(min-width: 1024px)') ?? null;
	    isTouch = window.matchMedia?.('(hover: none)')?.matches || (navigator.maxTouchPoints ?? 0) > 0;
	    updateMqFlags();
	    const onMobileChange = () => {
	      updateMqFlags();
	    };
	    const onDesktopChange = () => updateMqFlags();
	    mqMobile?.addEventListener?.('change', onMobileChange);
	    mqDesktop?.addEventListener?.('change', onDesktopChange);

	    return () => {
	      clearTimeout(animTimer);
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
    if (suppressTap) return;
    const pointerType = e?.pointerType;
    if (pointerType && pointerType === 'mouse') return;
    dispatch('hoverEnter', {
      message,
      messageKey,
      position: getPositionFromEvent(e)
    });
  }

  function triggerReply() {
    if (!message?.id) return;
    dispatch('reply', { message });
  }

  function onTouchStart(e) {
    if (!isTouch || !isMobile) return;
    if (!e?.touches?.length) return;
    suppressTap = false;
    dragging = true;
    animatingBack = false;
    dragX = 0;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }

  function onTouchMove(e) {
    if (!dragging || !isTouch || !isMobile) return;
    if (!e?.touches?.length) return;
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const dx = x - startX;
    const dy = y - startY;

    // Cancel if the user is scrolling vertically.
    if (Math.abs(dy) > Math.abs(dx)) {
      dragging = false;
      dragX = 0;
      return;
    }

    // Only accept the "reply" swipe direction.
    // Own (right-aligned): swipe LEFT. Other (left-aligned): swipe RIGHT.
    const dir = isOwn ? -1 : 1;
    if (dx * dir < 0) {
      dragX = 0;
      return;
    }

    const dist = Math.min(SWIPE_MAX, Math.abs(dx));
    dragX = dir * dist;
    if (dist > 10) suppressTap = true;
    if (e.cancelable) e.preventDefault();
  }

  function snapBack() {
    animatingBack = true;
    dragX = 0;
    clearTimeout(animTimer);
    animTimer = setTimeout(() => {
      animatingBack = false;
    }, 180);
  }

  function onTouchEnd() {
    if (!isTouch || !isMobile) return;
    if (!dragging && dragX === 0) return;
    dragging = false;
    const dist = Math.abs(dragX);
    if (dist >= SWIPE_THRESHOLD) triggerReply();
    snapBack();
  }

	  $: bubbleShadow = hovered
	    ? `0 0 0 3px color-mix(in srgb, ${message.color} 15%, transparent)`
	    : 'none';

		  $: avatarSize = isDesktop ? 48 : isMobile ? 36 : 42;
		</script>

	<div class={`message-row flex w-full ${isOwn ? 'justify-end' : 'justify-start'}`}>
	  <div class="row flex items-center gap-[var(--space-sm)]">
	    {#if isOwn}
      <button
        type="button"
        class="reply-btn reply-btn-left h-[36px] w-[36px] grid place-items-center rounded-[var(--radius-full)] border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)]"
        aria-label="Reply to message"
        title="Reply"
        on:click={triggerReply}
      >
        <svg viewBox="0 0 24 24" class="h-[18px] w-[18px]" fill="currentColor" aria-hidden="true">
          <path d="M9 10H4.83l1.59-1.59L5 7l-5 5 5 5 1.42-1.41L4.83 12H9c5.52 0 10 4.48 10 10h2c0-6.63-5.37-12-12-12z" />
        </svg>
      </button>
    {/if}

    <div class="swipe-wrap relative">
      <div
        class={`swipe-underlay ${isOwn ? 'underlay-own' : 'underlay-their'}`}
        style={`opacity:${Math.min(1, Math.abs(dragX) / SWIPE_THRESHOLD)};`}
        aria-hidden="true"
      >
        <div class="underlay-icon">
          <svg viewBox="0 0 24 24" class={`h-[18px] w-[18px] ${isOwn ? '' : 'flip-x'}`} fill="currentColor" aria-hidden="true">
            <path d="M9 10H4.83l1.59-1.59L5 7l-5 5 5 5 1.42-1.41L4.83 12H9c5.52 0 10 4.48 10 10h2c0-6.63-5.37-12-12-12z" />
          </svg>
        </div>
      </div>

		      <div
		        bind:this={bubbleEl}
		        class={`bubble w-fit rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] ${animatingBack ? 'snap-back' : ''}`}
		        style={`--reply-color:${message.color}; border-left: 3px solid ${message.color}; box-shadow: ${bubbleShadow}; transform: translateX(${dragX}px);`}
		        role="group"
		        data-aether-bubble="true"
        data-message-id={message.id ?? ''}
        aria-label={`Message from ${message.username}`}
        aria-describedby={tooltipId || undefined}
        on:mouseenter={handleBubbleMouseEnter}
        on:mousemove={onMove}
        on:mouseleave={handleBubbleMouseLeave}
        on:pointerup={onPointerUp}
        on:touchstart={onTouchStart}
        on:touchmove={onTouchMove}
        on:touchend={onTouchEnd}
      >
	        <div class="flex items-center gap-[var(--space-sm)]">
	          <AvatarDisplay username={message.username} avatarBase64={message.avatarBase64 ?? null} size={avatarSize} showRing={true} />

	          <div class="meta min-w-0">
	            <div class="meta-top">
	              <div class="meta-name font-700 text-[var(--text-primary)]">{message.username}</div>
	              <div class="age-badge" aria-label="User age">{message.age}</div>
	            </div>
	          </div>
	        </div>

	        {#if Array.isArray(message.replies) && message.replies.length > 0}
	          <div class="mt-[var(--space-xs)] grid gap-[6px]">
	            {#each message.replies as r (r.messageId)}
              <button
                type="button"
                class="quote-card w-full text-left rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-[var(--space-sm)] py-[6px]"
                style={`border-left: 3px solid ${r.authorColor};`}
                on:click|stopPropagation={() => dispatch('jumpToOriginal', { messageId: r.messageId })}
	              >
	                <div class="quote-author text-[var(--font-size-xs)] font-800 text-[var(--text-primary)]">{r.authorUsername}</div>
	                <div class="mt-[2px] text-[var(--font-size-xs)] text-[var(--text-secondary)]">{previewText(r.textSnapshot, 80)}</div>
	              </button>
	            {/each}
	          </div>
	        {/if}

		        <div class="msg-text mt-[var(--space-xs)] whitespace-pre-wrap break-words text-[var(--text-primary)] leading-[1.45]">
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

    {#if !isOwn}
      <button
        type="button"
        class="reply-btn reply-btn-right h-[36px] w-[36px] grid place-items-center rounded-[var(--radius-full)] border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)]"
        aria-label="Reply to message"
        title="Reply"
        on:click={triggerReply}
      >
        <svg viewBox="0 0 24 24" class="h-[18px] w-[18px] flip-x" fill="currentColor" aria-hidden="true">
          <path d="M9 10H4.83l1.59-1.59L5 7l-5 5 5 5 1.42-1.41L4.83 12H9c5.52 0 10 4.48 10 10h2c0-6.63-5.37-12-12-12z" />
        </svg>
      </button>
    {/if}
  </div>
</div>

<style>
	  .bubble {
	    /* Comfortable sizing across devices without becoming comically wide on large screens. */
	    max-width: min(94%, 52rem);
	    padding: clamp(10px, 1.2vw, 16px) clamp(14px, 1.6vw, 22px);
	    will-change: transform;
	  }

	  @media (min-width: 1024px) {
	    .bubble {
	      max-width: min(72%, 60rem);
	    }
	  }

		  .meta-top {
		    display: flex;
		    align-items: center;
	    gap: 8px;
	    flex-wrap: wrap;
	    min-width: 0;
	  }

		  .meta-name {
		    min-width: 0;
		    overflow-wrap: anywhere;
		    font-size: clamp(0.95rem, 0.92rem + 0.18vw, 1.1rem);
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
	    font-size: clamp(0.72rem, 0.7rem + 0.1vw, 0.8rem);
	    color: var(--text-muted);
	    font-family: var(--font-mono);
	  }

  .status {
    color: var(--text-secondary);
  }

	  .swipe-wrap {
	    display: inline-block;
	  }

	  .msg-text {
	    font-size: clamp(1rem, 0.96rem + 0.25vw, 1.125rem);
	  }

	  .quote-author {
	    overflow-wrap: anywhere;
	    white-space: normal;
	  }

	  .swipe-underlay {
	    position: absolute;
	    top: 0;
    bottom: 0;
    width: 56px;
    display: grid;
    place-items: center;
    color: var(--text-secondary);
    pointer-events: none;
  }

  .underlay-own {
    right: 0;
  }

  .underlay-their {
    left: 0;
  }

  .underlay-icon {
    height: 36px;
    width: 36px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--bg-surface);
    display: grid;
    place-items: center;
  }

  .snap-back {
    transition: transform 160ms ease-out;
  }

  .flip-x {
    transform: scaleX(-1);
  }

  .reply-btn {
    opacity: 0;
    pointer-events: none;
  }

  @media (hover: none) {
    .reply-btn {
      display: none;
    }
  }

  @media (hover: hover) {
    .row:hover .reply-btn {
      opacity: 1;
      pointer-events: auto;
    }

    .reply-btn:hover {
      background: var(--bg-elevated);
      color: var(--text-primary);
    }

    .quote-card:hover {
      background: var(--bg-overlay);
    }
  }

  .bubble.aether-highlight {
    animation: replyPulse 1.5s ease-out;
  }

  @media (prefers-reduced-motion: reduce) {
    .bubble.aether-highlight {
      animation: none;
    }
  }

  @keyframes replyPulse {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--reply-color, #ffffff) 18%, transparent);
    }
    55% {
      box-shadow: 0 0 0 6px color-mix(in srgb, var(--reply-color, #ffffff) 22%, transparent);
    }
    100% {
      box-shadow: 0 0 0 0 transparent;
    }
  }

		  /* (min-width: 1024px) bubble sizing handled above */
		</style>
