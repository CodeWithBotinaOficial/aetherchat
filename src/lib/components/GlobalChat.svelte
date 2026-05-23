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
  import { showToast } from '$lib/stores/toastStore.js';
  import { openMyWall, openWall } from '$lib/stores/wall/actions.js';
  import { scrollToAndHighlight as scrollToAndHighlightHelper } from '$lib/components/globalChat/scroll.js';
  import { createOutsideClose } from '$lib/components/globalChat/outsideClose.js';
  import { handleGlobalChatSend } from '$lib/components/globalChat/send.js';
  import { setupGlobalChatMount } from '$lib/components/globalChat/mount.js';
  import { addRecentItem } from '$lib/stores/klipyRecents.js';
  import { createComposer } from '$lib/utils/mediaComposer.js';
  import MediaPicker from '$lib/components/mediaPicker/MediaPicker.svelte';

  import ChatInput from '$lib/components/ChatInput.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import MessageBubble from '$lib/components/MessageBubble.svelte';
  import UserTooltip from '$lib/components/UserTooltip.svelte';

  /** @type {HTMLDivElement|null} */ let listEl = null;

  // Tooltip state
  let tooltipUser = null;
  let tooltipMessage = null;
  let tooltipPos = null;
  let tooltipKey = '';
  /** @type {(() => void) | null} */ let tooltipCancelHide = null;
  const TOOLTIP_ID = 'aether-user-tooltip';
  const bubbleRefs = Object.create(null);
  // While an action menu is open, suppress tooltip opening (so the user can move
  // from the ⋯ trigger into the menu without it closing).
  let openMenuKey = '';
  let isTouch = false;
  const outsideClose = createOutsideClose({
    isOpen: () => Boolean(tooltipUser),
    isHit: (n) => n?.dataset?.aetherTooltip === 'true' || n?.dataset?.aetherBubble === 'true',
    onClose: () => onHoverLeave()
  });

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

  /** @type {HTMLDivElement|null} */ let composerEl = null;
  let composerPad = 160;
  let now = Date.now();

  const composer = createComposer();
  let composerValue = '';
  /** @type {import('$lib/services/klipy/types.js').MessageMedia[]} */
  let composerMedia = [];
  let pickerOpen = false;
  $: composer.setText(composerValue);
  $: composer.setMedia(composerMedia);
  let showMsgDelete = false;
  /** @type {{ messageId: string } | null} */ let msgDeleteTarget = null;

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

    tooltipUser = { peerId: m.peerId, username: own ? ($user?.username ?? m.username) : m.username, dateOfBirth: own ? ($user?.dateOfBirth ?? m.dateOfBirth ?? null) : (m.dateOfBirth ?? null), color: own ? ($user?.color ?? m.color) : m.color, avatarBase64, bio };
  }

  function onHoverMove(e) { tooltipPos = e.detail.position; }

  function onHoverLeave() {
    tooltipMessage = null;
    tooltipUser = null;
    tooltipPos = null;
    tooltipKey = '';
    tooltipCancelHide = null;
    outsideClose.detach();
  }

  function onTooltipClose() { onHoverLeave(); }

  function openWallFromBubble(ev) {
    const m = ev?.detail?.message;
    if (!m) return;
    const pid = String(m.peerId ?? '').trim();

    // Own messages: always open your wall (PeerJS IDs can be transient; never rely on username here).
    if (!pid || pid === 'local' || isOwnMessage(m, $user, $peer)) {
      void openMyWall();
      return;
    }

    const cache = $avatarCache;
    const avatarBase64 = m.avatarBase64 ?? cache?.get?.(pid) ?? null;
    const bio = typeof $peer?.connectedPeers?.get?.(pid)?.bio === 'string' ? $peer.connectedPeers.get(pid).bio : '';

    void openWall({
      peerId: pid,
      username: String(m.username ?? ''),
      dateOfBirth: typeof m?.dateOfBirth === 'string' ? m.dateOfBirth : null,
      color: String(m.color ?? ''),
      avatarBase64,
      bio
    });
  }

  function openWallFromTooltip(ev) {
    const u = ev?.detail?.user;
    const pid = String(u?.peerId ?? '').trim();
    if (!pid) return;
    void openWall({
      peerId: pid,
      username: String(u?.username ?? ''),
      dateOfBirth: typeof u?.dateOfBirth === 'string' ? u.dateOfBirth : null,
      color: String(u?.color ?? ''),
      avatarBase64: u?.avatarBase64 ?? null,
      bio: String(u?.bio ?? '')
    });
  }

  function onMenuOpen(ev) {
    openMenuKey = String(ev?.detail?.messageKey ?? '');
    // Tooltips and message action menus are mutually exclusive.
    onHoverLeave();
    closeAllActionMenus(openMenuKey);
  }

  function onMenuClose(ev) { const key = String(ev?.detail?.messageKey ?? ''); if (key && key === openMenuKey) openMenuKey = ''; }

  async function onSend(e) {
    await handleGlobalChatSend({
      evt: e,
      user: $user,
      peerId: $peer?.peerId ?? null,
      editingMessageId: $editingMessageId,
      messages: $globalMessages ?? [],
      broadcastGlobalMessageEdit,
      broadcastGlobalMessage,
      addGlobalMessage,
      clearPendingReplies,
      setEditingMessageId: (id) => editingMessageId.set(id),
      setComposerValue: (v) => { composerValue = String(v ?? ''); composer.setText(composerValue); },
      computeRange,
      scrollToBottom
    });
  }

  async function scrollToAndHighlight(messageId) {
    await scrollToAndHighlightHelper({
      messageId: String(messageId ?? ''),
      listEl,
      getMessages: () => $globalMessages ?? [],
      windowed,
      estItemH: EST_ITEM_H,
      computeRange,
      tick,
      getGlobalMessagesPage,
      prependGlobalMessages,
      showToast
    });
  }

  onMount(() => {
    return setupGlobalChatMount({
      getComposerEl: () => composerEl,
      setComposerPad: (n) => { composerPad = n; },
      getListEl: () => listEl,
      setIsTouch: (v) => { isTouch = v; },
      setNow: (n) => { now = n; },
      globalMessagesStore: globalMessages,
      loadGlobalMessages,
      tick,
      getMessages: () => $globalMessages ?? [],
      computeRange,
      maybeAutoScroll,
      scrollToBottom
    });
  });

  $: msgs = $globalMessages;
  $: windowed = msgs.length > 200;
  $: visibleMsgs = windowed ? msgs.slice(start, end) : msgs;
  $: padTop = windowed ? start * EST_ITEM_H : 0;
  $: padBottom = windowed ? Math.max(0, (msgs.length - end) * EST_ITEM_H) : 0;

  function attachOutsideClose() {
    outsideClose.attach();
  }
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
      composerMedia = [];
      composer.reset();
      pickerOpen = false;
      clearPendingReplies();
    }

    await broadcastGlobalMessageDelete(target.messageId, {
      username: u.username,
      color: u.color,
      dateOfBirth: u.dateOfBirth ?? null,
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
                  on:openWall={openWallFromBubble}
	                    on:edit={(ev) => {
	                      const msg = ev?.detail?.message;
	                      if (!msg?.id) return;
	                      editingMessageId.set(msg.id);
                      composerValue = String(msg.text ?? '');
                      composerMedia = Array.isArray(msg?.media) ? msg.media.slice(0, 2) : [];
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
    <div bind:this={composerEl} class="composer-wrap">
      <MediaPicker
        bind:open={pickerOpen}
        maxItems={2}
        selectedItems={composerMedia}
        on:select={(ev) => {
          const item = ev?.detail?.item;
          if (!item) return;
          addRecentItem(item);
          composer.addItem(item);
          composerMedia = composer.toPayload().media ?? [];
          // If it's solo-media, send immediately.
          if (!$editingMessageId && composerValue.trim().length === 0) {
            const { text, media } = composer.toPayload();
            if (media) {
              pickerOpen = false;
              // Reuse ChatInput send path by dispatching the same shape.
              void onSend({ detail: { text: text.trim(), media, replies: $pendingReplies } });
              composerValue = '';
              composerMedia = [];
              composer.reset();
            }
          }
        }}
        on:close={() => (pickerOpen = false)}
      />
      <ChatInput
        bind:value={composerValue}
        mediaItems={composerMedia}
        mediaDisabled={composerMedia.length >= 2}
        mode={isEditing ? 'edit' : 'compose'}
        editLabel={editLabel}
        pendingReplies={$pendingReplies}
        on:removePendingReply={(ev) => removePendingReply(ev.detail.messageId)}
        on:jumpToOriginal={(ev) => scrollToAndHighlight(ev.detail.messageId)}
        on:send={(ev) => {
          const { text, media } = ev.detail ?? {};
          // Delegate validation to the existing handler; it will no-op if invalid.
          void onSend({ detail: { text, media, replies: ev?.detail?.replies } });
          // Reset after send attempt (the handler only succeeds for valid payloads).
          composerValue = '';
          composerMedia = [];
          composer.reset();
          pickerOpen = false;
        }}
        on:toggleMediaPicker={() => {
          if (composerMedia.length >= 2) return;
          pickerOpen = !pickerOpen;
        }}
        on:removeMedia={(ev) => { composer.removeItem(ev.detail.id); composerMedia = composer.toPayload().media ?? []; }}
        on:cancelEdit={() => {
          editingMessageId.set(null);
          composerValue = '';
          composerMedia = [];
          composer.reset();
          pickerOpen = false;
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
    on:viewProfile={openWallFromTooltip}
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
  .composer-wrap {
    position: relative;
  }
</style>
