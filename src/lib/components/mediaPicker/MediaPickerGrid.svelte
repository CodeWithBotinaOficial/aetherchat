<script>
  import { createEventDispatcher } from 'svelte';
  import MediaPickerItem from './MediaPickerItem.svelte';

  export let items = [];
  export let loading = false;
  export let error = '';
  export let query = '';
  export let maxedOut = false;
  export let selectedIds = new Set();

  const dispatch = createEventDispatcher();

  function retry() {
    dispatch('retry');
  }
</script>

{#if error}
  <div class="state">
    <div class="msg">Could not load items. Check your connection.</div>
    <button type="button" class="btn" on:click={retry} aria-label="Retry" title="Retry">Retry</button>
  </div>
{:else if loading}
  <div class="grid" aria-label="Loading">
    {#each Array.from({ length: 9 }) as _, i (i)}
      <div class="sk"></div>
    {/each}
  </div>
{:else if !items || items.length === 0}
  <div class="state" aria-label="No results">
    <div class="msg">
      No results found{#if query?.trim?.().length > 0} for <span class="q">"{query.trim()}"</span>{/if}.
    </div>
  </div>
{:else}
  <div class="grid" aria-label="Media results">
    {#each items as it (it.id)}
      <div class="cell">
        <MediaPickerItem
          item={it}
          disabled={maxedOut && !selectedIds?.has?.(it.id)}
          selected={selectedIds?.has?.(it.id)}
          on:pick={(ev) => dispatch('pick', ev.detail)}
        />
      </div>
    {/each}
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
    justify-items: stretch;
  }

  @media (max-width: 639px) {
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    }
  }

  .cell {
    width: 100%;
    aspect-ratio: 1 / 1;
  }

  .sk {
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-elevated) 70%, var(--bg-surface));
    overflow: hidden;
    position: relative;
  }

  .sk::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in srgb, var(--bg-overlay) 60%, transparent),
      transparent
    );
    transform: translateX(-60%);
    animation: sh 1.1s ease-in-out infinite;
  }

  @keyframes sh {
    to {
      transform: translateX(60%);
    }
  }

  .state {
    min-height: 140px;
    display: grid;
    place-items: center;
    gap: 10px;
    padding: 16px;
    text-align: center;
    color: var(--text-secondary);
  }

  .q {
    color: var(--text-primary);
    font-family: var(--font-mono);
  }

  .btn {
    height: 44px;
    padding: 0 14px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-weight: 900;
    min-width: 120px;
  }

  @media (hover: hover) {
    .btn:hover {
      background: var(--bg-overlay);
    }
  }
</style>
