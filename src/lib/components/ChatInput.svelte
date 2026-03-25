<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { previewText } from '$lib/utils/replies.js';

  export let placeholder = 'Write a message...';
  export let disabled = false;
  export let maxLength = 500;
  export let pendingReplies = [];

  const dispatch = createEventDispatcher();

  let value = '';
  /** @type {HTMLTextAreaElement|null} */
  let textarea = null;

  function updateHeight() {
    if (!textarea) return;
    textarea.style.height = 'auto';

    const computed = getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computed.lineHeight || '24') || 24;
    const maxHeight = lineHeight * 5 + 18;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }

  function send() {
    const text = value.trim();
    if (!text) return;
    dispatch('send', { text, replies: Array.isArray(pendingReplies) ? pendingReplies : [] });
    value = '';
    updateHeight();
  }

  function onKeydown(e) {
    if (disabled) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  $: showCounter = value.length >= Math.floor(maxLength * 0.8);

  onMount(() => {
    updateHeight();
  });

  $: if (textarea) updateHeight();
</script>

<div class="border-t border-[var(--border)] bg-[var(--bg-surface)] px-[var(--space-md)] py-[var(--space-sm)]">
  {#if Array.isArray(pendingReplies) && pendingReplies.length > 0}
    <div
      class="pending-replies mb-[var(--space-sm)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)]"
      aria-label="Pending replies"
    >
      <div class="pending-scroll p-[var(--space-sm)]">
        {#each pendingReplies as r (r.messageId)}
          <div
            class="pending-card relative w-full text-left rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-[var(--space-sm)] py-[var(--space-sm)]"
            style={`border-left: 3px solid ${r.authorColor};`}
            role="button"
            tabindex="0"
            on:click={() => dispatch('jumpToOriginal', { messageId: r.messageId })}
            on:keydown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                dispatch('jumpToOriginal', { messageId: r.messageId });
              }
            }}
          >
            <div class="min-w-0 pr-[26px]">
              <div class="truncate text-[var(--font-size-xs)] font-800 text-[var(--text-primary)]">{r.authorUsername}</div>
              <div class="mt-[2px] text-[var(--font-size-xs)] text-[var(--text-secondary)]">
                {previewText(r.textSnapshot, 80)}
              </div>
            </div>

            <button
              type="button"
              class="pending-remove absolute right-[6px] top-[6px] h-[26px] w-[26px] grid place-items-center rounded-[var(--radius-full)] border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
              aria-label="Remove reply"
              title="Remove reply"
              on:click|stopPropagation={() => dispatch('removePendingReply', { messageId: r.messageId })}
            >
              ×
            </button>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <div class="flex items-end gap-[var(--space-sm)]">
    <div class="flex-1">
      <textarea
        bind:this={textarea}
        bind:value
        class="w-full resize-none rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-[var(--space-md)] py-[var(--space-sm)] text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)] disabled:opacity-50"
        rows="1"
        {placeholder}
        {disabled}
        {maxLength}
        on:keydown={onKeydown}
        on:input={updateHeight}
      ></textarea>
      {#if showCounter}
        <div class="mt-[var(--space-xs)] text-right text-[var(--font-size-xs)] text-[var(--text-muted)] font-mono">
          {value.length}/{maxLength}
        </div>
      {/if}
    </div>

    <button
      class="send-btn rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--accent)] px-[var(--space-md)] py-[var(--space-sm)] text-[var(--text-primary)] font-600 disabled:opacity-50 disabled:cursor-not-allowed"
      disabled={disabled || value.trim().length === 0}
      on:click={send}
      aria-label="Send"
      title="Send"
    >
      Send
    </button>
  </div>
</div>

<style>
  .pending-scroll {
    max-height: 30vh;
    overflow: auto;
    display: grid;
    gap: 8px;
  }

  @media (hover: hover) {
    .send-btn:hover:not(:disabled) {
      background: var(--accent-hover);
    }

    .pending-card:hover {
      background: var(--bg-overlay);
    }

    .pending-remove:hover {
      color: var(--text-primary);
      background: var(--bg-overlay);
    }
  }
</style>
