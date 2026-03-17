<script>
  import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
  import { scale } from 'svelte/transition';

  export let title = 'Confirm';
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

  function confirm() {
    if (destroyed) return;
    dispatch('confirm');
  }

  function cancel() {
    if (destroyed) return;
    dispatch('cancel');
  }

  function onKeydown(e) {
    if (destroyed) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      confirm();
      return;
    }
    if (e.key !== 'Tab') return;

    // Focus trap: only cancel + confirm are focusable.
    const focusables = [cancelBtn, confirmBtn].filter(Boolean);
    if (focusables.length < 2) return;

    const active = document.activeElement;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
      return;
    }
    if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  onMount(async () => {
    await tick();
    if (destroyed) return;
    cancelBtn?.focus?.();
  });

  onDestroy(() => {
    destroyed = true;
  });
</script>

<svelte:window on:keydown|capture={onKeydown} />

<div class="fixed inset-0 z-80 grid place-items-center bg-[color-mix(in_srgb,var(--bg-overlay)_75%,transparent)] backdrop-blur">
  <button
    type="button"
    class="absolute inset-0 cursor-default"
    aria-label="Close dialog"
    on:click={cancel}
  ></button>
  <div
    class="w-[min(92vw,400px)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)] p-[var(--space-lg)]"
    transition:scale={{ duration: 150, start: 0.95 }}
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
  >
    <div class="text-[var(--text-primary)] font-800">{title}</div>
    {#if message}
      <div class="mt-[var(--space-sm)] text-[var(--text-secondary)] text-[var(--font-size-sm)] leading-relaxed">
        {message}
      </div>
    {/if}

    <div class="mt-[var(--space-lg)] flex justify-end gap-[var(--space-sm)]">
      <button
        bind:this={cancelBtn}
        class="rounded-[var(--radius-md)] border border-[var(--border)] bg-transparent px-[var(--space-md)] py-[var(--space-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        on:click={cancel}
      >
        {cancelLabel}
      </button>
      <button
        bind:this={confirmBtn}
        class={[
          'rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-md)] py-[var(--space-sm)] font-700',
          dangerous
            ? 'bg-[var(--danger)] text-[var(--bg-base)] hover:opacity-90'
            : 'bg-[var(--accent)] text-[var(--text-primary)] hover:bg-[var(--accent-hover)]'
        ].join(' ')}
        on:click={confirm}
      >
        {confirmLabel}
      </button>
    </div>
  </div>
</div>
