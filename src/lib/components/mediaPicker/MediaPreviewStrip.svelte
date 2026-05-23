<script>
  import { createEventDispatcher } from 'svelte';

  /** @type {import('$lib/services/klipy/types.js').MessageMedia[]} */
  export let items = [];
  export let disabled = false;

  const dispatch = createEventDispatcher();

  function remove(id) {
    dispatch('remove', { id });
  }
</script>

{#if Array.isArray(items) && items.length > 0}
  <div class="strip" aria-label="Selected media">
    {#each items.slice(0, 2) as m (m.id)}
      <div class="thumb">
        <img class="img" src={m.previewUrl} alt={m.type} loading="lazy" />
        <button
          type="button"
          class="rm"
          on:click={() => remove(m.id)}
          aria-label="Remove media"
          title="Remove"
          disabled={disabled}
        >
          ×
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .strip {
    display: flex;
    gap: 10px;
    padding: 8px 0 2px 0;
    overflow-x: auto;
  }

  .thumb {
    position: relative;
    height: 56px;
    width: 56px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    overflow: hidden;
    flex: none;
  }

  .img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .rm {
    position: absolute;
    right: 0;
    top: 0;
    height: 44px;
    width: 44px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-surface) 80%, transparent);
    color: var(--text-secondary);
    display: grid;
    place-items: center;
    padding: 0;
    transform: translate(30%, -30%);
  }

  .rm:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  @media (hover: hover) {
    .rm:hover:not(:disabled) {
      background: var(--bg-overlay);
      color: var(--text-primary);
    }
  }
</style>

