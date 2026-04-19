<script>
  import { createEventDispatcher } from 'svelte';
  import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';

  export let username = '';
  export let avatarBase64 = null;
  export let connectedPeers = 0;
  /** @type {'connected'|'connecting'|'offline'} */
  export let status = 'offline';

  const dispatch = createEventDispatcher();

  $: statusText =
    status === 'connected'
      ? `Connected · ${connectedPeers} peer${connectedPeers === 1 ? '' : 's'}`
      : status === 'connecting'
        ? 'Joining the network...'
        : 'Running offline';
</script>

<header class="top-bar-bar" aria-label="App top bar">
  <div class="top-bar-inner">
    <div class="left">
      <div class="wordmark">AetherChat</div>
    </div>

    <div class="right">
      <div class="status" aria-label="Connection status">{statusText}</div>
      <button type="button" class="me" on:click={() => dispatch('openProfile')} aria-label="Open profile" title="Profile">
        <div class="name">{username || '...'}</div>
        <AvatarDisplay username={username || ''} avatarBase64={avatarBase64} size={28} showRing={true} />
      </button>
    </div>
  </div>
</header>

<style>
  .top-bar-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    box-sizing: border-box;
    height: calc(48px + env(safe-area-inset-top, 0px));
    padding-top: env(safe-area-inset-top, 0px);
    z-index: 50;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
    backdrop-filter: blur(10px);
  }

  .top-bar-inner {
    height: 48px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .wordmark {
    font-weight: 900;
    letter-spacing: -0.02em;
    color: var(--text-primary);
  }

  .right {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .status {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    white-space: nowrap;
  }

  .me {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    border: 0;
    background: transparent;
    padding: 0;
    color: inherit;
  }

  .name {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary);
  }
</style>
