<script>
  import { createEventDispatcher } from 'svelte';

  /** @type {'global'|'private'|'terms'} */
  export let active = 'global';
  export let privateUnread = 0;

  const dispatch = createEventDispatcher();

  function select(key) {
    dispatch('select', { key });
  }

  function isActive(key) {
    return active === key;
  }
</script>

<nav class="bottom-nav-bar bottom-nav" aria-label="Bottom navigation">
  <button
    class={`nav-btn ${isActive('global') ? 'active' : ''}`}
    on:click={() => select('global')}
    aria-label="Global Chat"
    aria-current={isActive('global') ? 'page' : undefined}
  >
    <div class="icon">💬</div>
    <div class="dot" aria-hidden="true"></div>
  </button>

  <button
    class={`nav-btn ${isActive('private') ? 'active' : ''}`}
    on:click={() => select('private')}
    aria-label="Private Chats"
    aria-current={isActive('private') ? 'page' : undefined}
  >
    <div class="icon-wrap">
      <div class="icon">🔒</div>
      {#if privateUnread > 0}
        <div class="badge" aria-label="Unread private messages">{privateUnread > 99 ? '99+' : privateUnread}</div>
      {/if}
    </div>
    <div class="dot" aria-hidden="true"></div>
  </button>

  <button
    class={`nav-btn ${isActive('terms') ? 'active' : ''}`}
    on:click={() => select('terms')}
    aria-label="Terms & Conditions"
    aria-current={isActive('terms') ? 'page' : undefined}
  >
    <div class="icon">📄</div>
    <div class="dot" aria-hidden="true"></div>
  </button>
</nav>

<style>
  .bottom-nav-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    min-height: calc(56px + env(safe-area-inset-bottom, 0px));
    z-index: 50;
    border-top: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
    backdrop-filter: blur(10px);
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    align-items: stretch;
  }

  .nav-btn {
    border: 0;
    background: transparent;
    color: var(--text-muted);
    display: grid;
    place-items: center;
    gap: 2px;
    min-height: 56px;
    padding: 6px 0;
  }

  .nav-btn.active {
    color: var(--accent);
  }

  .icon {
    font-size: 20px;
    line-height: 1;
  }

  .icon-wrap {
    position: relative;
    display: grid;
    place-items: center;
  }

  .badge {
    position: absolute;
    top: -6px;
    right: -16px;
    min-width: 18px;
    height: 18px;
    padding: 0 6px;
    border-radius: 9999px;
    border: 1px solid var(--border);
    background: var(--accent);
    color: var(--text-primary);
    font-size: 11px;
    font-weight: 800;
    font-family: var(--font-mono);
    display: grid;
    place-items: center;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 9999px;
    background: transparent;
  }

  .nav-btn.active .dot {
    background: var(--accent);
  }
</style>
