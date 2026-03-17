	<script>
	  import { createEventDispatcher, onDestroy } from 'svelte';
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
      <AvatarDisplay username={message.username} avatarBase64={message.avatarBase64 ?? null} size={28} showRing={true} />

      <div class="min-w-0 flex items-baseline gap-[var(--space-sm)]">
	        <div class="truncate font-600 text-[var(--text-primary)]">{message.username}</div>
	        <div class="text-[var(--font-size-xs)] text-[var(--text-muted)]" title={new Date(message.timestamp).toLocaleString()}>
	          {message.age} · {displayTime}
	          {#if isOwn}
	            {#if message.queued}
	              <span class="ml-[var(--space-xs)]" title="Will be sent when peer reconnects">⏳</span>
	            {:else if message.delivered === true}
	              <span class="ml-[var(--space-xs)]" title="Delivered">✓</span>
	            {:else if message.delivered === false}
	              <span class="ml-[var(--space-xs)]" title="Sent">○</span>
	            {/if}
	          {/if}
	        </div>
	      </div>
	    </div>

    <div class="mt-[var(--space-xs)] whitespace-pre-wrap break-words text-[var(--text-primary)]">
      {message.text}
    </div>
  </div>
</div>
