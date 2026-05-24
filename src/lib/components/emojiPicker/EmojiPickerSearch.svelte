<script>
  import { createEventDispatcher, onDestroy } from 'svelte';

  export let value = '';
  export let disabled = false;
  export let loadingIndex = false;
  export let resultsCount = 0;

  const dispatch = createEventDispatcher();
  let timer = 0;

  function schedule() {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      dispatch('debounced', { query: value });
    }, 300);
  }

  function clear() {
    value = '';
    dispatch('debounced', { query: '' });
  }

  onDestroy(() => clearTimeout(timer));
</script>

<div class="row" aria-label="Emoji search">
  <div class="wrap">
    <input
      class="inp"
      type="text"
      bind:value
      placeholder="Search emojis..."
      {disabled}
      on:input={schedule}
      aria-label="Search emojis"
    />
    {#if value.trim().length > 0}
      <button type="button" class="clear" on:click={clear} aria-label="Clear search" title="Clear" disabled={disabled}>
        ×
      </button>
    {/if}
  </div>

  <div class="status" aria-label="Search status">
    {#if loadingIndex}
      <span class="txt">Loading...</span>
    {:else if value.trim().length > 0}
      <span class="txt">{resultsCount} found</span>
    {/if}
  </div>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .wrap {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  .inp {
    width: 100%;
    height: 44px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-primary);
    padding: 0 40px 0 12px;
    outline: none;
  }

  .inp:focus {
    border-color: var(--border-focus);
  }

  .clear {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    height: 32px;
    width: 32px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--bg-overlay);
    color: var(--text-secondary);
    padding: 0;
  }

  .clear:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .status {
    height: 44px;
    min-width: 44px;
    display: grid;
    place-items: center;
    flex: none;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
  }

  @media (hover: hover) {
    .clear:hover:not(:disabled) {
      background: var(--bg-elevated);
      color: var(--text-primary);
    }
  }
</style>

