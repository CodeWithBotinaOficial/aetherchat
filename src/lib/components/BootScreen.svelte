<script>
  /**
   * @type {'connecting'|'syncing'|'standalone'|'reconnecting'}
   */
  export let state = 'connecting';

  /** @type {'network'|'registry'} */
  export let variant = 'network';

  /** @type {number} */
  export let receivedCount = 0;

  $: title =
    variant === 'registry'
      ? 'Checking username registry...'
      : state === 'syncing'
        ? 'Syncing messages...'
        : state === 'reconnecting'
          ? 'Reconnecting...'
          : state === 'standalone'
            ? 'Running in offline mode.'
            : 'Connecting to the network...';

  $: subtitle =
    variant === 'registry'
      ? 'Making sure your username will be unique across the network.'
      : 'Peer-to-peer. No servers. No tracking.';
</script>

<div
  class="min-h-screen flex items-center justify-center bg-[var(--bg-base)] text-[var(--text-primary)] px-[var(--space-lg)]"
  style="font-family: var(--font-sans);"
>
  <div class="w-full max-w-[560px] text-center">
    <div class="text-[28px] font-800 tracking-tight">AetherChat</div>
    <div class="mt-[var(--space-sm)] text-[var(--text-secondary)]">{title}</div>

    {#if variant !== 'registry' && state === 'syncing'}
      <div class="mt-[var(--space-xs)] text-[var(--text-muted)] text-[var(--font-size-sm)]">
        Received {receivedCount} message{receivedCount === 1 ? '' : 's'}.
      </div>
    {:else if state === 'standalone'}
      <div class="mt-[var(--space-xs)] text-[var(--text-muted)] text-[var(--font-size-sm)]">
        Messages will sync when peers connect.
      </div>
    {/if}

    <div class="mt-[var(--space-lg)] flex items-center justify-center gap-[10px]" aria-hidden="true">
      <span class="dot" style="animation-delay: 0ms"></span>
      <span class="dot" style="animation-delay: 150ms"></span>
      <span class="dot" style="animation-delay: 300ms"></span>
    </div>

    <div class="mt-[var(--space-xl)] text-[var(--text-secondary)] text-[var(--font-size-sm)]">{subtitle}</div>
  </div>
</div>

<style>
  .dot {
    width: 10px;
    height: 10px;
    border-radius: var(--radius-full);
    background: var(--accent);
    opacity: 0.3;
    animation: dotPulse 900ms infinite ease-in-out;
  }

  @keyframes dotPulse {
    0%,
    80%,
    100% {
      transform: translateY(0);
      opacity: 0.3;
    }
    40% {
      transform: translateY(-4px);
      opacity: 1;
    }
  }
</style>
