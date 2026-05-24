<script>
  import { afterUpdate, createEventDispatcher, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { EMOJI_CATEGORIES, fetchCategory } from '$lib/services/emojiHub/index.js';
  import { buildSearchIndex, searchEmojis } from '$lib/services/emojiHub/search.js';
  import { recentEmojis } from '$lib/stores/emojiRecents.js';

  import EmojiPickerSearch from './EmojiPickerSearch.svelte';
  import EmojiCategoryBar from './EmojiCategoryBar.svelte';
  import EmojiGrid from './EmojiGrid.svelte';

  export let open = false;

  const dispatch = createEventDispatcher();

  let prevOpen = false;

  /** @type {string} */
  let active = 'recents';
  let query = '';

  /** @type {Record<string, import('$lib/services/emojiHub/types.js').EmojiItem[]>} */
  const categoryCache = Object.create(null);

  /** @type {import('$lib/services/emojiHub/types.js').EmojiItem[]} */
  let categoryItems = [];
  let categoryLoading = false;

  /** @type {import('$lib/services/emojiHub/types.js').EmojiItem[]|null} */
  let allEmojis = null;
  let indexLoading = false;
  /** @type {import('$lib/services/emojiHub/types.js').EmojiItem[]} */
  let results = [];

  const recentsTab = { id: 'recents', label: 'Recents', shortLabel: 'Recents', emoji: '🕘' };
  const tabs = [recentsTab, ...EMOJI_CATEGORIES];

  $: isSearching = query.trim().length > 0;
  $: if (open && !isSearching && active !== 'recents') void loadCategory(active);

  function close() {
    open = false;
    dispatch('close');
  }

  function onKeydown(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    close();
  }

  async function ensureIndexLoaded() {
    if (allEmojis) return;
    if (indexLoading) return;
    indexLoading = true;
    try {
      allEmojis = await buildSearchIndex();
    } finally {
      indexLoading = false;
    }
  }

  async function loadCategory(id) {
    const cid = String(id ?? '').trim();
    if (!cid || cid === 'recents') return;
    const cached = categoryCache[cid];
    if (cached) {
      categoryItems = cached;
      categoryLoading = false;
      return;
    }

    categoryLoading = true;
    try {
      const items = await fetchCategory(cid);
      categoryCache[cid] = items;
      categoryItems = items;
    } finally {
      categoryLoading = false;
    }
  }

  function resetForOpen() {
    query = '';
    results = [];

    const rec = get(recentEmojis) ?? [];
    active = rec.length > 0 ? 'recents' : 'smileys-and-people';
    if (active !== 'recents') void loadCategory(active);
  }

  afterUpdate(() => {
    const openChanged = open !== prevOpen;
    prevOpen = open;
    if (open && openChanged) resetForOpen();
  });

  function onDebounced(ev) {
    query = String(ev?.detail?.query ?? '');
    if (!query.trim()) {
      results = [];
      return;
    }
    void ensureIndexLoaded().then(() => {
      results = searchEmojis(query, allEmojis ?? []);
    });
  }

  function onPick(ev) {
    const char = String(ev?.detail?.char ?? '');
    if (!char) return;
    dispatch('pick', { char });
  }

  onMount(() => {
    if (!open) return;
    resetForOpen();
  });
</script>

{#if open}
  <div class="host" role="presentation" aria-label="Emoji picker host">
    <div class="panel" role="dialog" tabindex="-1" aria-label="Emoji picker" on:keydown={onKeydown} on:pointerdown|stopPropagation>
      <div class="head">
        <div class="title">Emoji</div>
        <button
          type="button"
          class="close"
          aria-label="Close emoji picker"
          title="Close"
          on:click={close}
          on:pointerdown|stopPropagation
        >
          ×
        </button>
      </div>

      <EmojiPickerSearch
        bind:value={query}
        disabled={false}
        loadingIndex={indexLoading}
        resultsCount={results.length}
        on:debounced={onDebounced}
      />

      {#if isSearching}
        <div class="grid-wrap" aria-label="Search results">
          <EmojiGrid emojis={results} loading={indexLoading} emptyText="No emojis found." on:pick={onPick} />
        </div>
      {:else}
        <EmojiCategoryBar bind:active={active} categories={tabs} />
        <div class="grid-wrap" aria-label="Category results">
          {#if active === 'recents'}
            <EmojiGrid
              emojis={$recentEmojis ?? []}
              loading={false}
              emptyText="Your recently used emojis will appear here."
              on:pick={onPick}
            />
          {:else}
            <EmojiGrid emojis={categoryItems} loading={categoryLoading} emptyText="No emojis found." on:pick={onPick} />
          {/if}
        </div>
      {/if}
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

  .title {
    font-weight: 900;
    color: var(--text-primary);
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

  .grid-wrap {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    padding-right: 2px;
  }

  @media (hover: hover) {
    .close:hover {
      background: var(--bg-overlay);
      color: var(--text-primary);
    }
  }
</style>
