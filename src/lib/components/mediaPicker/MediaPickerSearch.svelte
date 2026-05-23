<script>
  import { createEventDispatcher, onDestroy } from 'svelte';

  export let value = '';
  export let placeholder = 'Search...';
  export let disabled = false;
  export let loading = false;
  export let show = true;

  const dispatch = createEventDispatcher();

  let timer = 0;

  function schedule() {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      dispatch('debounced', { query: value });
    }, 400);
  }

  function clear() {
    value = '';
    dispatch('debounced', { query: '' });
  }

  onDestroy(() => clearTimeout(timer));
</script>

{#if show}
  <div class="row">
    <div class="wrap">
      <input
        class="inp"
        type="text"
        bind:value
        {placeholder}
        {disabled}
        on:input={schedule}
        aria-label={placeholder}
      />
      {#if value.trim().length > 0}
        <button type="button" class="clear" on:click={clear} aria-label="Clear search" title="Clear" disabled={disabled}>
          ×
        </button>
      {/if}
    </div>

    <div class="status" aria-label="Search status">
      {#if loading}
        <span class="spin" aria-hidden="true"></span>
      {/if}
    </div>
  </div>
{/if}

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
    width: 44px;
    display: grid;
    place-items: center;
    flex: none;
  }

  .spin {
    height: 16px;
    width: 16px;
    border-radius: 999px;
    border: 2px solid color-mix(in srgb, var(--text-muted) 30%, transparent);
    border-top-color: var(--text-secondary);
    animation: sp 0.8s linear infinite;
  }

  @keyframes sp {
    to {
      transform: rotate(360deg);
    }
  }

  @media (hover: hover) {
    .clear:hover:not(:disabled) {
      background: var(--bg-elevated);
      color: var(--text-primary);
    }
  }
</style>

