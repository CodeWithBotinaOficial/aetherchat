<script>
  import { createEventDispatcher } from 'svelte';
  import { fade, scale } from 'svelte/transition';

  /** @type {{ username: string, age: number, color: string, avatarBase64: string } | null} */
  export let user = null;
  /** @type {{ x: number, y: number } | null} */
  export let position = null;

  const dispatch = createEventDispatcher();

  $: stylePos =
    user && position
      ? `left:${Math.max(12, position.x + 12)}px; top:${Math.max(12, position.y + 12)}px;`
      : '';

  function startChat() {
    if (!user) return;
    dispatch('startPrivateChat', { user });
  }
</script>

{#if user && position}
  <div
    class="fixed z-60"
    style={stylePos}
    in:fade={{ duration: 120 }}
  >
    <div
      class="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] shadow-[var(--shadow-md)] px-[var(--space-md)] py-[var(--space-md)] backdrop-blur"
      in:scale={{ duration: 120, start: 0.95 }}
    >
      <div class="flex items-center gap-[var(--space-md)]">
      <div
        class="h-[44px] w-[44px] rounded-[var(--radius-full)] overflow-hidden border border-[var(--border)]"
        style={`outline: 2px solid ${user.color}; outline-offset: 2px;`}
      >
        <img class="h-full w-full object-cover" alt={`${user.username} avatar`} src={user.avatarBase64} />
      </div>

      <div class="min-w-0">
        <div class="flex items-center gap-[var(--space-sm)]">
          <div class="truncate font-700 text-[var(--text-primary)]">{user.username}</div>
          <div
            class="rounded-[var(--radius-full)] border border-[var(--border)] bg-[var(--bg-elevated)] px-[var(--space-sm)] py-[2px] text-[var(--font-size-xs)] text-[var(--text-secondary)]"
          >
            {user.age}
          </div>
        </div>
        <div class="mt-[2px] text-[var(--font-size-xs)] text-[var(--text-muted)] font-mono">
          P2P identity
        </div>
      </div>
    </div>

      <div class="mt-[var(--space-md)]">
        <button
          class="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--accent)] px-[var(--space-md)] py-[var(--space-sm)] text-[var(--text-primary)] font-600 hover:bg-[var(--accent-hover)]"
          on:click={startChat}
        >
          Start Private Chat
        </button>
      </div>
    </div>
  </div>
{/if}
