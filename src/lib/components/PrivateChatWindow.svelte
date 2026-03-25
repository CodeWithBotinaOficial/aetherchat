<script>
  import { afterUpdate, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';
  import ChatInput from '$lib/components/ChatInput.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import MessageBubble from '$lib/components/MessageBubble.svelte';
  import { decryptForSession, isSessionActive } from '$lib/services/crypto.js';
  import { getPrivateMessagesPage } from '$lib/services/db.js';
  import { avatarCache, closePrivateChat, initiatePrivateChat, sendPrivateMessage } from '$lib/services/peer.js';
  import { peer as peerStore } from '$lib/stores/peerStore.js';
  import { user } from '$lib/stores/userStore.js';
  import {
    activeChat,
    addPendingReply,
    clearPendingReplies,
    closeChat,
    prependMessages,
    removePendingReply
  } from '$lib/stores/privateChatStore.js';
  import { cssEscape } from '$lib/utils/replies.js';
  import { showToast } from '$lib/stores/toastStore.js';

  /** @type {HTMLDivElement|null} */
  let listEl = null;
  let lastCount = 0;
  let loadingOlder = false;
  let hasMore = true;

  let showDelete = false;
	  /** @type {{ chatId: string, theirPeerId: string, theirUsername: string } | null} */
	  let deleteTarget = null;
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
          timestamp: typeof original?.timestamp === 'number' ? original.timestamp : 0
        };
      });
      const safeReplies = replies.length > 0 ? replies : null;

	    await sendPrivateMessage(chat.id, chat.theirPeerId, e.detail.text, safeReplies);
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
        let text = '🔒 Encrypted message — start a new session to decrypt';
        /** @type {any[]|null} */
        let replies = null;
        if (canDecrypt) {
          try {
            text = await decryptForSession(chat.id, m.ciphertext, m.iv);
          } catch {
            // keep placeholder
          }
          if (typeof m?.replies?.ciphertext === 'string' && typeof m?.replies?.iv === 'string') {
            try {
              const raw = await decryptForSession(chat.id, m.replies.ciphertext, m.replies.iv);
              const parsed = JSON.parse(raw);
              replies = Array.isArray(parsed) ? parsed : null;
            } catch {
              // ignore
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
          delivered: Boolean(m.delivered)
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
    const safeText =
      typeof m.text === 'string'
        ? m.text
        : m?.sealed
          ? '🔒 Encrypted in a previous session'
          : '🔒 Encrypted message';
    return {
      id: m.id,
      username: isOwn ? (u?.username ?? 'me') : chat.theirUsername,
      age: isOwn ? (u?.age ?? 0) : (chat.theirAge ?? get(peerStore).connectedPeers.get(chat.theirPeerId)?.age ?? 0),
      color: isOwn ? (u?.color ?? 'hsl(0,0%,65%)') : chat.theirColor,
      avatarBase64: isOwn ? (u?.avatarBase64 ?? null) : theirAvatar,
      text: safeText,
      replies: Array.isArray(m?.replies) && m.replies.length > 0 ? m.replies : null,
      timestamp: m.timestamp
    };
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
  <div class="h-full flex flex-col bg-[var(--bg-base)]">
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

    <div bind:this={listEl} class="flex-1 min-h-0 overflow-y-auto px-[var(--space-md)] py-[var(--space-md)]">
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
          <div class={m.direction === 'sent' ? 'flex flex-col items-end' : 'flex flex-col items-start'}>
            <div class="mb-[var(--space-sm)] w-full">
              <MessageBubble
                message={msgToBubble(m, $activeChat)}
                isOwn={m.direction === 'sent'}
                on:reply={(ev) => addPendingReply($activeChat.id, ev.detail.message)}
                on:jumpToOriginal={(ev) => scrollToAndHighlight(ev.detail.messageId)}
              />
            </div>
            {#if m.direction === 'sent'}
              <div class="mt-[-10px] mb-[var(--space-sm)] pr-[var(--space-sm)] text-[var(--font-size-xs)] text-[var(--text-muted)] font-mono">
                {m.delivered ? '✓ delivered' : theirOnline($activeChat) ? 'sent' : 'queued'}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>

    <div title={inputDisabled ? 'Setting up encryption...' : ''}>
      <ChatInput
        disabled={inputDisabled}
        pendingReplies={$activeChat.pendingReplies ?? []}
        placeholder={inputPlaceholder}
        on:removePendingReply={(ev) => removePendingReply($activeChat.id, ev.detail.messageId)}
        on:jumpToOriginal={(ev) => scrollToAndHighlight(ev.detail.messageId)}
        on:send={onSend}
      />
    </div>
  </div>
{/if}

<style>
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
