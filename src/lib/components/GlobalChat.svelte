<script>
  import { onMount, tick } from 'svelte';
  import {
    addGlobalMessage,
    addPendingReply,
    clearPendingReplies,
    editingMessageId,
    globalMessages,
    loadGlobalMessages,
    pendingReplies,
    prependGlobalMessages,
    removePendingReply,
    setPendingReplies
  } from '$lib/stores/chatStore.js';
  import { peer } from '$lib/stores/peerStore.js';
  import { user } from '$lib/stores/userStore.js';
  import { avatarCache, broadcastGlobalMessage, broadcastGlobalMessageDelete, broadcastGlobalMessageEdit } from '$lib/services/peer.js';
  import { getGlobalMessagesPage } from '$lib/services/db.js';
  import { cssEscape } from '$lib/utils/replies.js';
  import { showToast } from '$lib/stores/toastStore.js';
  import { openProfile } from '$lib/stores/profileStore.js';

  import ChatInput from '$lib/components/ChatInput.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import MessageBubble from '$lib/components/MessageBubble.svelte';
  import UserTooltip from '$lib/components/UserTooltip.svelte';

  /** @type {HTMLDivElement|null} */
  let listEl = null;

  // Tooltip state
  let tooltipUser = null;
  let tooltipMessage = null;
  let tooltipPos = null;
  let tooltipKey = '';
  /** @type {(() => void) | null} */
  let tooltipCancelHide = null;
  const TOOLTIP_ID = 'aether-user-tooltip';
  const bubbleRefs = Object.create(null);
  // While an action menu is open, suppress tooltip opening (so the user can move
  // from the ⋯ trigger into the menu without it closing).
  let openMenuKey = '';
  let isTouch = false;
  let outsideListenerAttached = false;

  function closeAllActionMenus(exceptKey = '') {
    const except = String(exceptKey ?? '');
    for (const k of Object.keys(bubbleRefs)) {
      if (except && k === except) continue;
      try {
        bubbleRefs[k]?.closeMenuFromParent?.();
      } catch {
        // ignore
      }
    }
  }

  /** @type {HTMLDivElement|null} */
  let composerEl = null;
  let composerPad = 160;
  let cleanupResize = () => {};
  let now = Date.now();
  let nowTimer = 0;

  let composerValue = '';
  let showMsgDelete = false;
  /** @type {{ messageId: string } | null} */
  let msgDeleteTarget = null;

  // Simple windowed list for large histories.
  const EST_ITEM_H = 84;
  const OVERSCAN = 10;
  let start = 0;
  let end = 0;

  function computeRange(msgs) {
    if (!listEl) {
      start = 0;
      end = msgs?.length ?? 0;
      return;
    }

    if ((msgs?.length ?? 0) <= 200) {
      start = 0;
      end = msgs.length;
      return;
    }

    const scrollTop = listEl.scrollTop;
    const height = listEl.clientHeight;
    const first = Math.floor(scrollTop / EST_ITEM_H) - OVERSCAN;
    const visibleCount = Math.ceil(height / EST_ITEM_H) + OVERSCAN * 2;
    start = Math.max(0, first);
    end = Math.min(msgs.length, start + visibleCount);
  }

  function maybeAutoScroll() {
    if (!listEl) return true;
    const bottomGap = listEl.scrollHeight - (listEl.scrollTop + listEl.clientHeight);
    return bottomGap < 140;
  }

  async function scrollToBottom() {
    if (!listEl) return;
    await tick();
    if (!listEl) return;
    listEl.scrollTop = listEl.scrollHeight;
  }

  async function onHoverEnter(e) {
    const { message, messageKey, position } = e.detail;
    // If an action menu is open, do not open the tooltip (menu has priority).
    if (openMenuKey) return;
    // Tooltips and message action menus are mutually exclusive.
    closeAllActionMenus();
    tooltipMessage = message;
    tooltipPos = position;
    tooltipKey = String(messageKey ?? '');
    tooltipCancelHide = bubbleRefs[tooltipKey]?.cancelHide ?? null;

    if (isTouch) attachOutsideClose();
  }

  function isOwnMessage(m, u, p) {
    const uname = String(u?.username ?? '').trim();
    if (uname && String(m?.username ?? '') === uname) return true;
    const myPeerId = String(p?.peerId ?? '').trim();
    if (myPeerId && String(m?.peerId ?? '') === myPeerId) return true;
    if (String(m?.peerId ?? '') === 'local') return true;
    return false;
  }

  $: if (tooltipMessage) {
    const m = tooltipMessage;
    const cache = $avatarCache;
    const own = isOwnMessage(m, $user, $peer);
    const avatarBase64 = own
      ? ($user?.avatarBase64 ?? null)
      : (m.avatarBase64 ?? cache?.get?.(m.peerId) ?? null);
    const bio = own
      ? ($user?.bio ?? '')
      : (typeof $peer?.connectedPeers?.get?.(m.peerId)?.bio === 'string' ? $peer.connectedPeers.get(m.peerId).bio : '');

    tooltipUser = {
      peerId: m.peerId,
      username: own ? ($user?.username ?? m.username) : m.username,
      age: own ? ($user?.age ?? m.age) : m.age,
      color: own ? ($user?.color ?? m.color) : m.color,
      avatarBase64,
      bio
    };
  }

  function onHoverMove(e) {
    tooltipPos = e.detail.position;
  }

  function onHoverLeave() {
    tooltipMessage = null;
    tooltipUser = null;
    tooltipPos = null;
    tooltipKey = '';
    tooltipCancelHide = null;
    detachOutsideClose();
  }

  function onTooltipClose() {
    onHoverLeave();
  }

  function onMenuOpen(ev) {
    openMenuKey = String(ev?.detail?.messageKey ?? '');
    // Tooltips and message action menus are mutually exclusive.
    onHoverLeave();
    closeAllActionMenus(openMenuKey);
  }

  function onMenuClose(ev) {
    const key = String(ev?.detail?.messageKey ?? '');
    if (key && key === openMenuKey) openMenuKey = '';
  }

  async function onSend(e) {
    const u = $user;
    if (!u) return;

    const rawPending = Array.isArray(e?.detail?.replies) ? e.detail.replies : [];
    const byId = new Map(($globalMessages ?? []).map((m) => [m?.id, m]));
    const replies = rawPending.map((r) => {
      const original = byId.get(r.messageId) ?? null;
      return {
        messageId: r.messageId,
        authorUsername: r.authorUsername,
        authorColor: r.authorColor,
        textSnapshot: r.textSnapshot,
        timestamp: typeof original?.timestamp === 'number' ? original.timestamp : (typeof r?.timestamp === 'number' ? r.timestamp : 0),
        deleted: Boolean(r?.deleted)
      };
    });
    const safeReplies = replies.length > 0 ? replies : null;

    // Save edit in-place (no reorder).
    if ($editingMessageId) {
      await broadcastGlobalMessageEdit(
        $editingMessageId,
        e.detail.text,
        { username: u.username, color: u.color, age: u.age, avatarBase64: u.avatarBase64 ?? null, createdAt: u.createdAt },
        safeReplies
      );
      editingMessageId.set(null);
      composerValue = '';
      clearPendingReplies();
      computeRange($globalMessages);
      return;
    }

    if ($peer.peerId) {
      // Peer service handles optimistic add + network broadcast.
      await broadcastGlobalMessage(e.detail.text, {
        username: u.username,
        color: u.color,
        age: u.age,
        avatarBase64: u.avatarBase64
      }, safeReplies);
    } else {
      // Offline fallback: local-only message.
      await addGlobalMessage({
        peerId: 'local',
        username: u.username,
        age: u.age,
        color: u.color,
        avatarBase64: u.avatarBase64 ?? null,
        text: e.detail.text,
        replies: safeReplies,
        timestamp: Date.now()
      });
    }

    clearPendingReplies();
    await scrollToBottom();
    computeRange($globalMessages);
  }

  async function scrollToAndHighlight(messageId) {
    const id = String(messageId ?? '').trim();
    if (!id || !listEl) return;

    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

    const tryFindEl = () => listEl?.querySelector?.(`[data-message-id="${cssEscape(id)}"]`) ?? null;

    // Ensure the message is in memory (page older messages if needed).
    let guard = 0;
    while (!($globalMessages ?? []).some((m) => m?.id === id) && guard < 12) {
      guard += 1;
      const oldest = $globalMessages?.[0]?.timestamp ?? Date.now();
      const page = await getGlobalMessagesPage(oldest, 80);
      if (!page || page.length === 0) break;
      prependGlobalMessages(page);
      await tick();
    }

    const idx = ($globalMessages ?? []).findIndex((m) => m?.id === id);
    if (idx < 0) {
      showToast('Original message not available.');
      return;
    }

    if (windowed) {
      listEl.scrollTop = Math.max(0, idx * EST_ITEM_H - EST_ITEM_H * 2);
      computeRange($globalMessages);
      await tick();
    }

    const el = tryFindEl();
    if (!el) {
      // One more range recompute pass after scrolling.
      computeRange($globalMessages);
      await tick();
    }
    const el2 = tryFindEl();
    if (!el2) {
      showToast('Original message not available.');
      return;
    }

    el2.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'center' });
    if (prefersReduced) return;
    el2.classList.add('aether-highlight');
    setTimeout(() => el2.classList.remove('aether-highlight'), 1500);
  }

  onMount(() => {
    isTouch = window.matchMedia?.('(hover: none)').matches || (navigator.maxTouchPoints ?? 0) > 0;
    nowTimer = setInterval(() => {
      now = Date.now();
    }, 30_000);

    // Keep enough bottom padding so the fixed composer never covers messages on mobile.
    try {
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
          if (!composerEl) return;
          composerPad = composerEl.offsetHeight + 20;
        });
        if (composerEl) ro.observe(composerEl);
        if (composerEl) composerPad = composerEl.offsetHeight + 20;
        cleanupResize = () => ro.disconnect();
      }
    } catch {
      cleanupResize = () => {};
    }

    const unsubscribe = globalMessages.subscribe((msgs) => {
      computeRange(msgs);
      if (listEl && maybeAutoScroll()) void scrollToBottom();
    });

    (async () => {
      try {
        await loadGlobalMessages();
        await tick();
        await scrollToBottom();
        computeRange($globalMessages);
      } catch (err) {
        console.error('GlobalChat init failed', err);
      }
    })();

    return () => {
      unsubscribe();
      try {
        cleanupResize();
      } catch {
        // ignore
      }
      clearInterval(nowTimer);
    };
  });

  $: msgs = $globalMessages;
  $: windowed = msgs.length > 200;
  $: visibleMsgs = windowed ? msgs.slice(start, end) : msgs;
  $: padTop = windowed ? start * EST_ITEM_H : 0;
  $: padBottom = windowed ? Math.max(0, (msgs.length - end) * EST_ITEM_H) : 0;

  function attachOutsideClose() {
    if (outsideListenerAttached) return;
    outsideListenerAttached = true;

    const handler = (ev) => {
      if (!tooltipUser) return;
      const path = ev.composedPath?.() ?? [];
      const hit = path.some(
        (n) => n?.dataset?.aetherTooltip === 'true' || n?.dataset?.aetherBubble === 'true'
      );
      if (!hit) onHoverLeave();
    };

    document.addEventListener('pointerdown', handler, true);
    document.addEventListener('mousedown', handler, true);

    detachOutsideClose = () => {
      if (!outsideListenerAttached) return;
      outsideListenerAttached = false;
      document.removeEventListener('pointerdown', handler, true);
      document.removeEventListener('mousedown', handler, true);
      detachOutsideClose = () => {};
    };
  }

  let detachOutsideClose = () => {};
  $: isEditing = Boolean($editingMessageId);
  $: editLabel = (() => {
    if (!$editingMessageId) return '';
    const msg = ($globalMessages ?? []).find((m) => m?.id === $editingMessageId) ?? null;
    const ts = typeof msg?.timestamp === 'number' ? msg.timestamp : Date.now();
    return `Editing message from ${new Date(ts).toLocaleTimeString()}`;
  })();

  async function confirmMsgDelete() {
    showMsgDelete = false;
    const target = msgDeleteTarget;
    msgDeleteTarget = null;
    if (!target?.messageId) return;
    const u = $user;
    if (!u) return;

    if ($editingMessageId === target.messageId) {
      editingMessageId.set(null);
      composerValue = '';
      clearPendingReplies();
    }

    await broadcastGlobalMessageDelete(target.messageId, {
      username: u.username,
      color: u.color,
      age: u.age,
      avatarBase64: u.avatarBase64 ?? null,
      createdAt: u.createdAt
    });
  }
</script>

  <div class="gc h-full flex flex-col" style={`--composer-pad:${composerPad}px;`}>
  <div class="gc-list flex-1 min-h-0">
    {#if $globalMessages.length === 0}
      <div class="h-full grid place-items-center px-[var(--space-lg)]">
        <div class="text-center">
          <div class="text-[var(--font-size-lg)] font-700">No messages yet. Say hello! 👋</div>
          <div class="mt-[var(--space-xs)] text-[var(--text-secondary)] text-[var(--font-size-sm)]">
            Messages are stored locally and shared peer-to-peer.
          </div>
        </div>
      </div>
    {:else}
      <div
		        bind:this={listEl}
		        class="gc-scroll h-full scroll-container"
		        on:scroll={() => computeRange(msgs)}
		      >
		        <div class="gc-inner" style={`padding-top:${padTop}px; padding-bottom:${padBottom}px;`}>
		          {#each visibleMsgs as m (m.id ?? `${m.timestamp}-${m.username}-${m.text}`)}
		            <div class="mb-[var(--msg-gap)]">
		              <MessageBubble
		                message={m}
		                messageKey={m.id ?? `${m.timestamp}-${m.username}-${m.text}`}
		                bind:this={bubbleRefs[String(m.id ?? `${m.timestamp}-${m.username}-${m.text}`)]}
		                isOwn={isOwnMessage(m, $user, $peer)}
                    canEdit={isOwnMessage(m, $user, $peer) && !m.deleted && now - (m.timestamp ?? 0) <= 30 * 60 * 1000}
                    canDelete={isOwnMessage(m, $user, $peer) && !m.deleted && now - (m.timestamp ?? 0) <= 30 * 60 * 1000}
                tooltipId={tooltipUser && tooltipKey === String(m.id ?? `${m.timestamp}-${m.username}-${m.text}`) ? TOOLTIP_ID : ''}
                on:hoverEnter={onHoverEnter}
                on:hoverMove={onHoverMove}
	                on:hoverLeave={onHoverLeave}
	                on:reply={(ev) => addPendingReply(ev.detail.message)}
	                on:jumpToOriginal={(ev) => scrollToAndHighlight(ev.detail.messageId)}
                on:menuOpen={onMenuOpen}
                  on:menuClose={onMenuClose}
                  on:openProfile={openProfile}
	                    on:edit={(ev) => {
	                      const msg = ev?.detail?.message;
	                      if (!msg?.id) return;
	                      editingMessageId.set(msg.id);
                      composerValue = String(msg.text ?? '');
                      setPendingReplies(Array.isArray(msg.replies) ? msg.replies : null);
                    }}
                    on:delete={(ev) => {
                      const msg = ev?.detail?.message;
                      if (!msg?.id) return;
                      showMsgDelete = true;
                      msgDeleteTarget = { messageId: msg.id };
                    }}
              />
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <div class="gc-input">
    <div bind:this={composerEl}>
      <ChatInput
        bind:value={composerValue}
        mode={isEditing ? 'edit' : 'compose'}
        editLabel={editLabel}
        pendingReplies={$pendingReplies}
        on:removePendingReply={(ev) => removePendingReply(ev.detail.messageId)}
        on:jumpToOriginal={(ev) => scrollToAndHighlight(ev.detail.messageId)}
        on:send={onSend}
        on:cancelEdit={() => {
          editingMessageId.set(null);
          composerValue = '';
          clearPendingReplies();
        }}
        placeholder="Message the global room..."
      />
    </div>
  </div>

  <UserTooltip
    user={tooltipUser}
    position={tooltipPos}
    cancelHide={tooltipCancelHide}
    on:close={onTooltipClose}
  />
</div>

{#if showMsgDelete && msgDeleteTarget}
  <ConfirmDialog
    title="Delete message?"
    message="This will replace the message with a deletion placeholder for everyone in the global chat."
    confirmLabel="Delete"
    dangerous={true}
    on:confirm={confirmMsgDelete}
    on:cancel={() => {
      showMsgDelete = false;
      msgDeleteTarget = null;
    }}
  />
{/if}

	<style>
	  .gc {
	    --chat-pad-x: clamp(12px, 2.2vw, 32px);
	    --chat-pad-y: clamp(12px, 1.8vw, 24px);
	    --msg-gap: clamp(10px, 1.3vh, 16px);
	  }

	  .gc-scroll {
	    padding: var(--chat-pad-y) var(--chat-pad-x);
	  }

	  @media (max-width: 639px) {
	    .gc-input {
	      position: fixed;
	      left: 0;
	      right: 0;
      bottom: calc(56px + env(safe-area-inset-bottom, 0px));
      z-index: 45;
    }

    .gc-list {
      padding-bottom: var(--composer-pad, 160px);
    }
  }

	  @media (min-width: 640px) {
	    .gc-input {
	      position: static;
	    }
	  }

		  .gc-inner {
		    width: 100%;
		  }
		</style>
