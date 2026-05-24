<script>
  import { createEventDispatcher } from 'svelte';
  import EmojiGridItem from './EmojiGridItem.svelte';

  /** @type {import('$lib/services/emojiHub/types.js').EmojiItem[] | string[]} */
  export let emojis = [];
  export let loading = false;
  export let emptyText = 'No emojis found.';

  const dispatch = createEventDispatcher();

  function toChar(it) {
    if (typeof it === 'string') return it;
    return String(it?.char ?? '');
  }

  function toTitle(it) {
    if (typeof it === 'string') return 'Emoji';
    return String(it?.name ?? 'Emoji');
  }
</script>

{#if loading}
  <div class="grid" aria-label="Loading emojis">
    {#each Array.from({ length: 5 * 10 }) as _, i (i)}
      <div class="sk"></div>
    {/each}
  </div>
{:else if !emojis || emojis.length === 0}
  <div class="empty" aria-label="Empty">
    {emptyText}
  </div>
{:else}
  <div class="grid" aria-label="Emoji results">
    {#each emojis as it, i (typeof it === 'string' ? `${it}-${i}` : `${it?.name ?? 'emoji'}-${i}`)}
      <EmojiGridItem
        char={toChar(it)}
        title={toTitle(it)}
        on:pick={(ev) => dispatch('pick', ev.detail)}
      />
    {/each}
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
    gap: 6px;
  }

  .sk {
    height: 40px;
    width: 40px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-elevated) 70%, var(--bg-surface));
    position: relative;
    overflow: hidden;
  }

  .sk::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in srgb, var(--bg-overlay) 60%, transparent),
      transparent
    );
    transform: translateX(-60%);
    animation: sh 1.1s ease-in-out infinite;
  }

  @keyframes sh {
    to {
      transform: translateX(60%);
    }
  }

  .empty {
    padding: 16px 12px;
    text-align: center;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }
</style>

