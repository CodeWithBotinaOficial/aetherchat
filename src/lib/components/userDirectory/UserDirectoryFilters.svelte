<script>
  import { onDestroy, onMount } from 'svelte';
  import { userDirectoryStore } from '$lib/stores/userDirectory/state.js';
  import { refreshUsers, resetFilters, setSortMode } from '$lib/stores/userDirectory/filters.js';

  const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ];

  /** @type {MediaQueryList|null} */
  let mq = null;
  let isMobile = false;
  let open = false;

  let minAge = '';
  let maxAge = '';
  let ageError = '';

  function updateMq() {
    isMobile = Boolean(mq?.matches);
    if (!isMobile) open = true;
    if (isMobile) open = false;
  }

  function validateAndApplyAgeRange() {
    ageError = '';
    const min = minAge.trim() ? Number(minAge) : null;
    const max = maxAge.trim() ? Number(maxAge) : null;

    if (min === null && max === null) {
      setSortMode({ ageRange: null });
      return;
    }
    if (min === null || max === null) {
      // Only apply when both filled.
      return;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      ageError = 'Please enter valid ages.';
      return;
    }
    if (min < 17 || max < 17) {
      ageError = 'Minimum age is 17.';
      return;
    }
    if (max < min) {
      ageError = 'Max age must be greater than or equal to Min age.';
      return;
    }
    setSortMode({ ageRange: { min, max } });
  }

  function clearAgeRange() {
    minAge = '';
    maxAge = '';
    ageError = '';
    setSortMode({ ageRange: null });
  }

  onMount(() => {
    mq = window.matchMedia?.('(max-width: 639px)') ?? null;
    updateMq();
    mq?.addEventListener?.('change', updateMq);
  });

  onDestroy(() => {
    mq?.removeEventListener?.('change', updateMq);
  });

  $: isSearching = $userDirectoryStore.isSearching;
  $: isLoading = $userDirectoryStore.isLoading;
  $: sortMode = $userDirectoryStore.sortMode;

  // Keep local inputs aligned if the store already has an age range (store persists across navigation).
  $: if (!isSearching && sortMode?.ageRange && typeof sortMode.ageRange.min === 'number' && typeof sortMode.ageRange.max === 'number') {
    const nextMin = String(sortMode.ageRange.min);
    const nextMax = String(sortMode.ageRange.max);
    if ((minAge.trim() === '' && maxAge.trim() === '') || (minAge !== nextMin || maxAge !== nextMax)) {
      minAge = nextMin;
      maxAge = nextMax;
      ageError = '';
    }
  }
</script>

<div class="filters" aria-label="User directory filters">
  {#if isMobile}
    <button
      type="button"
      class={`toggle ${open ? 'open' : ''}`}
      on:click={() => (open = !open)}
      aria-label="Toggle filters"
    >
      Filters
      <span class="chev" aria-hidden="true">{open ? '▲' : '▼'}</span>
    </button>
  {/if}

  {#if open}
    <div class={`panel ${isSearching ? 'disabled' : ''}`}>
      {#if isSearching}
        <div class="paused" aria-label="Filters paused during search">Filters are paused during search.</div>
      {/if}

      <div class="row">
        <div class="group" aria-label="Sort by">
          <div class="label">Sort by</div>
          <div class="seg" role="group" aria-label="Sort mode">
            <button
              type="button"
              class={`seg-btn ${sortMode.field === 'username' ? 'active' : ''}`}
              on:click={() => setSortMode({ field: 'username', direction: 'asc' })}
              disabled={isSearching}
              aria-label="Alphabetical"
            >
              A–Z
            </button>
            <button
              type="button"
              class={`seg-btn ${sortMode.field === 'registeredAt' && sortMode.direction === 'desc' ? 'active' : ''}`}
              on:click={() => setSortMode({ field: 'registeredAt', direction: 'desc' })}
              disabled={isSearching}
              aria-label="Newest first"
            >
              Newest
            </button>
            <button
              type="button"
              class={`seg-btn ${sortMode.field === 'registeredAt' && sortMode.direction === 'asc' ? 'active' : ''}`}
              on:click={() => setSortMode({ field: 'registeredAt', direction: 'asc' })}
              disabled={isSearching}
              aria-label="Oldest first"
            >
              Oldest
            </button>
            <button
              type="button"
              class={`seg-btn ${sortMode.field === 'age' && sortMode.direction === 'asc' ? 'active' : ''}`}
              on:click={() => setSortMode({ field: 'age', direction: 'asc' })}
              disabled={isSearching}
              aria-label="Age ascending"
            >
              Age ↑
            </button>
            <button
              type="button"
              class={`seg-btn ${sortMode.field === 'age' && sortMode.direction === 'desc' ? 'active' : ''}`}
              on:click={() => setSortMode({ field: 'age', direction: 'desc' })}
              disabled={isSearching}
              aria-label="Age descending"
            >
              Age ↓
            </button>
          </div>
        </div>

        <div class="group" aria-label="Birth month filter">
          <div class="label">Birth month</div>
          <select
            class="select"
            disabled={isSearching}
            value={sortMode.birthMonth ?? ''}
            on:change={(e) => {
              const v = e.currentTarget.value;
              if (!v) setSortMode({ birthMonth: null });
              else setSortMode({ birthMonth: Number(v) });
            }}
            aria-label="Birth month"
          >
            <option value="">All months</option>
            {#each MONTHS as m, idx (m)}
              <option value={idx + 1}>{m}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="row">
        <div class="group" aria-label="Age range filter">
          <div class="label">Age range</div>
          <div class="age-row">
            <input
              class="num"
              type="number"
              min="17"
              placeholder="Min age"
              value={minAge}
              disabled={isSearching}
              on:input={(e) => {
                minAge = e.currentTarget.value;
                validateAndApplyAgeRange();
              }}
              aria-label="Min age"
            />
            <input
              class="num"
              type="number"
              min="17"
              placeholder="Max age"
              value={maxAge}
              disabled={isSearching}
              on:input={(e) => {
                maxAge = e.currentTarget.value;
                validateAndApplyAgeRange();
              }}
              aria-label="Max age"
            />
            <button type="button" class="btn btn-secondary" disabled={isSearching} on:click={clearAgeRange} aria-label="Clear age range">
              Clear
            </button>
          </div>
          {#if ageError}
            <div class="error" aria-label="Age range error">{ageError}</div>
          {/if}
        </div>

        <div class="group actions" aria-label="Filter actions">
          <div class="label">Actions</div>
          <div class="action-row">
            <button type="button" class="btn" on:click={resetFilters} aria-label="Reset to default" disabled={isLoading}>
              Reset to default
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              on:click={() => refreshUsers().catch((err) => console.error('refreshUsers failed', err))}
              aria-label="Refresh"
              disabled={isLoading}
            >
              {isLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .filters {
    display: grid;
    gap: 10px;
  }

  .toggle {
    height: 44px;
    width: 100%;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-weight: 900;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
  }

  .panel {
    border: 1px solid var(--border);
    background: var(--bg-surface);
    border-radius: var(--radius-md);
    padding: 12px;
    display: grid;
    gap: 12px;
  }

  .disabled {
    opacity: 0.6;
  }

  .paused {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
  }

  .row {
    display: grid;
    gap: 12px;
    grid-template-columns: 1fr;
  }

  @media (min-width: 900px) {
    .row {
      grid-template-columns: 2fr 1fr;
      align-items: start;
    }
    .row:last-child {
      grid-template-columns: 2fr 1fr;
    }
  }

  .group {
    min-width: 0;
    display: grid;
    gap: 8px;
  }

  .label {
    font-size: 12px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .seg {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .seg-btn {
    height: 34px;
    padding: 0 10px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-weight: 900;
    font-size: 12px;
  }

  .seg-btn.active {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    background: color-mix(in srgb, var(--accent) 18%, var(--bg-elevated));
  }

  .seg-btn:disabled,
  .select:disabled,
  .num:disabled,
  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .select {
    height: 34px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-weight: 700;
    padding: 0 10px;
    outline: none;
  }

  .age-row {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 8px;
    align-items: center;
  }

  .num {
    height: 34px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-primary);
    padding: 0 10px;
    font-weight: 700;
    outline: none;
  }

  .error {
    font-size: 12px;
    color: color-mix(in srgb, var(--danger) 80%, var(--text-primary));
  }

  .action-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .btn {
    height: 34px;
    padding: 0 10px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--accent);
    color: var(--text-primary);
    font-weight: 900;
    font-size: 12px;
  }

  .btn-secondary {
    background: var(--bg-elevated);
  }

  @media (hover: hover) {
    .seg-btn:hover:not(:disabled),
    .btn-secondary:hover:not(:disabled),
    .select:hover:not(:disabled),
    .num:hover:not(:disabled) {
      background: var(--bg-overlay);
    }
    .btn:hover:not(:disabled) {
      background: var(--accent-hover);
    }
  }
</style>
