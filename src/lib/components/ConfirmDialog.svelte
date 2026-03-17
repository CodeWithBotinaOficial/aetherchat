<script>
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { tick } from 'svelte';
  import { fade, scale } from 'svelte/transition';

  export let title = 'Are you sure?';
  export let message = '';
  export let confirmLabel = 'Confirm';
  export let cancelLabel = 'Cancel';
  export let dangerous = false;

  const dispatch = createEventDispatcher();

  let destroyed = false;
  /** @type {HTMLButtonElement|null} */
  let cancelBtn = null;
  /** @type {HTMLButtonElement|null} */
  let confirmBtn = null;

  onMount(async () => {
    await tick();
    if (destroyed) return;
    // Focus cancel by default to avoid accidental destructive confirmation.
    cancelBtn?.focus?.();
  });

  onDestroy(() => {
    destroyed = true;
  });

  function handleConfirm() {
    if (destroyed) return;
    dispatch('confirm');
  }

  function handleCancel() {
    if (destroyed) return;
    dispatch('cancel');
  }

  function handleKeydown(e) {
    if (destroyed) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
      return;
    }
    if (e.key !== 'Tab') return;

    // Focus trap: toggle between cancel + confirm.
    e.preventDefault();
    const active = document.activeElement;
    if (active === confirmBtn) cancelBtn?.focus?.();
    else confirmBtn?.focus?.();
  }
</script>

<svelte:window on:keydown|capture={handleKeydown} />

<div
  transition:fade={{ duration: 150 }}
  style="
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--bg-dim, rgba(0, 0, 0, 0.65));
    padding: 16px;
  "
>
  <button
    type="button"
    aria-label="Close dialog"
    on:click={handleCancel}
    style="
      position: absolute;
      inset: 0;
      border: 0;
      padding: 0;
      background: transparent;
      cursor: default;
    "
  ></button>

  <div
    transition:scale={{ duration: 150, start: 0.95 }}
    role="dialog"
    aria-modal="true"
    aria-labelledby="dialog-title"
    tabindex="-1"
    style="
      background: var(--bg-overlay, #2a2f47);
      border: 1px solid var(--border, #2e3350);
      border-radius: var(--radius-md, 12px);
      padding: 24px;
      width: 100%;
      max-width: 400px;
      box-shadow: var(--shadow-lg, 0 8px 32px rgba(0,0,0,0.6));
      display: flex;
      flex-direction: column;
      gap: 16px;
    "
  >
    <h2
      id="dialog-title"
      style="
        margin: 0;
        color: var(--text-primary, #e8eaf0);
        font-size: var(--font-size-lg, 1.125rem);
        font-weight: 600;
        font-family: var(--font-sans);
      "
    >
      {title}
    </h2>

    {#if message}
      <p
        style="
          margin: 0;
          color: var(--text-secondary, #8b90a8);
          font-size: var(--font-size-sm, 0.875rem);
          font-family: var(--font-sans);
          line-height: 1.5;
        "
      >
        {message}
      </p>
    {/if}

    <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 8px;">
      <button
        bind:this={cancelBtn}
        on:click={handleCancel}
        style="
          padding: 8px 20px;
          border-radius: var(--radius-sm, 6px);
          border: 1px solid var(--border, #2e3350);
          background: transparent;
          color: var(--text-secondary, #8b90a8);
          font-size: var(--font-size-sm, 0.875rem);
          font-family: var(--font-sans);
          cursor: pointer;
        "
      >
        {cancelLabel}
      </button>

      <button
        bind:this={confirmBtn}
        on:click={handleConfirm}
        style="
          padding: 8px 20px;
          border-radius: var(--radius-sm, 6px);
          border: none;
          background: {dangerous ? 'var(--danger, #f87171)' : 'var(--accent, #6c8ef5)'};
          color: #ffffff;
          font-size: var(--font-size-sm, 0.875rem);
          font-family: var(--font-sans);
          font-weight: 600;
          cursor: pointer;
        "
      >
        {confirmLabel}
      </button>
    </div>
  </div>
</div>
