<script>
  export let active = 'recents';
  export let categories = [];
  export let showLabels = true;
  export let disabled = false;
</script>

<div class="bar" aria-label="Emoji categories">
  {#each categories as c (c.id)}
    <button
      type="button"
      class={`tab ${active === c.id ? 'on' : ''}`}
      on:click={() => (active = c.id)}
      disabled={disabled}
      aria-label={c.label}
      title={c.label}
    >
      <span class="ico" aria-hidden="true">{c.emoji}</span>
      {#if showLabels}
        <span class="lbl">{c.shortLabel ?? c.label}</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .bar {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    padding-bottom: 2px;
    scroll-snap-type: x proximity;
  }

  .tab {
    height: 44px;
    min-width: 44px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    font-weight: 900;
    font-size: var(--font-size-sm);
    flex: none;
    scroll-snap-align: start;
  }

  .tab.on {
    background: var(--bg-overlay);
    border-color: var(--border-focus);
    color: var(--text-primary);
  }

  .tab:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .ico {
    font-size: 18px;
    line-height: 1;
  }

  .lbl {
    white-space: nowrap;
  }

  @media (max-width: 420px) {
    .lbl {
      display: none;
    }
  }

  @media (hover: hover) {
    .tab:hover:not(:disabled) {
      background: var(--bg-overlay);
      color: var(--text-primary);
    }
  }
</style>

