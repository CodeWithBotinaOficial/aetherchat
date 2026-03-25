<script>
  import { toasts, dismissToast } from '$lib/stores/toastStore.js';
</script>

<div class="toast-host" aria-live="polite" aria-relevant="additions">
  {#each $toasts as t (t.id)}
    <div class="toast" role="status">
      <div class="toast-msg">{t.message}</div>
      <button
        type="button"
        class="toast-x"
        aria-label="Dismiss"
        title="Dismiss"
        on:click={() => dismissToast(t.id)}
      >
        ×
      </button>
    </div>
  {/each}
</div>

<style>
  .toast-host {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: 12px;
    z-index: 80;
    display: grid;
    gap: 8px;
    pointer-events: none;
  }

  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-overlay) 92%, black);
    color: var(--text-primary);
    padding: 10px 12px;
    box-shadow: var(--shadow-md);
  }

  .toast-msg {
    min-width: 0;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
  }

  .toast-x {
    flex: none;
    height: 28px;
    width: 28px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-secondary);
    padding: 0;
  }

  @media (max-width: 639px) {
    .toast-host {
      bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 10px);
    }
  }

  @media (hover: hover) {
    .toast-x:hover {
      background: var(--bg-elevated);
      color: var(--text-primary);
    }
  }
</style>

