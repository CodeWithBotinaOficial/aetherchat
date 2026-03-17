<script>
  import { createEventDispatcher, onMount } from 'svelte';

  export let placeholder = 'Write a message...';
  export let disabled = false;
  export let maxLength = 500;

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
    dispatch('send', { text });
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
  @media (hover: hover) {
    .send-btn:hover:not(:disabled) {
      background: var(--accent-hover);
    }
  }
</style>
