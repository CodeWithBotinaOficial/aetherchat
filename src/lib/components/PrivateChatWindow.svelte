<script>
  import { afterUpdate, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';
  import ChatInput from '$lib/components/ChatInput.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import MessageBubble from '$lib/components/MessageBubble.svelte';
  import { decryptForSession, isSessionActive } from '$lib/services/crypto.js';
  import { getPrivateMessagesPage } from '$lib/services/db.js';
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
  import { cssEscape } from '$lib/utils/replies.js';
  import { decodePrivateBody } from '$lib/utils/privateMessageCodec.js';
  import { showToast } from '$lib/stores/toastStore.js';
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
    if (!chat) return;
    if (chat.messages.length === 0) return;
    if (!hasMore) return;

    loadingOlder = true;
    const oldest = chat.messages[0]?.timestamp ?? Date.now();
    const page = await getPrivateMessagesPage(chat.id, oldest, 50);
    if (page.length === 0) {
      hasMore = false;
      loadingOlder = false;
      return;
    }

    const canDecrypt = isSessionActive(chat.id);
    const decrypted = await Promise.all(
      page.map(async (m) => {
        const deleted = Boolean(m?.deleted);
        let text = deleted ? '[ This message was deleted ]' : '🔒 Encrypted message — start a new session to decrypt';
        let editedAt = Object.prototype.hasOwnProperty.call(m, 'editedAt') ? (m.editedAt ?? null) : null;
        /** @type {any[]|null} */
        let replies = null;
	        if (canDecrypt && !deleted) {
	          try {
	            const raw = await decryptForSession(chat.id, m.ciphertext, m.iv);
              const decoded = decodePrivateBody(raw);
	            text = decoded.text;
              editedAt = decoded.editedAt ?? editedAt;
	          } catch (err) {
	            if (err?.name !== 'OperationError') console.error('loadOlder decrypt failed:', err?.message ?? String(err));
	          }
	          if (typeof m?.replies?.ciphertext === 'string' && typeof m?.replies?.iv === 'string') {
	            try {
	              const raw = await decryptForSession(chat.id, m.replies.ciphertext, m.replies.iv);
	              const parsed = JSON.parse(raw);
	              replies = Array.isArray(parsed) ? parsed : null;
	            } catch (err) {
	              if (err?.name !== 'OperationError') console.error('loadOlder replies decrypt failed:', err?.message ?? String(err));
	            }
	          }
	        }
        return {
          id: m.id,
          direction: m.direction,
          text,
          replies,
          repliesCiphertext: typeof m?.replies?.ciphertext === 'string' ? m.replies.ciphertext : null,
          repliesIv: typeof m?.replies?.iv === 'string' ? m.replies.iv : null,
          timestamp: m.timestamp,
          delivered: Boolean(m.delivered),
          editedAt,
          deleted,
          sealed: !canDecrypt && m.direction !== 'sent'
        };
      })
    );

    prependMessages(chat.id, decrypted);

    loadingOlder = false;
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
	      age: isOwn ? (u?.age ?? 0) : (chat.theirAge ?? get(peerStore).connectedPeers.get(chat.theirPeerId)?.age ?? 0),
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
      age: Number(m.age ?? 0),
      color: String(m.color ?? $activeChat.theirColor ?? ''),
      avatarBase64: m.avatarBase64 ?? null,
      bio
    });
  }

  async function scrollToAndHighlight(messageId) {
    const id = String(messageId ?? '').trim();
    if (!id || !listEl) return;

    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    const tryFindEl = () => listEl?.querySelector?.(`[data-message-id="${cssEscape(id)}"]`) ?? null;

    let guard = 0;
    while (!($activeChat?.messages ?? []).some((m) => m?.id === id) && hasMore && guard < 12) {
      guard += 1;
      await loadOlder();
      await Promise.resolve();
    }

    if (!($activeChat?.messages ?? []).some((m) => m?.id === id)) {
      showToast('Original message not available.');
      return;
    }

    const el = tryFindEl();
    if (!el) {
      await Promise.resolve();
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
</script>

{#if $activeChat}
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

        <AvatarDisplay username={$activeChat.theirUsername} avatarBase64={theirAvatar} size={36} showRing={true} />

        <div class="min-w-0">
          <div class="truncate font-800 text-[var(--text-primary)]">{$activeChat.theirUsername}</div>
          <div class="mt-[2px] flex items-center gap-[6px] text-[var(--font-size-xs)] text-[var(--text-muted)] font-mono">
            <span
              class="inline-block h-[8px] w-[8px] rounded-[var(--radius-full)]"
              style={`background:${theirOnline($activeChat) ? 'var(--success)' : 'var(--text-muted)'}`}
              aria-hidden="true"
            ></span>
            <span>{theirOnline($activeChat) ? 'online' : 'offline'}</span>
          </div>
        </div>
      </div>

      <button
        class="btn-icon rounded-[var(--radius-md)] border border-[var(--border)] bg-transparent px-[var(--space-sm)] py-[6px] text-[var(--text-secondary)]"
	        on:click={() => {
	          showDelete = true;
	          if ($activeChat) deleteTarget = { chatId: $activeChat.id, theirPeerId: $activeChat.theirPeerId, theirUsername: $activeChat.theirUsername };
	        }}
	        aria-label="Delete conversation"
	        title="Delete conversation"
	      >
        🗑️
      </button>
    </div>

    {#if bannerInfo}
      <div class={`px-[var(--space-md)] py-[var(--space-sm)] border-b border-[var(--border)] ${bannerClass(bannerInfo.kind)}`}>
        <div class="text-[var(--font-size-sm)] font-600">
          {bannerInfo.kind === 'ok' ? '✅' : bannerInfo.kind === 'danger' ? '⚠️' : '🔄'} {bannerInfo.text}
          {#if bannerInfo.kind === 'danger'}
            <button
              class="ml-[var(--space-sm)] underline text-[var(--text-primary)]"
              on:click={retryKeyExchange}
              title="Reset chat"
            >
              Retry
            </button>
          {/if}
        </div>
      </div>
    {/if}

		    <div bind:this={listEl} class="pc-scroll flex-1 min-h-0 overflow-y-auto">
		      <div class="pc-inner">
		      {#if hasMore && $activeChat.messages.length >= 100}
		        <div class="mb-[var(--space-md)] grid place-items-center">
	          <button
	            class="btn-load rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-[var(--space-md)] py-[var(--space-sm)] text-[var(--text-secondary)]"
            on:click={loadOlder}
            disabled={loadingOlder}
          >
            {loadingOlder ? 'Loading...' : 'Load older messages'}
          </button>
        </div>
      {/if}

      {#if $activeChat.messages.length === 0 && $activeChat.keyExchangeState === 'active'}
        <div class="h-full grid place-items-center px-[var(--space-lg)]">
          <div class="text-center">
            <div class="mx-auto mb-[var(--space-md)] h-[44px] w-[44px] rounded-[var(--radius-full)] grid place-items-center border border-[var(--border)] bg-[var(--bg-elevated)]">
              <svg viewBox="0 0 24 24" class="h-[20px] w-[20px] text-[var(--text-secondary)]" fill="currentColor" aria-hidden="true">
                <path d="M17 8h-1V6a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2Zm-7-2a2 2 0 0 1 4 0v2h-4V6Z" />
              </svg>
            </div>
            <div class="text-[var(--text-primary)] font-700">This conversation is end-to-end encrypted.</div>
            <div class="mt-[var(--space-xs)] text-[var(--text-secondary)] text-[var(--font-size-sm)]">
              Only you and {$activeChat.theirUsername} can read these messages.
            </div>
          </div>
        </div>
		      {:else}
		        {#each $activeChat.messages as m (m.id)}
		          <div class={`pc-msg ${m.direction === 'sent' ? 'pc-msg-own' : 'pc-msg-their'}`}>
                    <MessageBubble
                      message={msgToBubble(m, $activeChat)}
                      isOwn={m.direction === 'sent'}
                  canEdit={m.direction === 'sent' && !m.deleted && !m.queued}
                  canDelete={m.direction === 'sent' && !m.deleted && !m.queued}
                  on:openWall={openWallFromBubble}
                      on:reply={(ev) => addPendingReply($activeChat.id, ev.detail.message)}
                      on:jumpToOriginal={(ev) => scrollToAndHighlight(ev.detail.messageId)}
                  on:edit={(ev) => {
                    const msg = ev?.detail?.message;
                    if (!msg?.id || !$activeChat) return;
                    editingChatId.set($activeChat.id);
                    editingMessageId.set(msg.id);
                    composerValue = String(msg.text ?? '');
                    setPendingReplies($activeChat.id, Array.isArray(msg.replies) ? msg.replies : null);
                  }}
                  on:delete={(ev) => {
                    const msg = ev?.detail?.message;
                    if (!msg?.id || !$activeChat) return;
                    showMsgDelete = true;
                    msgDeleteTarget = { chatId: $activeChat.id, theirPeerId: $activeChat.theirPeerId, messageId: msg.id };
                  }}
		            />

		            {#if m.direction === 'sent'}
		              <div class="pc-status text-[var(--font-size-xs)] text-[var(--text-muted)] font-mono">
		                {m.delivered ? '✓ delivered' : theirOnline($activeChat) ? 'sent' : 'queued'}
		              </div>
		            {/if}
		          </div>
		        {/each}
		      {/if}
		      </div>
		    </div>

    <div title={inputDisabled ? 'Setting up encryption...' : ''}>
      <ChatInput
        disabled={inputDisabled}
        bind:value={composerValue}
        mode={isEditingThisChat ? 'edit' : 'compose'}
        editLabel={editLabel}
        pendingReplies={$activeChat.pendingReplies ?? []}
        placeholder={inputPlaceholder}
        on:removePendingReply={(ev) => removePendingReply($activeChat.id, ev.detail.messageId)}
        on:jumpToOriginal={(ev) => scrollToAndHighlight(ev.detail.messageId)}
        on:send={onSend}
        on:cancelEdit={() => {
          if (!$activeChat) return;
          editingMessageId.set(null);
          editingChatId.set(null);
          composerValue = '';
          clearPendingReplies($activeChat.id);
        }}
      />
    </div>
  </div>
{/if}

		<style>
		  .pc {
		    --chat-pad-x: clamp(12px, 2.2vw, 32px);
		    --chat-pad-y: clamp(12px, 1.8vw, 24px);
		    --msg-gap: clamp(10px, 1.3vh, 16px);
		  }

		  .pc-scroll {
		    padding: var(--chat-pad-y) var(--chat-pad-x);
		  }

		  .pc-inner {
		    width: 100%;
		  }

		  .pc-msg {
		    width: 100%;
		    display: flex;
		    flex-direction: column;
		    margin-bottom: var(--msg-gap);
		  }

		  .pc-msg-own {
		    align-items: flex-end;
		  }

		  .pc-msg-their {
		    align-items: flex-start;
		  }

		  .pc-status {
		    margin-top: -10px;
		    margin-bottom: var(--space-sm);
		    padding-right: var(--space-sm);
		  }

		  @media (hover: hover) {
		    .btn-back:hover {
		      color: var(--text-primary);
		    }

    .btn-icon:hover {
      background: var(--bg-elevated);
      color: var(--text-primary);
    }

    .btn-load:hover:not(:disabled) {
      background: var(--bg-overlay);
      color: var(--text-primary);
    }
  }
</style>

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
