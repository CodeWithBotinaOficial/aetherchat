<script>
  import { fly } from 'svelte/transition';
  import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { chatList, totalUnread, openChat } from '$lib/stores/privateChatStore.js';
  import { closePrivateChat } from '$lib/services/peer.js';

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

<div class="h-full flex flex-col bg-[var(--bg-surface)]">
  <div class="flex items-center justify-between px-[var(--space-md)] py-[var(--space-md)] border-b border-[var(--border)]">
    <div class="font-800 text-[var(--text-primary)]">Private Chats</div>
    {#if $totalUnread > 0}
      <div
        class="rounded-[var(--radius-full)] bg-[var(--accent-subtle)] px-[var(--space-sm)] py-[2px] text-[var(--font-size-xs)] text-[var(--text-primary)] border border-[var(--border)]"
        aria-label="Total unread messages"
      >
        {$totalUnread > 99 ? '99+' : $totalUnread}
      </div>
    {/if}
  </div>

  {#if $chatList.length === 0}
    <div class="flex-1 grid place-items-center px-[var(--space-lg)]">
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
          class="w-full text-left px-[var(--space-md)] py-[var(--space-md)] border-b border-[var(--border)] hover:bg-[var(--bg-elevated)] transition-colors duration-150"
          on:click={() => openChat(c.id)}
          on:contextmenu|preventDefault={() => requestDelete(c)}
          on:pointerdown={() => onPressStart(c)}
          on:pointerup={onPressEnd}
          on:pointercancel={onPressEnd}
          on:pointerleave={onPressEnd}
          in:fly={{ y: -20, duration: 200 }}
        >
          <div class="flex items-center gap-[var(--space-sm)]">
            <AvatarDisplay username={c.theirUsername} avatarBase64={c.theirAvatarBase64 ?? null} size={34} showRing={true} />

            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-[var(--space-sm)]">
                <div class="truncate font-700 text-[var(--text-primary)]">{c.theirUsername}</div>
                <div class="flex items-center gap-[var(--space-sm)]">
                  <div class="text-[var(--font-size-xs)] text-[var(--text-muted)] font-mono">
                    {formatRelative(c.lastActivity)}
                  </div>
                  {#if c.unreadCount > 0}
                    <div class="rounded-[var(--radius-full)] bg-[var(--accent)] px-[var(--space-sm)] py-[2px] text-[var(--font-size-xs)] text-[var(--text-primary)]">
                      {c.unreadCount > 99 ? '99+' : c.unreadCount}
                    </div>
                  {/if}
                </div>
              </div>

              <div class="mt-[2px] flex items-center justify-between gap-[var(--space-sm)]">
                <div class="min-w-0 truncate text-[var(--font-size-sm)] text-[var(--text-secondary)]">
                  {preview(c)}
                </div>
                <div class="flex items-center gap-[6px] text-[var(--font-size-xs)] text-[var(--text-muted)] font-mono">
                  <span
                    class="inline-block h-[8px] w-[8px] rounded-[var(--radius-full)]"
                    style={`background:${c.isOnline ? 'var(--success)' : 'var(--text-muted)'}`}
                    aria-hidden="true"
                  ></span>
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

