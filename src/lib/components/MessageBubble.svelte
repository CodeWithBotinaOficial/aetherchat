	<script>
		  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
      import { user as userStore } from '$lib/stores/userStore.js';
	  import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';
	  import { calculateAge, formatMessageTime } from '$lib/utils/time.js';
	  import { previewText } from '$lib/utils/replies.js';
    import { createSwipeToReply, SWIPE_THRESHOLD_PX } from '$lib/components/messageBubble/swipe.js';

  /** @type {{ message: any, isOwn: boolean }} */
	  export let message;
	  export let messageKey = '';
	  export let isOwn = false;
	  export let tooltipId = '';
	  export let canEdit = false;
	  export let canDelete = false;

  const dispatch = createEventDispatcher();

	  let hovered = false;
		  let hideTimeout = null;
		  let menuOpen = false;

	  let displayTime = formatMessageTime(message.timestamp);
	  const timer = setInterval(() => {
	    displayTime = formatMessageTime(message.timestamp);
	  }, 30000);
	  onDestroy(() => clearInterval(timer));

  /** @type {MediaQueryList|null} */ let mqMobile = null;
  /** @type {MediaQueryList|null} */ let mqDesktop = null;
  let isMobile = false;
	  let isDesktop = false;

	  /** @type {HTMLDivElement|null} */
	  let bubbleEl = null;

  // Swipe-to-reply (touch devices only)
  let isTouch = false;
  const swipe = createSwipeToReply({
    isEnabled: () => Boolean(isTouch && isMobile),
    isOwn: () => Boolean(isOwn),
    onReply: () => triggerReply()
  });
  let dragX = 0;
  let animatingBack = false;
  let suppressTap = false;

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
        swipe.destroy();
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
    dispatch('hoverEnter', { message, messageKey, position: getPositionFromEvent(e) });
  }

  function handleBubbleMouseLeave() {
    hovered = false;
    hideTimeout = setTimeout(() => {
      dispatch('hoverLeave', { message, messageKey });
    }, 120);
  }

  function onMove(e) {
    if (!hovered) return;
    dispatch('hoverMove', { message, messageKey, position: { x: e.clientX, y: e.clientY } });
  }

  export function cancelHide() {
    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = null;
  }

  function onTooltipPointerUp(e) {
    // Touch / pen: open tooltip on tap.
    if (suppressTap) return;
    const pointerType = e?.pointerType;
    if (pointerType && pointerType === 'mouse') return;
    dispatch('hoverEnter', { message, messageKey, position: getPositionFromEvent(e) });
  }

  function openWallFromZone(e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    dispatch('openWall', { message, isOwn });
  }

	  function triggerReply() { if (!message?.deleted && message?.id) dispatch('reply', { message }); }

		  function openMenu() {
        if (!isOwn || message?.deleted || (!canEdit && !canDelete)) return;
        menuOpen = true;
        dispatch('menuOpen', { message, messageKey });
      }

		  function closeMenu() { menuOpen = false; dispatch('menuClose', { message, messageKey }); }

		  // Parent can close the menu to resolve overlay conflicts (e.g. tooltip vs menu).
		  export function closeMenuFromParent() { if (menuOpen) closeMenu(); }

		  function onMenuTrigger(e) { e.preventDefault(); e.stopPropagation(); menuOpen ? closeMenu() : openMenu(); }

	  function onDocPointerDown(e) {
	    if (!menuOpen) return;
	    const path = e.composedPath?.() ?? [];
	    const hit = path.some((n) => n?.dataset?.aetherMenu === 'true' || n?.dataset?.aetherMenuTrigger === 'true');
	    if (!hit) closeMenu();
	  }

	  $: if (menuOpen) {
	    document.addEventListener('pointerdown', onDocPointerDown, true);
	  } else {
	    document.removeEventListener('pointerdown', onDocPointerDown, true);
	  }

	  onDestroy(() => {
	    document.removeEventListener('pointerdown', onDocPointerDown, true);
	  });

  function onTouchStart(e) {
    swipe.onTouchStart(e);
  }

  function onTouchMove(e) {
    swipe.onTouchMove(e);
    dragX = swipe.state.dragX;
    suppressTap = swipe.state.suppressTap;
  }

  function onTouchEnd() {
    swipe.onTouchEnd();
    dragX = swipe.state.dragX;
    animatingBack = swipe.state.animatingBack;
    suppressTap = swipe.state.suppressTap;
  }

	  $: bubbleShadow = hovered
	    ? `0 0 0 3px color-mix(in srgb, ${message.color} 15%, transparent)`
	    : 'none';

	  $: avatarSize = isDesktop ? 48 : isMobile ? 36 : 42;

    $: displayUsername = isOwn ? ($userStore?.username ?? message.username) : message.username;
    $: displayAge = calculateAge(
      isOwn ? ($userStore?.dateOfBirth ?? message.dateOfBirth ?? '') : (message.dateOfBirth ?? '')
    );
    $: displayAvatar = isOwn ? ($userStore?.avatarBase64 ?? (message.avatarBase64 ?? null)) : (message.avatarBase64 ?? null);
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
        style={`opacity:${Math.min(1, Math.abs(dragX) / SWIPE_THRESHOLD_PX)};`}
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
        aria-label={`Message from ${displayUsername}`}
        aria-describedby={tooltipId || undefined}
        on:touchstart={onTouchStart}
	        on:touchmove={onTouchMove}
	        on:touchend={onTouchEnd}
	      >
	        {#if isOwn && !message.deleted && (canEdit || canDelete)}
		          <button
		            type="button"
		            class="msg-menu-trigger"
		            data-aether-menu-trigger="true"
		            aria-label="Message actions"
		            title="Message actions"
		            on:pointerdown|stopPropagation={onMenuTrigger}
		            on:pointerup|stopPropagation
		            on:keydown|stopPropagation={(e) => {
		              if (e.key === 'Enter' || e.key === ' ') {
		                e.preventDefault();
		                onMenuTrigger(e);
		              }
	            }}
	          >
	            ⋯
	          </button>

	          {#if menuOpen}
	            <div class="msg-menu" data-aether-menu="true" role="menu" aria-label="Message actions">
		              {#if canEdit}
		                <button type="button" class="msg-menu-item" role="menuitem" on:click={() => { closeMenu(); dispatch('edit', { message }); }}>
		                  Edit
		                </button>
		              {/if}
		              {#if canDelete}
		                <button type="button" class="msg-menu-item danger" role="menuitem" on:click={() => { closeMenu(); dispatch('delete', { message }); }}>
		                  Delete
		                </button>
		              {/if}
		            </div>
		          {/if}
		        {/if}

          <div class="identity-row">
            <button
              type="button"
              class="avatar-zone"
              data-aether-avatar-zone="true"
              aria-label={`Open wall for ${displayUsername}`}
              title="Open wall"
              on:click={openWallFromZone}
              on:pointerdown|stopPropagation
            >
              <AvatarDisplay username={displayUsername} avatarBase64={displayAvatar} size={avatarSize} showRing={true} />
            </button>

            <div class="meta min-w-0">
              <div class="meta-top">
                <button
                  type="button"
                  class="name-zone meta-name font-700 text-[var(--text-primary)]"
                  data-aether-username-zone="true"
                  on:click={openWallFromZone}
                  on:pointerdown|stopPropagation
                  aria-label={`Open wall for ${displayUsername}`}
                  title="Open wall"
                >
                  {displayUsername}
                </button>
                <div class="age-badge" aria-label="User age">{displayAge}</div>
              </div>
            </div>
          </div>

          <div
            class="tooltip-zone"
            data-aether-tooltip-zone="true"
            role="button"
            tabindex="0"
            aria-label={`User details for ${displayUsername}`}
            on:mouseenter={handleBubbleMouseEnter}
            on:mousemove={onMove}
            on:mouseleave={handleBubbleMouseLeave}
            on:pointerup={onTooltipPointerUp}
            on:keydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                dispatch('hoverEnter', { message, messageKey, position: getPositionFromEvent(e) });
              }
            }}
          >

		        {#if Array.isArray(message.replies) && message.replies.length > 0}
		          <div class="mt-[var(--space-xs)] grid gap-[6px]">
		            {#each message.replies as r (r.messageId)}
		              {#if r?.deleted}
		                <div
		                  class="quote-card quote-deleted w-full text-left rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-[var(--space-sm)] py-[6px]"
		                  style={`border-left: 3px solid ${r.authorColor};`}
		                  role="note"
		                  aria-label="Original message deleted"
		                >
		                  <div class="quote-author text-[var(--font-size-xs)] font-800 text-[var(--text-primary)]">{r.authorUsername}</div>
		                  <div class="mt-[2px] text-[var(--font-size-xs)] text-[var(--text-muted)]">
		                    {previewText(r.textSnapshot, 80)}
		                  </div>
		                </div>
		              {:else}
		                <button
		                  type="button"
		                  class="quote-card w-full text-left rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-[var(--space-sm)] py-[6px]"
		                  style={`border-left: 3px solid ${r.authorColor};`}
		                  on:click|stopPropagation={() => dispatch('jumpToOriginal', { messageId: r.messageId })}
		                >
		                  <div class="quote-author text-[var(--font-size-xs)] font-800 text-[var(--text-primary)]">{r.authorUsername}</div>
		                  <div class="mt-[2px] text-[var(--font-size-xs)] text-[var(--text-secondary)]">{previewText(r.textSnapshot, 80)}</div>
		                </button>
		              {/if}
		            {/each}
		          </div>
		        {/if}

		        <div
		          class={`msg-text mt-[var(--space-xs)] whitespace-pre-wrap break-words leading-[1.45] ${message.deleted ? 'msg-deleted' : ''}`}
		        >
		          {message.text}
		        </div>

	        <div class="time-row" title={new Date(message.timestamp).toLocaleString()}>
	          <span class="time">{displayTime}</span>
	          {#if typeof message.editedAt === 'number' && !message.deleted}
	            <span
	              class="edited"
	              title={`Edited at ${new Date(message.editedAt).toLocaleTimeString()}`}
	              aria-label={`Edited at ${new Date(message.editedAt).toLocaleTimeString()}`}
	            >
	              <svg viewBox="0 0 24 24" class="edited-ico" fill="currentColor" aria-hidden="true">
	                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm2.92 2.83H5v-.92l8.06-8.06.92.92L5.92 20.08ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z" />
	              </svg>
	              edited
	            </span>
	          {/if}
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

<style src="./MessageBubble.css"></style>
