<script>
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';

  export let until = 0;

  const dispatch = createEventDispatcher();

  let now = Date.now();
  let timer = 0;
  let doneSent = false;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatRemaining(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  }

  $: remainingMs = Math.max(0, Number(until) - now);
  $: remainingText = formatRemaining(remainingMs);

  onMount(() => {
    timer = setInterval(() => {
      now = Date.now();
      if (!doneSent && Number(until) <= now) {
        doneSent = true;
        dispatch('done');
      }
    }, 1000);
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
  });
</script>

<div class="cooldown" role="status" aria-live="polite">
  <div class="panel">
    <div class="title">Account deleted.</div>
    <div class="subtitle">You can create a new account in:</div>
    <div class="timer" aria-label="Time until you can create a new account">{remainingText}</div>
  </div>
</div>

<style>
  .cooldown {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: grid;
    place-items: center;
    background: var(--bg-base);
    color: var(--text-primary);
    padding: var(--space-lg);
  }

  .panel {
    width: 100%;
    max-width: 520px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-surface) 92%, black);
    box-shadow: var(--shadow-lg);
    padding: var(--space-xl) var(--space-lg);
    text-align: center;
  }

  .title {
    font-size: 22px;
    font-weight: 900;
    letter-spacing: -0.02em;
  }

  .subtitle {
    margin-top: var(--space-sm);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .timer {
    margin-top: var(--space-lg);
    font-size: 40px;
    font-family: var(--font-mono);
    font-weight: 900;
    letter-spacing: 0.06em;
    color: var(--text-primary);
  }
</style>
