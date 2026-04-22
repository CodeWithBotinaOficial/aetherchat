<script>
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { fade, fly } from 'svelte/transition';
  import { closeWall } from '$lib/stores/wall/actions.js';
  import { currentWall, isWallOpen } from '$lib/stores/wall/state.js';
  import WallHeader from './WallHeader.svelte';
  import WallComments from './WallComments.svelte';

  /** @type {MediaQueryList|null} */
  let mq = null;
  let isMobile = false;

  function updateMq() {
    isMobile = Boolean(mq?.matches);
  }

  function onKeydown(e) {
    if (!get(isWallOpen)) return;
    if (e.key !== 'Escape') return;
    e.preventDefault();
    closeWall();
  }

  onMount(() => {
    mq = window.matchMedia?.('(max-width: 639px)') ?? null;
    updateMq();
    mq?.addEventListener?.('change', updateMq);
  });

  onDestroy(() => {
    mq?.removeEventListener?.('change', updateMq);
  });
</script>

<svelte:window on:keydown|capture={onKeydown} />

{#if $isWallOpen && $currentWall}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div
    class={`backdrop ${isMobile ? 'mobile' : 'desktop'}`}
    transition:fade={{ duration: 140 }}
    on:click={(e) => {
      if (e.target === e.currentTarget) closeWall();
    }}
  >
    <div
      class={`panel ${isMobile ? 'panel-mobile' : 'panel-desktop'}`}
      transition:fly={{ y: isMobile ? 520 : 18, duration: 180 }}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      on:click|stopPropagation
    >
      <header class="topbar">
        <button
          type="button"
          class="btn-close"
          on:click={closeWall}
          aria-label={isMobile ? 'Back' : 'Close'}
          title="Close"
        >
          {isMobile ? '← Back' : '×'}
        </button>
        <div class="title">Wall</div>
      </header>

      <div class="content scroll-container">
        <div class="stack">
          <WallHeader wall={$currentWall} />
          <WallComments wall={$currentWall} />
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: var(--bg-dim);
    display: grid;
    place-items: center;
    padding: var(--space-lg);
  }

  .mobile {
    padding: 0;
  }

  .panel {
    width: 100%;
    border: 1px solid var(--border);
    background: var(--bg-base);
    color: var(--text-primary);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .panel-desktop {
    max-width: 600px;
    border-radius: var(--radius-lg);
    max-height: min(82dvh, 820px);
  }

  .panel-mobile {
    position: fixed;
    inset: 0;
    border-radius: 0;
  }

  .topbar {
    display: grid;
    grid-template-columns: 44px 1fr 44px;
    align-items: center;
    gap: 10px;
    padding: 12px 12px;
    background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
    border-bottom: 1px solid var(--border);
  }

  .title {
    text-align: center;
    font-weight: 900;
    letter-spacing: -0.01em;
  }

  .btn-close {
    height: 36px;
    min-width: 36px;
    padding: 0 10px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-weight: 900;
    font-family: var(--font-sans);
  }

  .content {
    flex: 1;
    min-height: 0;
    padding: var(--space-md);
  }

  .stack {
    display: grid;
    gap: var(--space-md);
  }

  @media (hover: hover) {
    .btn-close:hover {
      background: var(--bg-overlay);
    }
  }
</style>

