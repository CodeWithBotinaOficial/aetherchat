<script>
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { fade, fly } from 'svelte/transition';
  import { isProfileOpen, closeProfile } from '$lib/stores/profileStore.js';
  import { user } from '$lib/stores/userStore.js';
  import ProfileAvatar from '$lib/components/profile/ProfileAvatar.svelte';
  import ProfileFields from '$lib/components/profile/ProfileFields.svelte';
  import ProfileDangerZone from '$lib/components/profile/ProfileDangerZone.svelte';

  /** @type {MediaQueryList|null} */
  let mq = null;
  let isMobile = false;

  function updateMq() {
    isMobile = Boolean(mq?.matches);
  }

  function onKeydown(e) {
    if (!get(isProfileOpen)) return;
    if (e.key !== 'Escape') return;
    e.preventDefault();
    closeProfile();
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

{#if $isProfileOpen}
  <div class="backdrop" transition:fade={{ duration: 140 }}>
    <button type="button" class="hit" aria-label="Close profile" on:click={(e) => { if (e.target === e.currentTarget) closeProfile(); }}></button>
    <div
      class={`panel ${isMobile ? 'mobile' : 'desktop'}`}
      transition:fly={{ y: isMobile ? 520 : 18, duration: 180 }}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <header class="header">
        <button type="button" class="btn-close" on:click={closeProfile} aria-label={isMobile ? 'Back' : 'Close'} title="Close">
          {isMobile ? '← Back' : '×'}
        </button>
        <div class="headings">
          <div class="title">Profile</div>
          <div class="subtitle">Manage your local identity</div>
        </div>
      </header>

      <div class="content scroll-container">
        {#if $user}
          <div class="stack">
            <ProfileAvatar user={$user} />
            <ProfileFields user={$user} />
            <ProfileDangerZone user={$user} />
          </div>
        {:else}
          <div class="empty">
            <div class="empty-title">No profile loaded.</div>
            <div class="empty-sub">Close this panel and register to create an identity.</div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    background: var(--bg-dim);
    display: grid;
    place-items: center;
    padding: var(--space-lg);
  }

  .hit {
    position: fixed;
    inset: 0;
    border: 0;
    background: transparent;
    padding: 0;
    cursor: default;
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

  .desktop {
    max-width: 520px;
    border-radius: var(--radius-lg);
    max-height: min(82dvh, 820px);
  }

  .mobile {
    position: fixed;
    inset: 0;
    border-radius: 0;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 14px;
    background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
    border-bottom: 1px solid var(--border);
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

  .headings {
    min-width: 0;
  }

  .title {
    font-weight: 900;
    letter-spacing: -0.02em;
  }

  .subtitle {
    margin-top: 2px;
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
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

  .empty {
    height: 100%;
    display: grid;
    place-items: center;
    text-align: center;
    padding: var(--space-xl) var(--space-lg);
  }

  .empty-title {
    font-weight: 900;
  }

  .empty-sub {
    margin-top: 6px;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  @media (hover: hover) {
    .btn-close:hover {
      background: var(--bg-overlay);
    }
  }
</style>
