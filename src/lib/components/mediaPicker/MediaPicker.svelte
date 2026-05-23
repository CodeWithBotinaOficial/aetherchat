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
  <div class="host" role="presentation" on:pointerdown={onBackdropDown} aria-label="Media picker host">
    <div class="panel" role="dialog" tabindex="-1" aria-label="Media picker" on:pointerdown|stopPropagation>
      <div class="head">
        <div class="tabs">
          <MediaPickerTabs bind:active={tab} />
        </div>
        <button
          type="button"
          class="close"
          aria-label="Close media picker"
          title="Close"
          on:click={close}
          on:pointerdown|stopPropagation
        >
          ×
        </button>
      </div>
      <MediaPickerSearch
        show={tab !== 'recents'}
        bind:value={query}
        placeholder={tab === 'stickers' ? 'Search stickers...' : 'Search GIFs...'}
        loading={loading}
        on:debounced={onDebounced}
      />

      <div class="body" role="presentation">
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
  </div>
{/if}

<style>
  .host {
    width: 100%;
    height: 320px;
    padding: 8px;
    background: transparent;
  }

  .panel {
    height: 100%;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-surface);
    box-shadow: var(--shadow-md);
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .tabs {
    flex: 1;
    min-width: 0;
  }

  .close {
    height: 44px;
    width: 44px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    padding: 0;
    flex: none;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
  }

  @media (max-width: 639px) {
    .host {
      height: 320px;
      padding: 8px;
    }
  }

  @media (hover: hover) {
    .close:hover {
      background: var(--bg-overlay);
      color: var(--text-primary);
    }
  }
</style>
