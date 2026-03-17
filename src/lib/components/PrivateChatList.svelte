<script>
  import { fly } from 'svelte/transition';
  import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { avatarCache, closePrivateChat } from '$lib/services/peer.js';
  import { activeChat, chatList, totalUnread, openChat } from '$lib/stores/privateChatStore.js';

  function formatRelative(ts) {
    const diff = Date.now() - ts;
    if (diff < 10_000) return 'now';
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  }

  function preview(chat) {
    if (chat.keyExchangeState !== 'active') return '🔒 Encrypted message';
    const txt = String(chat.lastMessage ?? '').trim();
    if (!txt) return ' ';
    return txt.length > 40 ? `${txt.slice(0, 40)}…` : txt;
  }

  function getAvatar(chat) {
    const cache = $avatarCache;
    return chat.theirAvatarBase64 ?? cache?.get?.(chat.theirPeerId) ?? null;
  }

  let pendingDelete = null;

  function requestDelete(chat) {
    pendingDelete = chat;
  }

  async function confirmDelete() {
    const chat = pendingDelete;
    pendingDelete = null;
    if (!chat) return;
    await closePrivateChat(chat.theirPeerId);
  }

  function cancelDelete() {
    pendingDelete = null;
  }

  // Long-press support (mobile).
  let pressTimer = 0;
  function onPressStart(chat) {
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => requestDelete(chat), 650);
  }
  function onPressEnd() {
    clearTimeout(pressTimer);
  }
</script>

<div class="chat-list h-full flex flex-col">
  <div class="section-header flex items-center justify-between">
    <div>Private Chats</div>
    {#if $totalUnread > 0}
      <div class="unread-badge" aria-label="Total unread messages">
        {$totalUnread > 99 ? '99+' : $totalUnread}
      </div>
    {/if}
  </div>

  {#if $chatList.length === 0}
    <div class="empty-state flex-1 grid place-items-center">
      <div class="text-center">
        <div class="mx-auto mb-[var(--space-md)] h-[44px] w-[44px] rounded-[var(--radius-full)] grid place-items-center border border-[var(--border)] bg-[var(--bg-elevated)]">
          <svg viewBox="0 0 24 24" class="h-[20px] w-[20px] text-[var(--text-secondary)]" fill="currentColor" aria-hidden="true">
            <path d="M17 8h-1V6a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2Zm-7-2a2 2 0 0 1 4 0v2h-4V6Z" />
          </svg>
        </div>
        <div class="text-[var(--text-primary)] font-700">No private conversations yet.</div>
        <div class="mt-[var(--space-xs)] text-[var(--text-secondary)] text-[var(--font-size-sm)]">
          Start one by hovering over a user in the Global Chat.
        </div>
      </div>
    </div>
  {:else}
    <div class="flex-1 overflow-y-auto">
      {#each $chatList as c (c.id)}
        <button
          class="chat-item w-full text-left"
          class:active={$activeChat?.id === c.id}
          on:click={() => openChat(c.id)}
          on:contextmenu|preventDefault={() => requestDelete(c)}
          on:pointerdown={() => onPressStart(c)}
          on:pointerup={onPressEnd}
          on:pointercancel={onPressEnd}
          on:pointerleave={onPressEnd}
          in:fly={{ y: -20, duration: 200 }}
        >
          <div class="flex items-center gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-md)]">
            <AvatarDisplay username={c.theirUsername} avatarBase64={getAvatar(c)} size={34} showRing={true} />

            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-[var(--space-sm)]">
                <div class="chat-username truncate">{c.theirUsername}</div>
                <div class="flex items-center gap-[var(--space-sm)]">
                  <div class="chat-timestamp">{formatRelative(c.lastActivity)}</div>
                  {#if c.unreadCount > 0}
                    <div class="unread-badge">
                      {c.unreadCount > 99 ? '99+' : c.unreadCount}
                    </div>
                  {/if}
                </div>
              </div>

              <div class="mt-[2px] flex items-center justify-between gap-[var(--space-sm)]">
                <div class="chat-preview min-w-0">{preview(c)}</div>
                <div class="flex items-center gap-[6px] text-[var(--font-size-xs)] text-[var(--text-muted)] font-mono">
                  <span class={c.isOnline ? 'online-dot' : 'offline-dot'} aria-hidden="true"></span>
                  <span>{c.isOnline ? 'online' : 'offline'}</span>
                </div>
              </div>
            </div>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

{#if pendingDelete}
  <ConfirmDialog
    title="Delete conversation?"
    message={`This deletes the conversation from this device only. ${pendingDelete.theirUsername} will keep their copy.`}
    confirmLabel="Delete"
    dangerous={true}
    on:confirm={confirmDelete}
    on:cancel={cancelDelete}
  />
{/if}

<style>
  .chat-list {
    background: var(--bg-surface);
    color: var(--text-primary);
  }

  .section-header {
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border);
    background: var(--bg-surface);
  }

  .chat-item {
    background: transparent;
    color: var(--text-primary);
    border-bottom: 1px solid var(--border);
    border-left: 3px solid transparent;
    transition: background 150ms ease, color 150ms ease;
    cursor: pointer;
  }

  .chat-item:hover {
    background: var(--bg-elevated);
  }

  .chat-item.active {
    background: var(--accent-subtle);
    border-left-color: var(--accent);
  }

  .chat-username {
    color: var(--text-primary);
    font-weight: 600;
    font-size: var(--font-size-sm);
  }

  .chat-preview {
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 180px;
  }

  .chat-timestamp {
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    white-space: nowrap;
    font-family: var(--font-mono);
  }

  .online-dot,
  .offline-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .online-dot {
    background: var(--success);
  }

  .offline-dot {
    background: var(--text-muted);
  }

  .unread-badge {
    background: var(--accent);
    color: var(--text-primary);
    font-size: var(--font-size-xs);
    font-weight: 700;
    border-radius: var(--radius-full);
    padding: 1px 6px;
    min-width: 18px;
    text-align: center;
    text-transform: none;
    letter-spacing: normal;
  }

  .empty-state {
    color: var(--text-muted);
    padding: var(--space-xl) var(--space-lg);
    font-size: var(--font-size-sm);
  }
</style>
