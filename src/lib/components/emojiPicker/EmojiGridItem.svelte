<script>
  import { createEventDispatcher } from 'svelte';

  export let char = '';
  export let title = '';
  export let disabled = false;

  const dispatch = createEventDispatcher();

  function pick(e) {
    e?.preventDefault?.();
    if (disabled) return;
    dispatch('pick', { char });
  }
</script>

<button
  type="button"
  class="btn"
  on:click={pick}
  aria-label={title || 'Pick emoji'}
  {title}
  disabled={disabled}
>
  <span class="ch" aria-hidden="true">{char}</span>
</button>

<style>
  .btn {
    height: 40px;
    width: 40px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    background: transparent;
    padding: 0;
    color: var(--text-primary);
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .ch {
    font-size: 24px;
    line-height: 1;
  }

  @media (hover: hover) {
    .btn:hover:not(:disabled) {
      background: var(--bg-elevated);
      border-color: var(--border);
    }
  }
</style>

