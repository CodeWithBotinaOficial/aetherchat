<script>
  import { afterUpdate, createEventDispatcher } from 'svelte';
  import { fetchTrendingGifs, fetchTrendingStickers, searchGifs, searchStickers } from '$lib/services/klipy/index.js';
  import { recentItems } from '$lib/stores/klipyRecents.js';
  import MediaPickerTabs from './MediaPickerTabs.svelte';
  import MediaPickerSearch from './MediaPickerSearch.svelte';
  import MediaPickerGrid from './MediaPickerGrid.svelte';

  export let open = false;
  export let maxItems = 2;
  /** @type {import('$lib/services/klipy/types.js').MessageMedia[]} */
  export let selectedItems = [];

  const dispatch = createEventDispatcher();

  /** @type {'gifs'|'stickers'|'recents'} */
  let tab = 'gifs';
  /** @type {'gifs'|'stickers'|'recents'} */
  let prevTab = 'gifs';
  let prevOpen = false;
  let query = '';
  let loading = false;
  let error = '';
  /** @type {import('$lib/services/klipy/types.js').KlipyItem[]} */
  let items = [];

  $: selectedIds = new Set((selectedItems ?? []).map((m) => m.id));
  $: maxedOut = (selectedItems?.length ?? 0) >= maxItems;

  async function loadCurrent(q) {
    if (!open) return;
    loading = true;
    error = '';
    try {
      if (tab === 'gifs') {
        items = await (q && q.trim().length > 0 ? searchGifs(q, 24) : fetchTrendingGifs(24));
      } else if (tab === 'stickers') {
        items = await (q && q.trim().length > 0 ? searchStickers(q, 24) : fetchTrendingStickers(24));
      } else {
        items = [];
      }
    } catch {
      error = 'load_failed';
      items = [];
    } finally {
      loading = false;
    }
  }

  function close() {
    open = false;
    dispatch('close');
  }

  function onBackdropDown(e) {
    if (e.target !== e.currentTarget) return;
    close();
  }

  function resetForOpen() {
    tab = 'gifs';
    prevTab = 'gifs';
    query = '';
    error = '';
    items = [];
    void loadCurrent('');
  }

  function onTabSwitch() {
    query = '';
    error = '';
    items = [];
    void loadCurrent('');
  }

  afterUpdate(() => {
    const openChanged = open !== prevOpen;
    const tabChanged = tab !== prevTab;
    // Update prev markers first to avoid re-entrancy loops when we mutate state below.
    prevOpen = open;
    prevTab = tab;
    if (open && openChanged) resetForOpen();
    else if (open && tabChanged) onTabSwitch();
  });

  function onDebounced(ev) {
    query = String(ev?.detail?.query ?? '');
    void loadCurrent(query);
  }

  function onPick(ev) {
    const item = ev?.detail?.item;
    if (!item) return;
    dispatch('select', { item });
  }

</script>

{#if open}
  <div class="backdrop" role="presentation" on:pointerdown={onBackdropDown} aria-label="Media picker backdrop">
    <div class="panel" role="dialog" aria-label="Media picker">
      <MediaPickerTabs bind:active={tab} />
      <MediaPickerSearch
        show={tab !== 'recents'}
        bind:value={query}
        placeholder={tab === 'stickers' ? 'Search stickers...' : 'Search GIFs...'}
        loading={loading}
        on:debounced={onDebounced}
      />

      {#if tab === 'recents'}
        <MediaPickerGrid
          items={$recentItems ?? []}
          loading={false}
          error=""
          query=""
          maxedOut={maxedOut}
          selectedIds={selectedIds}
          on:pick={onPick}
        />
      {:else}
        <MediaPickerGrid
          items={items}
          loading={loading}
          error={error}
          query={query}
          maxedOut={maxedOut}
          selectedIds={selectedIds}
          on:pick={onPick}
          on:retry={() => loadCurrent(query)}
        />
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    /* Allow clicking outside without covering the input area. */
    height: 320px;
    display: grid;
    align-items: end;
    padding: 8px 0;
  }

  .panel {
    height: 300px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-surface);
    box-shadow: var(--shadow-md);
    padding: 10px;
    display: grid;
    grid-template-rows: auto auto 1fr;
    gap: 10px;
  }

  @media (max-width: 639px) {
    .backdrop {
      position: fixed;
      left: 0;
      right: 0;
      bottom: calc(56px + env(safe-area-inset-bottom, 0px));
      top: 0;
      height: auto;
      padding: 0;
      align-items: end;
      z-index: 60;
    }

    .panel {
      height: calc(100vh - (56px + env(safe-area-inset-bottom, 0px)));
      border-radius: 12px 12px 0 0;
      border-left: 0;
      border-right: 0;
      border-bottom: 0;
      padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
    }
  }
</style>
