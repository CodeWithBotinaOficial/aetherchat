<script>
  import { onDestroy } from 'svelte';
  import { userDirectoryStore } from '$lib/stores/userDirectory/state.js';
  import { setSearch } from '$lib/stores/userDirectory/search.js';

  let timer = null;

  function queueSearch(value) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => setSearch(value), 150);
  }

  onDestroy(() => {
    if (timer) clearTimeout(timer);
    timer = null;
  });
</script>

<div class="search">
  <div class="field">
    <input
      class="input"
      type="text"
      placeholder="Search users..."
      value={$userDirectoryStore.searchQuery}
      on:input={(e) => queueSearch(e.currentTarget.value)}
      aria-label="Search users"
    />

    {#if $userDirectoryStore.searchQuery.trim().length > 0}
      <button
        type="button"
        class="clear"
        on:click={() => setSearch('')}
        aria-label="Clear search"
        title="Clear"
      >
        ×
      </button>
    {/if}
  </div>

  {#if $userDirectoryStore.isSearching}
    <div class="count" aria-label="Search results count">
      {$userDirectoryStore.displayedUsers.length} user{$userDirectoryStore.displayedUsers.length === 1 ? '' : 's'} found
    </div>
  {/if}
</div>

<style>
  .search {
    display: grid;
    gap: 8px;
  }

  .field {
    position: relative;
    display: grid;
  }

  .input {
    height: 44px;
    width: 100%;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-primary);
    padding: 0 44px 0 12px;
    font-weight: 700;
    outline: none;
  }

  .input:focus {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
  }

  .clear {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--bg-overlay);
    color: var(--text-primary);
    font-weight: 900;
    line-height: 1;
    display: grid;
    place-items: center;
  }

  .count {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  @media (hover: hover) {
    .clear:hover {
      background: color-mix(in srgb, var(--bg-overlay) 70%, var(--accent-subtle));
    }
  }
</style>

