<script>
  import { onMount } from 'svelte';
  import { loadUsers } from '$lib/stores/userDirectory/filters.js';

  import UserDirectorySearch from './UserDirectorySearch.svelte';
  import UserDirectoryFilters from './UserDirectoryFilters.svelte';
  import UserDirectoryGrid from './UserDirectoryGrid.svelte';

  onMount(() => {
    loadUsers().catch((err) => console.error('UserDirectory loadUsers failed', err));
  });
</script>

<section class="dir" aria-label="User Directory">
  <div class="stack">
    <UserDirectorySearch />
    <UserDirectoryFilters />
    <UserDirectoryGrid />
  </div>
</section>

<style>
  .dir {
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .stack {
    height: 100%;
    min-height: 0;
    display: grid;
    grid-template-rows: auto auto 1fr;
    gap: var(--space-md);
  }
</style>

