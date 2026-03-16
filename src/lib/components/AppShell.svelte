<script>
  import { onDestroy, onMount } from 'svelte';
  import { user } from '$lib/stores/userStore.js';
  import { activeTab } from '$lib/stores/navigationStore.js';
  import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';
  import GlobalChat from '$lib/components/GlobalChat.svelte';
  import PrivateChatPanel from '$lib/components/PrivateChatPanel.svelte';
  import P2PDebugPanel from '$lib/components/P2PDebugPanel.svelte';
  import { totalUnread, setChatOnlineStatus } from '$lib/stores/privateChatStore.js';
  import { flushQueueForPeer, onMessage } from '$lib/services/peer.js';

  const tabs = [
    { key: 'global', label: 'Global Chat', icon: 'globe' },
    { key: 'private', label: 'Private Chats', icon: 'lock' },
    { key: 'terms', label: 'T&C', icon: 'doc' }
  ];

  function iconPath(name) {
    if (name === 'globe') return 'M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20Zm7.9 9H16.8a15 15 0 0 0-1.3-5.2A8 8 0 0 1 19.9 11ZM12 4c.9 1.2 1.9 3.6 2.3 7H9.7C10.1 7.6 11.1 5.2 12 4Zm-3.5 1.8A15 15 0 0 0 7.2 11H4.1a8 8 0 0 1 4.4-5.2ZM4.1 13h3.1c.2 2 .7 3.8 1.3 5.2A8 8 0 0 1 4.1 13Zm5.6 0h4.6c-.4 3.4-1.4 5.8-2.3 7c-.9-1.2-1.9-3.6-2.3-7Zm6.8 5.2c.6-1.4 1.1-3.2 1.3-5.2h3.1a8 8 0 0 1-4.4 5.2Z';
    if (name === 'lock') return 'M17 8h-1V6a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2Zm-7-2a2 2 0 0 1 4 0v2h-4V6Z';
    return 'M7 2h7l5 5v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V8h4.5';
  }

  function tabButtonClass(isActive) {
    return [
      'w-full flex items-center gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)] text-left transition-all duration-150 ease-in-out',
      isActive
        ? 'bg-[var(--accent-subtle)] text-[var(--text-primary)]'
        : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
    ].join(' ');
  }

  function tabButtonStyle(isActive) {
    return `border-left: 3px solid ${isActive ? 'var(--accent)' : 'transparent'};`;
  }

  function mobileTabClass(_isActive) {
    return [
      'rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] py-[var(--space-sm)] grid place-items-center transition-all duration-150 ease-in-out'
    ].join(' ');
  }

  function mobileIconClass(isActive) {
    return isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]';
  }

  let stopNetworkHooks = () => {};

  onMount(() => {
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
  });
</script>

<div class="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)] min-[1920px]:text-[18px]">
  <div class="mx-auto w-full h-screen min-[1920px]:max-w-[1440px] flex">
    <!-- Sidebar (hidden on mobile, icon rail on tablet, full on desktop) -->
    <aside
      class="hidden sm:flex flex-col border-r border-[var(--border)] bg-[var(--bg-surface)] w-[56px] lg:w-[220px]"
    >
      <div class="px-[var(--space-md)] py-[var(--space-md)] border-b border-[var(--border)]">
        <div class="font-800 tracking-tight">AetherChat</div>
        <div class="mt-[2px] hidden lg:block text-[var(--font-size-xs)] text-[var(--text-muted)] font-mono">
          decentralized browser chat
        </div>
      </div>

      <div class="flex-1 py-[var(--space-md)]">
        {#each tabs as t (t.key)}
          <button
            class={tabButtonClass($activeTab === t.key)}
            style={tabButtonStyle($activeTab === t.key)}
            on:click={() => activeTab.set(t.key)}
            title={t.label}
          >
            <svg class="h-[18px] w-[18px] flex-none" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d={iconPath(t.icon)} />
            </svg>
            <span class="hidden lg:inline text-[var(--font-size-sm)]">
              {t.label}
              {#if t.key === 'private' && $totalUnread > 0}
                <span
                  class="ml-[var(--space-sm)] inline-flex items-center rounded-[var(--radius-full)] bg-[var(--accent-subtle)] px-[var(--space-sm)] py-[2px] text-[var(--font-size-xs)] text-[var(--text-primary)] border border-[var(--border)]"
                  aria-label="Unread private messages"
                >
                  {$totalUnread > 99 ? '99+' : $totalUnread}
                </span>
              {/if}
            </span>
          </button>
        {/each}
      </div>

      <div class="border-t border-[var(--border)] p-[var(--space-md)]">
        <div class="flex items-center gap-[var(--space-sm)]">
          <AvatarDisplay username={$user?.username ?? ''} avatarBase64={$user?.avatarBase64 ?? null} size={36} showRing={true} />
          <div class="min-w-0 hidden lg:block">
            <div class="truncate font-700 text-[var(--text-primary)]">{$user?.username ?? '...'}</div>
            <div class="text-[var(--font-size-xs)] text-[var(--text-muted)] font-mono">local</div>
          </div>
        </div>
      </div>
    </aside>

    <!-- Main -->
    <main class="flex-1 min-w-0 flex flex-col">
      <div class="flex-1 min-h-0">
        {#if $activeTab === 'global'}
          <GlobalChat />
        {:else if $activeTab === 'private'}
          <PrivateChatPanel />
        {:else}
          <div class="h-full overflow-y-auto px-[var(--space-lg)] py-[var(--space-lg)]">
            <div class="max-w-[760px]">
              <h2 class="m-0 text-[var(--font-size-xl)] font-800">Terms & Conditions</h2>
              <p class="mt-[var(--space-sm)] text-[var(--text-secondary)]">
                AetherChat is a peer-to-peer chat experiment. Messages and identity are stored locally in your browser.
              </p>
              <p class="text-[var(--text-secondary)]">
                Do not share sensitive personal information. There is no central authority and no recovery mechanism.
              </p>
            </div>
          </div>
        {/if}
      </div>

      <!-- Mobile bottom nav -->
      <nav
        class="sm:hidden fixed bottom-0 left-0 right-0 border-t border-[var(--border)] bg-[var(--bg-surface)] px-[var(--space-md)] py-[var(--space-sm)]"
      >
        <div class="grid grid-cols-3 gap-[var(--space-sm)]">
          {#each tabs as t (t.key)}
            <button
              class={mobileTabClass($activeTab === t.key)}
              on:click={() => activeTab.set(t.key)}
              aria-label={t.label}
              title={t.label}
            >
              <div class="relative">
                <svg
                  class={`h-[18px] w-[18px] ${mobileIconClass($activeTab === t.key)}`}
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d={iconPath(t.icon)} />
                </svg>
                {#if t.key === 'private' && $totalUnread > 0}
                  <span
                    class="absolute -right-[6px] -top-[6px] h-[10px] w-[10px] rounded-[var(--radius-full)] bg-[var(--accent)] border border-[var(--border)]"
                    aria-hidden="true"
                  ></span>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      </nav>
    </main>
  </div>
</div>

{#if import.meta.env.DEV}
  <P2PDebugPanel />
{/if}
