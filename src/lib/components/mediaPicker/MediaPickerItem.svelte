<script>
  import { createEventDispatcher } from 'svelte';

  /** @type {import('$lib/services/klipy/types.js').KlipyItem} */
  export let item;
  export let disabled = false;
  export let selected = false;

  const dispatch = createEventDispatcher();

  let broken = false;
  let pulse = false;

  function pick() {
    if (disabled) return;
    pulse = true;
    dispatch('pick', { item });
    window.setTimeout(() => {
      pulse = false;
    }, 180);
  }
</script>

<button
  type="button"
  class={`cell ${selected ? 'sel' : ''} ${pulse ? 'pulse' : ''}`}
  on:click={pick}
  disabled={disabled}
  aria-label={item?.type === 'sticker' ? 'Pick sticker' : 'Pick GIF'}
  title={item?.type === 'sticker' ? 'Sticker' : 'GIF'}
>
  {#if broken}
    <div class="ph" aria-label="Media failed to load">
      <svg viewBox="0 0 24 24" class="ico" fill="currentColor" aria-hidden="true">
        <path
          d="M21 5v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Zm-2 0H5v14h14V5Zm-2 11-2.5-3-2 2.5L10 12l-3 4h10Z"
        />
      </svg>
      <div class="txt">{item?.type}</div>
    </div>
  {:else}
    <img class="img" src={item.previewUrl} alt={item?.type} loading="lazy" on:error={() => (broken = true)} />
  {/if}
</button>

<style>
  .cell {
    width: 100%;
    padding: 0;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    overflow: hidden;
    display: block;
    position: relative;
  }

  .cell:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .cell.sel {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .cell.pulse {
    transform: scale(0.98);
  }

  .img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .ph {
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--text-muted);
    padding: 10px;
    gap: 6px;
  }

  .ico {
    height: 22px;
    width: 22px;
  }

  .txt {
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
  }
</style>

