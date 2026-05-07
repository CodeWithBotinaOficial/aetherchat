<script>
  import { afterUpdate, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import PrivateChatView from '$lib/components/privateChat/PrivateChatView.svelte';
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
  import { openMyWall, openWall } from '$lib/stores/wall/actions.js';

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

  let composerValue = '';
  let showActiveBanner = false;
  let bannerTimer = 0;
  let prevKeyState = '';
  let prevChatId = '';
  $: bannerInfo = banner($activeChat);
  $: theirAvatar = $activeChat
    ? ($activeChat.theirAvatarBase64 ?? $avatarCache.get($activeChat.theirPeerId) ?? null)
    : null;

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

      if (isEditingThisChat) {
        await editPrivateMessage(chat.id, chat.theirPeerId, $editingMessageId, e.detail.text, safeReplies);
        editingMessageId.set(null);
        editingChatId.set(null);
        composerValue = '';
        clearPendingReplies(chat.id);
        return;
      }

	    await sendPrivateMessage(chat.id, chat.theirPeerId, e.detail.text, safeReplies);
      composerValue = '';
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
    clearPendingReplies($activeChat.id);
  }
</script>

{#if $activeChat}
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
    onRequestDeleteConversation={requestDeleteConversation}
    onBack={closeChat}
  />
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
