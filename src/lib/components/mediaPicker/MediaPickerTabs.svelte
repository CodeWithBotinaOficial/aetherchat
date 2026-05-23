<script>
  export let active = 'gifs'; // 'gifs' | 'stickers' | 'recents'
  export let disabled = false;

  const tabs = [
    { id: 'gifs', label: 'GIFs' },
    { id: 'stickers', label: 'Stickers' },
    { id: 'recents', label: 'Recents' }
  ];
</script>

<div class="tabs" role="tablist" aria-label="Media picker tabs">
  {#each tabs as t (t.id)}
    <button
      type="button"
      class={`tab ${active === t.id ? 'on' : ''}`}
      role="tab"
      aria-selected={active === t.id}
      disabled={disabled}
      on:click={() => (active = t.id)}
    >
      {t.label}
    </button>
  {/each}
</div>

<style>
  .tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .tab {
    height: 44px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    font-weight: 900;
    font-size: var(--font-size-sm);
  }

  .tab.on {
    background: var(--bg-overlay);
    color: var(--text-primary);
    border-color: var(--border-focus);
  }

  .tab:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  @media (hover: hover) {
    .tab:hover:not(:disabled) {
      background: var(--bg-overlay);
      color: var(--text-primary);
    }
  }
</style>

