<script>
  import { userDirectoryStore } from '$lib/stores/userDirectory/state.js';
  import UserCard from './UserCard.svelte';
  import UserDirectoryPagination from './UserDirectoryPagination.svelte';

  const SKELETON_COUNT = 9;

  $: isSearching = $userDirectoryStore.isSearching;
  $: isLoading = $userDirectoryStore.isLoading;
  $: allCount = $userDirectoryStore.allUsers.length;
  $: shownCount = $userDirectoryStore.displayedUsers.length;
  $: showPagination = !isSearching && allCount > 15;
  $: isEmptyDirectory = !isLoading && allCount === 0;
  $: isEmptyResults = !isLoading && allCount > 0 && shownCount === 0;
</script>

<div class="grid-wrap">
  {#if showPagination}
    <UserDirectoryPagination />
  {/if}

  {#if isLoading}
    <div class="grid" aria-label="Loading users">
      {#each Array.from({ length: SKELETON_COUNT }) as _, idx (idx)}
        <div class="skeleton" aria-hidden="true">
          <div class="sk-dot"></div>
          <div class="sk-avatar"></div>
          <div class="sk-line sk-name"></div>
          <div class="sk-line sk-age"></div>
          <div class="sk-line sk-bio"></div>
        </div>
      {/each}
    </div>
  {:else if isEmptyDirectory}
    <div class="empty" aria-label="Directory empty">
      <div class="empty-ico" aria-hidden="true">👥</div>
      <div class="empty-title">No other users discovered yet.</div>
      <div class="empty-sub">Users appear here as they join the network.</div>
    </div>
  {:else if isEmptyResults}
    <div class="empty" aria-label="No users found">
      <div class="empty-ico" aria-hidden="true">🔎</div>
      <div class="empty-title">No users found.</div>
      <div class="empty-sub">Try a different search or filter.</div>
    </div>
  {:else}
    <div class="grid" aria-label="User cards grid">
      {#each $userDirectoryStore.displayedUsers as u (u.peerId)}
        <UserCard user={u} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .grid-wrap {
    min-height: 0;
    display: grid;
    gap: var(--space-md);
    align-content: start;
  }

  .grid {
    display: grid;
    gap: var(--space-md);
    grid-template-columns: 1fr;
  }

  @media (min-width: 640px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (min-width: 1024px) {
    .grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  @media (min-width: 1440px) {
    .grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  .empty {
    height: 100%;
    min-height: 260px;
    display: grid;
    place-items: center;
    padding: 20px;
    text-align: center;
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
  }

  .empty-ico {
    font-size: 28px;
    line-height: 1;
    margin-bottom: 10px;
  }

  .empty-title {
    font-weight: 900;
  }

  .empty-sub {
    margin-top: 4px;
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    max-width: 52ch;
  }

  .skeleton {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-surface);
    padding: 14px;
    min-height: 190px;
    display: grid;
    justify-items: center;
    gap: 10px;
    position: relative;
    overflow: hidden;
  }

  .skeleton::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.06) 48%,
      transparent 100%
    );
    transform: translateX(-100%);
    animation: shimmer 1.15s linear infinite;
  }

  .sk-dot {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 10px;
    height: 10px;
    border-radius: 9999px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
  }

  .sk-avatar {
    margin-top: 6px;
    width: 64px;
    height: 64px;
    border-radius: 9999px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
  }

  .sk-line {
    width: 90%;
    height: 12px;
    border-radius: 9999px;
    background: var(--bg-elevated);
    border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  }

  .sk-name {
    width: 70%;
    height: 14px;
  }

  .sk-age {
    width: 50%;
  }

  .sk-bio {
    width: 92%;
    height: 28px;
    border-radius: var(--radius-md);
  }

  @keyframes shimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }
</style>
