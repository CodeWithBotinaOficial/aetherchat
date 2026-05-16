<script>
  import { userDirectoryStore } from '$lib/stores/userDirectory/state.js';
  import { setPageSize } from '$lib/stores/userDirectory/filters.js';

  const sizes = [15, 30, 50, 100];

  $: total = $userDirectoryStore.allUsers.length;
  $: showing = $userDirectoryStore.displayedUsers.length;
  $: pageSize = $userDirectoryStore.pageSize;
</script>

<div class="bar" aria-label="User directory pagination controls">
  <div class="meta">
    {#if pageSize === Infinity}
      Showing all {showing} users
    {:else}
      Showing {showing} of {total} users
    {/if}
  </div>

  <div class="controls">
    {#if pageSize !== Infinity}
      <div class="sizes" role="group" aria-label="Page size selector">
        {#each sizes as s (s)}
          <button
            type="button"
            class={`pill ${pageSize === s ? 'active' : ''}`}
            on:click={() => setPageSize(s)}
            aria-label={`Show ${s} users`}
          >
            {s}
          </button>
        {/each}
      </div>

      {#if pageSize === 100 && total > 100}
        <button type="button" class="pill pill-secondary" on:click={() => setPageSize(Infinity)} aria-label="View all users">
          View All Users
        </button>
      {/if}
    {:else}
      <button type="button" class="pill pill-secondary" on:click={() => setPageSize(100)} aria-label="Back to 100 users">
        Back to 100
      </button>
    {/if}
  </div>
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
  }

  .meta {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .controls {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }

  .sizes {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }

  .pill {
    height: 32px;
    padding: 0 10px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-weight: 900;
    font-size: 12px;
  }

  .pill.active {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    background: color-mix(in srgb, var(--accent) 18%, var(--bg-elevated));
  }

  .pill-secondary {
    background: var(--bg-overlay);
  }

  @media (hover: hover) {
    .pill:hover {
      background: var(--bg-overlay);
    }
  }
</style>

