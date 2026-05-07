<script>
  import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';
  import ChatInput from '$lib/components/ChatInput.svelte';
  import MessageBubble from '$lib/components/MessageBubble.svelte';

  export let chat;
  export let listEl;
  export let theirAvatar;
  export let theirOnline;
  export let hasMore;
  export let loadingOlder;
  export let loadOlder;

  export let bannerInfo;
  export let bannerClass;
  export let retryKeyExchange;

  export let inputDisabled;
  export let inputPlaceholder;
  export let composerValue;
  export let isEditingThisChat;
  export let editLabel;

  export let msgToBubble;
  export let onOpenWallFromBubble;
  export let onReply;
  export let onJumpToOriginal;
  export let onEditRequest;
  export let onDeleteRequest;

  export let pendingReplies;
  export let onRemovePendingReply;
  export let onCancelEdit;
  export let onSend;
  export let onRequestDeleteConversation;
  export let onBack;
</script>

<div class="pc h-full flex flex-col bg-[var(--bg-base)]">
  <div class="flex items-center justify-between gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-md)] border-b border-[var(--border)] bg-[var(--bg-surface)]">
    <div class="flex items-center gap-[var(--space-sm)] min-w-0">
      <button
        class="btn-back sm:hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-[var(--space-sm)] py-[6px] text-[var(--text-secondary)]"
        on:click={onBack}
        aria-label="Back"
        title="Back"
      >
        ← Back
      </button>

      <AvatarDisplay username={chat.theirUsername} avatarBase64={theirAvatar} size={36} showRing={true} />

      <div class="min-w-0">
        <div class="truncate font-800 text-[var(--text-primary)]">{chat.theirUsername}</div>
        <div class="mt-[2px] flex items-center gap-[6px] text-[var(--font-size-xs)] text-[var(--text-muted)] font-mono">
          <span
            class="inline-block h-[8px] w-[8px] rounded-[var(--radius-full)]"
            style={`background:${theirOnline(chat) ? 'var(--success)' : 'var(--text-muted)'}`}
            aria-hidden="true"
          ></span>
          <span>{theirOnline(chat) ? 'online' : 'offline'}</span>
        </div>
      </div>
</div>

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

    <button
      class="btn-icon rounded-[var(--radius-md)] border border-[var(--border)] bg-transparent px-[var(--space-sm)] py-[6px] text-[var(--text-secondary)]"
      on:click={onRequestDeleteConversation}
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
          <button class="ml-[var(--space-sm)] underline text-[var(--text-primary)]" on:click={retryKeyExchange} title="Reset chat">Retry</button>
        {/if}
      </div>
    </div>
  {/if}

  <div bind:this={listEl} class="pc-scroll flex-1 min-h-0 overflow-y-auto">
    <div class="pc-inner">
      {#if hasMore && chat.messages.length >= 100}
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

      {#if chat.messages.length === 0 && chat.keyExchangeState === 'active'}
        <div class="h-full grid place-items-center px-[var(--space-lg)]">
          <div class="text-center">
            <div class="mx-auto mb-[var(--space-md)] h-[44px] w-[44px] rounded-[var(--radius-full)] grid place-items-center border border-[var(--border)] bg-[var(--bg-elevated)]">
              <svg viewBox="0 0 24 24" class="h-[20px] w-[20px] text-[var(--text-secondary)]" fill="currentColor" aria-hidden="true">
                <path d="M17 8h-1V6a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2Zm-7-2a2 2 0 0 1 4 0v2h-4V6Z" />
              </svg>
            </div>
            <div class="text-[var(--text-primary)] font-700">This conversation is end-to-end encrypted.</div>
            <div class="mt-[var(--space-xs)] text-[var(--text-secondary)] text-[var(--font-size-sm)]">Only you and {chat.theirUsername} can read these messages.</div>
          </div>
        </div>
      {:else}
        {#each chat.messages as m (m.id)}
          <div class={`pc-msg ${m.direction === 'sent' ? 'pc-msg-own' : 'pc-msg-their'}`}>
            <MessageBubble
              message={msgToBubble(m, chat)}
              isOwn={m.direction === 'sent'}
              canEdit={m.direction === 'sent' && !m.deleted && !m.queued}
              canDelete={m.direction === 'sent' && !m.deleted && !m.queued}
              on:openWall={onOpenWallFromBubble}
              on:reply={(ev) => onReply(ev.detail.message)}
              on:jumpToOriginal={(ev) => onJumpToOriginal(ev.detail.messageId)}
              on:edit={(ev) => onEditRequest(ev.detail.message)}
              on:delete={(ev) => onDeleteRequest(ev.detail.message)}
            />

            {#if m.direction === 'sent'}
              <div class="pc-status text-[var(--font-size-xs)] text-[var(--text-muted)] font-mono">
                {m.delivered ? '✓ delivered' : theirOnline(chat) ? 'sent' : 'queued'}
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
      pendingReplies={pendingReplies}
      placeholder={inputPlaceholder}
      on:removePendingReply={(ev) => onRemovePendingReply(ev.detail.messageId)}
      on:jumpToOriginal={(ev) => onJumpToOriginal(ev.detail.messageId)}
      on:send={onSend}
      on:cancelEdit={onCancelEdit}
    />
  </div>
</div>
