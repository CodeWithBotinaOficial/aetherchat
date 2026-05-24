<script>
  import { afterUpdate, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import PrivateChatView from '$lib/components/privateChat/PrivateChatView.svelte';
  import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';
  import {
    avatarCache,
    closePrivateChat,
    deletePrivateMessage,
    editPrivateMessage,
    initiatePrivateChat,
    sendPrivateMessage
  } from '$lib/services/peer.js';
  import { peer as peerStore } from '$lib/stores/peerStore.js';
  import { user } from '$lib/stores/userStore.js';
  import {
    activeChat,
    addPendingReply,
    clearPendingReplies,
    closeChat,
    editingChatId,
    editingMessageId,
    prependMessages,
    removePendingReply,
    setPendingReplies
  } from '$lib/stores/privateChatStore.js';
  import { loadOlderPrivateMessages, scrollToAndHighlightPrivateMessage } from '$lib/components/privateChat/history.js';
  import { followPeer, openMyWall, openWall } from '$lib/stores/wall/actions.js';
  import { followingPeerIds } from '$lib/stores/wall/followState.js';
  import { createComposer } from '$lib/utils/mediaComposer.js';
  import { addRecentItem } from '$lib/stores/klipyRecents.js';

  /** @type {HTMLDivElement|null} */
  let listEl = null;
  let lastCount = 0;
  let loadingOlder = false;
  let hasMore = true;

  let showDelete = false;
	  /** @type {{ chatId: string, theirPeerId: string, theirUsername: string } | null} */
	  let deleteTarget = null;

  let showMsgDelete = false;
  /** @type {{ chatId: string, theirPeerId: string, messageId: string } | null} */
  let msgDeleteTarget = null;

  const composer = createComposer();
  let composerValue = '';
  /** @type {import('$lib/services/klipy/types.js').MessageMedia[]} */
  let composerMedia = [];
  let pickerOpen = false;
  let emojiPickerOpen = false;
  let showActiveBanner = false;
  let bannerTimer = 0;
  let prevKeyState = '';
  let prevChatId = '';
  $: bannerInfo = banner($activeChat);
  $: theirAvatar = $activeChat
    ? ($activeChat.theirAvatarBase64 ?? $avatarCache.get($activeChat.theirPeerId) ?? null)
    : null;
  $: isChatGated = Boolean($activeChat?.theirPeerId && !$followingPeerIds?.has?.($activeChat.theirPeerId));
  $: gateScenario = (() => {
    const chat = $activeChat;
    if (!chat) return 'never';
    const msgs = Array.isArray(chat.messages) ? chat.messages : [];
    const hasSent = msgs.some((m) => m?.direction === 'sent');
    return hasSent ? 'unfollowed' : 'never';
  })();

  $: keyState = $activeChat?.keyExchangeState ?? 'idle';
  $: inputDisabled = keyState === 'initiated' || keyState === 'completing';
  $: inputPlaceholder = getPlaceholder(keyState, $activeChat?.isOnline);
  $: isEditingThisChat = Boolean($activeChat && $editingChatId === $activeChat.id && $editingMessageId);
  $: editLabel = (() => {
    if (!isEditingThisChat) return '';
    const msg = ($activeChat?.messages ?? []).find((m) => m?.id === $editingMessageId) ?? null;
    const ts = typeof msg?.timestamp === 'number' ? msg.timestamp : Date.now();
    return `Editing message from ${new Date(ts).toLocaleTimeString()}`;
  })();

  function getPlaceholder(state, isOnline) {
    if (state === 'initiated' || state === 'completing') return 'Setting up encryption...';
    if (!isOnline) return 'Message will be delivered when they reconnect...';
    if (state === 'idle' || state === 'failed') return 'Message will be encrypted and sent when connected...';
    return 'Message...';
  }

  function scrollToBottom() {
    if (!listEl) return;
    listEl.scrollTop = listEl.scrollHeight;
  }

  afterUpdate(() => {
    const chat = $activeChat;
    if (!chat) return;
    if (!listEl) return;

    if (chat.id !== prevChatId) {
      prevChatId = chat.id;
      prevKeyState = chat.keyExchangeState;
      hasMore = true;
      lastCount = 0;
      // Switching chats cancels any active edit session (single-edit invariant).
      editingMessageId.set(null);
      editingChatId.set(null);
      composerValue = '';
      clearPendingReplies(chat.id);
      scrollToBottom();
    }

    if (chat.keyExchangeState === 'active' && prevKeyState !== 'active') {
      clearTimeout(bannerTimer);
      showActiveBanner = true;
      bannerTimer = setTimeout(() => {
        showActiveBanner = false;
      }, 5000);
    }
    prevKeyState = chat.keyExchangeState;

    if (chat.messages.length < 100) hasMore = false;

    const nextCount = chat.messages.length;
    if (nextCount > lastCount && !loadingOlder) scrollToBottom();
    lastCount = nextCount;
  });

  onDestroy(() => {
    clearTimeout(bannerTimer);
  });

  function banner(chat) {
    if (!chat) return null;
    if (chat.keyExchangeState === 'initiated') return { kind: 'warn', text: 'Setting up encryption... waiting for response' };
    if (chat.keyExchangeState === 'completing') return { kind: 'warn', text: 'Completing key exchange...' };
    if (chat.keyExchangeState === 'failed') return { kind: 'danger', text: 'Encryption failed. Messages are not secure.' };
    if (chat.keyExchangeState === 'active' && showActiveBanner) return { kind: 'ok', text: 'End-to-end encrypted' };
    return null;
  }

  function bannerClass(kind) {
    if (kind === 'ok') return 'bg-[color-mix(in_srgb,var(--success)_18%,transparent)] border-[color-mix(in_srgb,var(--success)_35%,var(--border))] text-[var(--text-primary)]';
    if (kind === 'danger') return 'bg-[color-mix(in_srgb,var(--danger)_18%,transparent)] border-[color-mix(in_srgb,var(--danger)_35%,var(--border))] text-[var(--text-primary)]';
    return 'bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] border-[color-mix(in_srgb,var(--warning)_35%,var(--border))] text-[var(--text-primary)]';
  }

	  async function onSend(e) {
	    const chat = $activeChat;
	    if (!chat) return;

      const rawPending = Array.isArray(e?.detail?.replies) ? e.detail.replies : [];
      const byId = new Map((chat.messages ?? []).map((m) => [m?.id, m]));
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
      const media = Array.isArray(e?.detail?.media) && e.detail.media.length > 0 ? e.detail.media.slice(0, 2) : null;

      if (isEditingThisChat) {
        await editPrivateMessage(chat.id, chat.theirPeerId, $editingMessageId, e.detail.text, media, safeReplies);
        editingMessageId.set(null);
        editingChatId.set(null);
        composerValue = '';
        composerMedia = [];
        pickerOpen = false;
        clearPendingReplies(chat.id);
        return;
      }

	    await sendPrivateMessage(chat.id, chat.theirPeerId, e.detail.text, media, safeReplies);
      composerValue = '';
      composerMedia = [];
      // Keep picker open when sending text+media; close only for solo media.
      if (String(e?.detail?.text ?? '').trim().length === 0) pickerOpen = false;
      clearPendingReplies(chat.id);
	  }

  async function loadOlder() {
    const chat = $activeChat;
    await loadOlderPrivateMessages({
      chat,
      hasMore,
      setHasMore: (next) => {
        hasMore = next;
      },
      setLoadingOlder: (next) => {
        loadingOlder = next;
      },
      prependMessages
    });
  }

  function theirOnline(chat) {
    if (!chat) return false;
    const entry = get(peerStore).connectedPeers.get(chat.theirPeerId);
    return Boolean(entry);
  }

	  function msgToBubble(m, chat) {
	    const u = get(user);
	    const isOwn = m.direction === 'sent';
	    const safeText = typeof m.text === 'string' ? m.text : '🔒 Encrypted message';
	    return {
	      id: m.id,
        peerId: isOwn ? (get(peerStore)?.peerId ?? 'local') : chat.theirPeerId,
	      username: isOwn ? (u?.username ?? 'me') : chat.theirUsername,
	      dateOfBirth: isOwn
          ? (u?.dateOfBirth ?? null)
          : (chat.theirDateOfBirth ?? get(peerStore).connectedPeers.get(chat.theirPeerId)?.dateOfBirth ?? null),
      color: isOwn ? (u?.color ?? 'hsl(0,0%,65%)') : chat.theirColor,
      avatarBase64: isOwn ? (u?.avatarBase64 ?? null) : theirAvatar,
      text: safeText,
      media: Array.isArray(m?.media) && m.media.length > 0 ? m.media.slice(0, 2) : null,
      replies: Array.isArray(m?.replies) && m.replies.length > 0 ? m.replies : null,
      timestamp: m.timestamp,
      editedAt: Object.prototype.hasOwnProperty.call(m, 'editedAt') ? (m.editedAt ?? null) : null,
      deleted: Boolean(m?.deleted),
      delivered: Boolean(m?.delivered),
      queued: Boolean(m?.queued)
    };
  }

  function openWallFromBubble(ev) {
    const isOwn = Boolean(ev?.detail?.isOwn);
    const m = ev?.detail?.message;
    if (isOwn) {
      void openMyWall();
      return;
    }
    if (!$activeChat || !m) return;
    const pid = String($activeChat.theirPeerId ?? '').trim();
    if (!pid) return;
    const bio = typeof get(peerStore).connectedPeers.get(pid)?.bio === 'string' ? get(peerStore).connectedPeers.get(pid).bio : '';
    void openWall({
      peerId: pid,
      username: String(m.username ?? $activeChat.theirUsername ?? ''),
      dateOfBirth: typeof m?.dateOfBirth === 'string' ? m.dateOfBirth : ($activeChat?.theirDateOfBirth ?? null),
      color: String(m.color ?? $activeChat.theirColor ?? ''),
      avatarBase64: m.avatarBase64 ?? null,
      bio
    });
  }

  async function scrollToAndHighlight(messageId) {
    await scrollToAndHighlightPrivateMessage({
      listEl,
      chat: $activeChat,
      messageId,
      getHasMore: () => hasMore,
      loadOlder
    });
  }

	  async function confirmDelete() {
	    showDelete = false;
	    const target = deleteTarget;
	    deleteTarget = null;
	    if (!target?.chatId) return;
	    await closePrivateChat(target.chatId);
	  }

    async function confirmMsgDelete() {
      showMsgDelete = false;
      const target = msgDeleteTarget;
      msgDeleteTarget = null;
      if (!target?.chatId || !target?.messageId) return;
      // Cancel edit if the deleted message is being edited.
      if (target.chatId === $editingChatId && target.messageId === $editingMessageId) {
        editingMessageId.set(null);
        editingChatId.set(null);
        composerValue = '';
      }
      await deletePrivateMessage(target.chatId, target.theirPeerId, target.messageId);
      clearPendingReplies(target.chatId);
    }

  async function retryKeyExchange() {
    const chat = $activeChat;
    if (!chat) return;
    try {
      await initiatePrivateChat(chat.theirPeerId, chat.theirUsername, chat.theirColor, theirAvatar);
    } catch (err) {
      console.error('retry key exchange failed', err);
    }
  }

  function requestDeleteConversation() {
    showDelete = true;
    if ($activeChat) deleteTarget = { chatId: $activeChat.id, theirPeerId: $activeChat.theirPeerId, theirUsername: $activeChat.theirUsername };
  }

  function requestEditMessage(msg) {
    if (!msg?.id || !$activeChat) return;
    editingChatId.set($activeChat.id);
    editingMessageId.set(msg.id);
    composerValue = String(msg.text ?? '');
    composerMedia = Array.isArray(msg?.media) ? msg.media.slice(0, 2) : [];
    pickerOpen = false;
    setPendingReplies($activeChat.id, Array.isArray(msg.replies) ? msg.replies : null);
  }

  function requestDeleteMessage(msg) {
    if (!msg?.id || !$activeChat) return;
    showMsgDelete = true;
    msgDeleteTarget = { chatId: $activeChat.id, theirPeerId: $activeChat.theirPeerId, messageId: msg.id };
  }

  function cancelEdit() {
    if (!$activeChat) return;
    editingMessageId.set(null);
    editingChatId.set(null);
    composerValue = '';
    composerMedia = [];
    pickerOpen = false;
    clearPendingReplies($activeChat.id);
  }
</script>

{#if $activeChat}
  {#if isChatGated}
    <div class="pc h-full flex flex-col bg-[var(--bg-base)]">
      <div class="flex items-center justify-between gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-md)] border-b border-[var(--border)] bg-[var(--bg-surface)]">
        <div class="flex items-center gap-[var(--space-sm)] min-w-0">
          <button
            class="btn-back sm:hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-[var(--space-sm)] py-[6px] text-[var(--text-secondary)]"
            on:click={closeChat}
            aria-label="Back"
            title="Back"
          >
            ← Back
          </button>
          <div class="truncate font-800 text-[var(--text-primary)]">Private Chat</div>
        </div>

        <button
          class="btn-icon rounded-[var(--radius-md)] border border-[var(--border)] bg-transparent px-[var(--space-sm)] py-[6px] text-[var(--text-secondary)]"
          on:click={requestDeleteConversation}
          aria-label="Delete conversation"
          title="Delete conversation"
        >
          🗑️
        </button>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto px-[var(--space-lg)] py-[var(--space-xl)] grid place-items-center">
        <div class="w-full max-w-[420px] text-center">
          <div class="mx-auto mb-[var(--space-md)]">
            <AvatarDisplay username={$activeChat.theirUsername} avatarBase64={theirAvatar} size={80} showRing={true} />
          </div>
          <div class="text-[var(--text-primary)] font-900 text-[1.25rem] truncate">{$activeChat.theirUsername}</div>

          <div class="mt-[var(--space-sm)] text-[var(--text-secondary)] text-[var(--font-size-sm)] leading-[1.45]">
            {gateScenario === 'unfollowed'
              ? 'To recover this chat, you must follow this person.'
              : 'To see this message, you must follow this person back.'}
          </div>

          <div class="mt-[var(--space-lg)] grid gap-[10px]">
            <button
              class="btn-follow rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--accent)] px-[var(--space-md)] py-[10px] font-900 text-[var(--text-primary)]"
              on:click={() => followPeer({ peerId: $activeChat.theirPeerId, username: $activeChat.theirUsername })}
              aria-label="Follow"
              title="Follow"
            >
              Follow
            </button>

            <button
              class="btn-delete rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-[var(--space-md)] py-[10px] font-900 text-[var(--text-primary)]"
              on:click={requestDeleteConversation}
              aria-label="Delete conversation"
              title="Delete conversation"
            >
              Delete conversation
            </button>
          </div>
        </div>
      </div>
    </div>
  {:else}
    <PrivateChatView
      chat={$activeChat}
      bind:listEl
      theirAvatar={theirAvatar}
      theirOnline={theirOnline}
      hasMore={hasMore}
      loadingOlder={loadingOlder}
      loadOlder={loadOlder}
      bannerInfo={bannerInfo}
      bannerClass={bannerClass}
      retryKeyExchange={retryKeyExchange}
      inputDisabled={inputDisabled}
      inputPlaceholder={inputPlaceholder}
      bind:composerValue
      bind:composerMedia
      bind:pickerOpen
      bind:emojiPickerOpen
      isEditingThisChat={isEditingThisChat}
      editLabel={editLabel}
      msgToBubble={msgToBubble}
      onOpenWallFromBubble={openWallFromBubble}
      onReply={(msg) => addPendingReply($activeChat.id, msg)}
      onJumpToOriginal={(messageId) => scrollToAndHighlight(messageId)}
      onEditRequest={requestEditMessage}
      onDeleteRequest={requestDeleteMessage}
      pendingReplies={$activeChat.pendingReplies ?? []}
      onRemovePendingReply={(messageId) => removePendingReply($activeChat.id, messageId)}
      onCancelEdit={cancelEdit}
      onSend={onSend}
      onMediaPick={(item) => {
        if (!item) return;
        addRecentItem(item);
        composer.addItem(item);
        composerMedia = composer.toPayload().media ?? [];
        if (!isEditingThisChat && composerValue.trim().length === 0 && composerMedia.length > 0) {
          // Solo-media: send immediately, then close picker.
          void (async () => {
            await onSend({ detail: { text: '', media: composerMedia, replies: $activeChat?.pendingReplies ?? [] } });
            pickerOpen = false;
          })();
          composerValue = '';
          composerMedia = [];
          composer.reset();
        }
      }}
      onMediaRemove={(id) => { composer.removeItem(id); composerMedia = composer.toPayload().media ?? []; }}
      onTogglePicker={() => { if (composerMedia.length >= 2) return; emojiPickerOpen = false; pickerOpen = !pickerOpen; }}
      onToggleEmojiPicker={() => {
        pickerOpen = false;
        emojiPickerOpen = !emojiPickerOpen;
      }}
      onRequestDeleteConversation={requestDeleteConversation}
      onBack={closeChat}
    />
  {/if}
{/if}

{#if showDelete && deleteTarget}
  <ConfirmDialog
    title="Delete conversation?"
    message={`This deletes the conversation from this device only. ${deleteTarget.theirUsername} will keep their copy.`}
    confirmLabel="Delete"
    dangerous={true}
    on:confirm={confirmDelete}
    on:cancel={() => {
      showDelete = false;
      deleteTarget = null;
    }}
  />
{/if}

{#if showMsgDelete && msgDeleteTarget}
  <ConfirmDialog
    title="Delete message?"
    message="This will replace the message with a deletion placeholder for both participants."
    confirmLabel="Delete"
    dangerous={true}
    on:confirm={confirmMsgDelete}
    on:cancel={() => {
      showMsgDelete = false;
      msgDeleteTarget = null;
    }}
  />
{/if}
  $: composer.setText(composerValue);
  $: composer.setMedia(composerMedia);
