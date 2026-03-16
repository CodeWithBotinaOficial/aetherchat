<script>
  import { onDestroy, onMount } from 'svelte';
  import { peer } from '$lib/stores/peerStore.js';
  import { db } from '$lib/services/db.js';

  let open = false;
  let registryCount = 0;
  let messagesCount = 0;
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;

  async function refreshCounts() {
    try {
      const [r, m] = await Promise.all([db.usernameRegistry.count(), db.globalMessages.count()]);
      registryCount = r;
      messagesCount = m;
    } catch {
      // ignore
    }
  }

  onMount(() => {
    void refreshCounts();
    timer = setInterval(() => void refreshCounts(), 2000);
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
  });

  function fmtAge(ms) {
    if (!ms || ms < 0) return 'n/a';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ago`;
  }

  $: state = $peer;
  $: role = state.isLobbyHost ? 'host' : 'guest';
  $: connectedCount = state.connectedPeers.size;
  $: lastSync = fmtAge(state.lastSyncAt ? Date.now() - state.lastSyncAt : 0);
</script>

<div class="fixed bottom-[var(--space-md)] right-[var(--space-md)] z-[60]">
  {#if !open}
    <button
      class="px-[10px] py-[6px] rounded-[var(--radius-full)] border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] text-[var(--font-size-xs)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-all duration-150"
      on:click={() => (open = true)}
      aria-label="Open P2P debug panel"
    >
      [P2P]
    </button>
  {:else}
    <div class="w-[320px] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-overlay)] shadow-[var(--shadow-lg)] overflow-hidden">
      <div class="flex items-center justify-between px-[var(--space-md)] py-[var(--space-sm)] border-b border-[var(--border)]">
        <div class="font-800 text-[var(--text-primary)]">P2P Debug</div>
        <button
          class="text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-[8px] py-[4px] rounded-[var(--radius-md)] hover:bg-[var(--bg-elevated)] transition-all duration-150"
          on:click={() => (open = false)}
          aria-label="Close P2P debug panel"
        >
          Close
        </button>
      </div>

      <div class="px-[var(--space-md)] py-[var(--space-md)] text-[var(--font-size-sm)] text-[var(--text-secondary)]">
        <div class="grid grid-cols-2 gap-x-[var(--space-md)] gap-y-[6px]">
          <div class="text-[var(--text-muted)]">My Peer ID:</div>
          <div class="text-[var(--text-primary)] font-mono truncate" title={state.peerId ?? ''}>{state.peerId ?? '...'}</div>
          <div class="text-[var(--text-muted)]">Role:</div>
          <div class="text-[var(--text-primary)]">{role}</div>
          <div class="text-[var(--text-muted)]">Lobby Host:</div>
          <div class="text-[var(--text-primary)] font-mono truncate" title={state.currentLobbyHostId ?? ''}>
            {state.currentLobbyHostId ?? '...'}
          </div>
          <div class="text-[var(--text-muted)]">Connected:</div>
          <div class="text-[var(--text-primary)]">{connectedCount} peers</div>
          <div class="text-[var(--text-muted)]">Registry:</div>
          <div class="text-[var(--text-primary)]">{registryCount} usernames</div>
          <div class="text-[var(--text-muted)]">Messages in DB:</div>
          <div class="text-[var(--text-primary)]">{messagesCount}</div>
          <div class="text-[var(--text-muted)]">Last Sync:</div>
          <div class="text-[var(--text-primary)]">{lastSync}</div>
        </div>

        <div class="mt-[var(--space-md)] text-[var(--text-muted)] text-[var(--font-size-xs)] font-700">
          Connected Peers:
        </div>
        <div class="mt-[var(--space-xs)] max-h-[180px] overflow-auto">
          {#if connectedCount === 0}
            <div class="text-[var(--text-muted)] text-[var(--font-size-xs)]">Just you.</div>
          {:else}
            {#each Array.from(state.connectedPeers.entries()) as [peerId, info] (peerId)}
              <div class="flex items-center justify-between py-[6px] border-b border-[var(--border)] last:border-b-0">
                <div class="min-w-0">
                  <div class="text-[var(--text-primary)] truncate">{info.username}</div>
                  <div class="text-[var(--text-muted)] text-[var(--font-size-xs)] font-mono truncate">{peerId}</div>
                </div>
                <div class="flex items-center gap-[6px] flex-none">
                  <span class="h-[8px] w-[8px] rounded-[var(--radius-full)]" style={`background: ${info.color};`}></span>
                  <span class="text-[var(--text-muted)] text-[var(--font-size-xs)]">online</span>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
