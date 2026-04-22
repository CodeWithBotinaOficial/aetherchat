<script>
  import { onDestroy, onMount } from 'svelte';
  import { user } from '$lib/stores/userStore.js';
  import { activeTab } from '$lib/stores/navigationStore.js';
  import { peer } from '$lib/stores/peerStore.js';
  import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';
  import GlobalChat from '$lib/components/GlobalChat.svelte';
  import PrivateChatPanel from '$lib/components/PrivateChatPanel.svelte';
  import P2PDebugPanel from '$lib/components/P2PDebugPanel.svelte';
  import TermsAndConditions from '$lib/components/TermsAndConditions.svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import ToastHost from '$lib/components/ToastHost.svelte';
  import ProfileScreen from '$lib/components/profile/ProfileScreen.svelte';
  import WallScreen from '$lib/components/wall/WallScreen.svelte';
  import { totalUnread, setChatOnlineStatus } from '$lib/stores/privateChatStore.js';
  import { flushQueueForPeer, onMessage } from '$lib/services/peer.js';
  import { openMyWall } from '$lib/stores/wall/actions.js';

  const tabs = [
    { key: 'global', label: 'Global Chat', icon: 'globe' },
    { key: 'private', label: 'Private Chats', icon: 'lock' },
    { key: 'terms', label: 'Terms & Conditions', icon: 'doc' }
  ];

  function iconPath(name) {
    if (name === 'globe') return 'M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20Zm7.9 9H16.8a15 15 0 0 0-1.3-5.2A8 8 0 0 1 19.9 11ZM12 4c.9 1.2 1.9 3.6 2.3 7H9.7C10.1 7.6 11.1 5.2 12 4Zm-3.5 1.8A15 15 0 0 0 7.2 11H4.1a8 8 0 0 1 4.4-5.2ZM4.1 13h3.1c.2 2 .7 3.8 1.3 5.2A8 8 0 0 1 4.1 13Zm5.6 0h4.6c-.4 3.4-1.4 5.8-2.3 7c-.9-1.2-1.9-3.6-2.3-7Zm6.8 5.2c.6-1.4 1.1-3.2 1.3-5.2h3.1a8 8 0 0 1-4.4 5.2Z';
    if (name === 'lock') return 'M17 8h-1V6a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2Zm-7-2a2 2 0 0 1 4 0v2h-4V6Z';
    return 'M7 2h7l5 5v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V8h4.5';
  }

  /** @type {MediaQueryList | null} */
  let mobileMq = null;
  let isMobile = false;

  function setMobileFromMq() {
    isMobile = Boolean(mobileMq?.matches);
  }

  let stopNetworkHooks = () => {};

  onMount(() => {
    mobileMq = window.matchMedia?.('(max-width: 639px)') ?? null;
    setMobileFromMq();
    mobileMq?.addEventListener?.('change', setMobileFromMq);

    const unsub = [
      onMessage('HANDSHAKE', (msg) => {
        setChatOnlineStatus(msg.from.peerId, true);
        flushQueueForPeer(msg.from.peerId);
      }),
      onMessage('HANDSHAKE_ACK', (msg) => {
        setChatOnlineStatus(msg.from.peerId, true);
        flushQueueForPeer(msg.from.peerId);
      }),
      onMessage('PEER_DISCONNECT', (msg) => {
        setChatOnlineStatus(msg.from.peerId, false);
      })
    ];

    stopNetworkHooks = () => unsub.forEach((u) => u());
  });

  onDestroy(() => {
    stopNetworkHooks();
    mobileMq?.removeEventListener?.('change', setMobileFromMq);
  });

  $: connectedPeers = $peer?.connectedPeers?.size ?? 0;
  $: topBarStatus = $peer?.connectionState === 'connected'
    ? 'connected'
    : $peer?.connectionState === 'connecting' || $peer?.connectionState === 'syncing' || $peer?.connectionState === 'reconnecting'
      ? 'connecting'
      : 'offline';
</script>

<div class="shell">
  {#if isMobile}
    <TopBar
      username={$user?.username ?? ''}
      avatarBase64={$user?.avatarBase64 ?? null}
      connectedPeers={connectedPeers}
      status={topBarStatus}
      on:openWall={openMyWall}
    />
  {/if}

  <div class="frame">
    <aside class="sidebar" aria-label="Sidebar navigation">
      <div class="brand">
        <div class="brand-title">AetherChat</div>
        <div class="brand-sub">decentralized browser chat</div>
      </div>

      <div class="nav">
        {#each tabs as t (t.key)}
          <button
            class={`nav-btn ${$activeTab === t.key ? 'active' : ''}`}
            on:click={() => activeTab.set(t.key)}
            aria-label={t.label}
            aria-current={$activeTab === t.key ? 'page' : undefined}
            title={t.label}
          >
            <svg class="nav-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d={iconPath(t.icon)} />
            </svg>
            <span class="nav-label">
              {t.label}
              {#if t.key === 'private' && $totalUnread > 0}
                <span class="nav-unread" aria-label="Unread private messages">
                  {$totalUnread > 99 ? '99+' : $totalUnread}
                </span>
              {/if}
            </span>
          </button>
        {/each}
      </div>

      <div class="profile">
        <button type="button" class="profile-row" on:click={openMyWall} aria-label="Open my wall" title="My wall">
          <AvatarDisplay
            username={$user?.username ?? ''}
            avatarBase64={$user?.avatarBase64 ?? null}
            size={36}
            showRing={true}
          />
          <div class="profile-meta">
            <div class="profile-name">{$user?.username ?? '...'}</div>
            <div class="profile-status">
              {topBarStatus === 'connected' ? 'Connected' : topBarStatus === 'connecting' ? 'Joining...' : 'Offline'}
              <span class="sep">·</span>
              {connectedPeers} peer{connectedPeers === 1 ? '' : 's'}
            </div>
          </div>
        </button>
      </div>
    </aside>

    <main class="main" aria-label="Main content">
      <div class="view">
        {#if $activeTab === 'global'}
          <GlobalChat />
        {:else if $activeTab === 'private'}
          <PrivateChatPanel />
        {:else}
          <TermsAndConditions />
        {/if}
      </div>
    </main>
  </div>

  {#if isMobile}
    <BottomNav active={$activeTab} privateUnread={$totalUnread} on:select={(e) => activeTab.set(e.detail.key)} />
  {/if}
  </div>

<WallScreen />
<ProfileScreen />

{#if import.meta.env.DEV}
  <P2PDebugPanel />
{/if}

<ToastHost />

	<style>
	  .shell {
	    height: 100dvh;
	    background: var(--bg-base);
	    color: var(--text-primary);
	    display: flex;
	    flex-direction: column;
	    overflow: hidden;
	  }

	  .frame {
	    flex: 1;
	    min-height: 0;
	    display: grid;
	    grid-template-columns: 220px 1fr;
	    width: 100%;
	    margin: 0 auto;
	  }

  .sidebar {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border);
    background: var(--bg-surface);
    min-width: 0;
  }

  .brand {
    padding: 16px;
    border-bottom: 1px solid var(--border);
  }

  .brand-title {
    font-weight: 900;
    letter-spacing: -0.02em;
    color: var(--text-primary);
  }

  .brand-sub {
    margin-top: 2px;
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .nav {
    flex: 1;
    padding: 12px 8px;
    display: grid;
    gap: 4px;
  }

  .nav-btn {
    width: 100%;
    border: 0;
    background: transparent;
    color: var(--text-secondary);
    border-left: 3px solid transparent;
    border-radius: var(--radius-md);
    padding: 10px 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    text-align: left;
    min-height: 44px;
  }

  .nav-btn.active {
    background: var(--accent-subtle);
    border-left-color: var(--accent);
    color: var(--text-primary);
  }

  .nav-ico {
    width: 18px;
    height: 18px;
    flex: none;
  }

  .nav-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: var(--font-size-sm);
    min-width: 0;
  }

  .nav-unread {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--accent-subtle);
    color: var(--text-primary);
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    padding: 2px 8px;
    line-height: 1;
    flex: none;
  }

  .profile {
    border-top: 1px solid var(--border);
    padding: 14px 12px;
  }

  .profile-row {
    display: flex;
    gap: 10px;
    align-items: center;
    min-width: 0;
    width: 100%;
    border: 0;
    background: transparent;
    padding: 0;
    color: inherit;
    text-align: left;
  }

  @media (hover: hover) {
    .profile-row:hover {
      background: var(--bg-elevated);
      border-radius: var(--radius-md);
      padding: 10px;
      margin: -10px;
    }
  }

  .profile-meta {
    min-width: 0;
  }

  .profile-name {
    font-weight: 800;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .profile-status {
    margin-top: 2px;
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sep {
    opacity: 0.6;
    margin: 0 6px;
  }

  .main {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

	  .view {
	    flex: 1;
	    min-height: 0;
	    height: 100%;
	    overflow: hidden;
	    display: flex;
	    flex-direction: column;
	  }

  /* Mobile: TopBar + BottomNav, no sidebar */
  @media (max-width: 639px) {
    .frame {
      grid-template-columns: 1fr;
    }

    .sidebar {
      display: none;
    }

    .main {
      padding-top: calc(48px + env(safe-area-inset-top, 0px));
      padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px));
    }
  }

  /* Tablet: icon rail */
  @media (min-width: 640px) and (max-width: 1023px) {
    .frame {
      grid-template-columns: 56px 1fr;
    }

    .brand-sub,
    .nav-label,
    .profile-meta {
      display: none;
    }

    .nav-btn {
      justify-content: center;
      padding: 10px 0;
    }
  }

  /* TV / wide */
  @media (min-width: 1920px) {
    .frame {
      max-width: 1440px;
      grid-template-columns: 260px 1fr;
    }

    .shell {
      font-size: 18px;
    }
  }

  @media (hover: hover) {
    .nav-btn:not(.active):hover {
      background: var(--bg-elevated);
      color: var(--text-primary);
    }
  }
</style>
