<script>
  import { afterUpdate, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';
  import ChatInput from '$lib/components/ChatInput.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import MessageBubble from '$lib/components/MessageBubble.svelte';
  import { decryptForSession, isSessionActive } from '$lib/services/crypto.js';
  import { getPrivateMessagesPage } from '$lib/services/db.js';
  import { closePrivateChat, initiatePrivateChat, sendPrivateMessage } from '$lib/services/peer.js';
  import { peer as peerStore } from '$lib/stores/peerStore.js';
  import { user } from '$lib/stores/userStore.js';
  import { activeChat, closeChat, prependMessages } from '$lib/stores/privateChatStore.js';

  /** @type {HTMLDivElement|null} */
  let listEl = null;
  let lastCount = 0;
  let loadingOlder = false;
  let hasMore = true;

  let showDelete = false;
  let showActiveBanner = false;
  let bannerTimer = 0;
  let prevKeyState = '';
  let prevChatId = '';
  $: bannerInfo = banner($activeChat);

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
    await sendPrivateMessage(chat.theirPeerId, e.detail.text);
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
        if (canDecrypt) {
          try {
            text = await decryptForSession(chat.id, m.ciphertext, m.iv);
          } catch {
            // keep placeholder
          }
        }
        return { id: m.id, direction: m.direction, text, timestamp: m.timestamp, delivered: Boolean(m.delivered) };
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
    return {
      username: isOwn ? (u?.username ?? 'me') : chat.theirUsername,
      age: isOwn ? (u?.age ?? 0) : (chat.theirAge ?? get(peerStore).connectedPeers.get(chat.theirPeerId)?.age ?? 0),
      color: isOwn ? (u?.color ?? 'hsl(0,0%,65%)') : chat.theirColor,
      avatarBase64: isOwn ? (u?.avatarBase64 ?? null) : (chat.theirAvatarBase64 ?? null),
      text: m.text,
      timestamp: m.timestamp
    };
  }

  async function confirmDelete() {
    showDelete = false;
    const chat = $activeChat;
    if (!chat) return;
    await closePrivateChat(chat.theirPeerId);
  }

  async function retryKeyExchange() {
    const chat = $activeChat;
    if (!chat) return;
    try {
      await initiatePrivateChat(chat.theirPeerId, chat.theirUsername, chat.theirColor, chat.theirAvatarBase64 ?? null);
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
          class="sm:hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-[var(--space-sm)] py-[6px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          on:click={closeChat}
          aria-label="Back"
          title="Back"
        >
          ←
        </button>

        <AvatarDisplay username={$activeChat.theirUsername} avatarBase64={$activeChat.theirAvatarBase64 ?? null} size={36} showRing={true} />

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
        class="rounded-[var(--radius-md)] border border-[var(--border)] bg-transparent px-[var(--space-sm)] py-[6px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        on:click={() => (showDelete = true)}
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
            class="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-[var(--space-md)] py-[var(--space-sm)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-overlay)]"
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
              <MessageBubble message={msgToBubble(m, $activeChat)} isOwn={m.direction === 'sent'} />
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

    <div title={$activeChat.keyExchangeState !== 'active' ? 'Waiting for encryption setup...' : ''}>
      <ChatInput
        disabled={$activeChat.keyExchangeState !== 'active'}
        placeholder={$activeChat.keyExchangeState !== 'active' ? 'Waiting for encryption setup...' : 'Write a private message...'}
        on:send={onSend}
      />
    </div>
  </div>
{/if}

{#if showDelete && $activeChat}
  <ConfirmDialog
    title="Delete conversation?"
    message={`This deletes the conversation from this device only. ${$activeChat.theirUsername} will keep their copy.`}
    confirmLabel="Delete"
    dangerous={true}
    on:confirm={confirmDelete}
    on:cancel={() => (showDelete = false)}
  />
{/if}
