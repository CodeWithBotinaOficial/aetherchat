<script>
  import { createEventDispatcher, tick } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';
  import { initiatePrivateChat } from '$lib/services/peer.js';

  /** @type {{ peerId?: string, username: string, age: number, color: string, avatarBase64: string | null } | null} */
  export let user = null;
  /** @type {{ x: number, y: number } | null} */
  export let position = null;
  /** @type {(() => void) | null} */
  export let cancelHide = null;

  const dispatch = createEventDispatcher();

  const TOOLTIP_ID = 'aether-user-tooltip';
  /** @type {HTMLDivElement|null} */
  let el = null;
  let stylePos = '';
  let raf = 0;

  async function updatePosition() {
    if (!user || !position) return;
    await tick();
    if (!el) return;

    const margin = 12;
    const rect = el.getBoundingClientRect();

    let left = position.x + margin;
    let top = position.y + margin;

    // Flip if overflow.
    if (left + rect.width + margin > window.innerWidth) left = position.x - rect.width - margin;
    if (top + rect.height + margin > window.innerHeight) top = position.y - rect.height - margin;

    // Clamp to viewport.
    left = Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin));

    stylePos = `left:${left}px; top:${top}px;`;
  }

  $: if (user && position) {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => void updatePosition());
  }
  $: if (!user || !position) {
    if (raf) cancelAnimationFrame(raf);
    stylePos = '';
  }

  async function handleStartPrivateChat() {
    if (!user) return;
    try {
      const u = user;
      dispatch('close');
      if (!u?.peerId) return;
      await initiatePrivateChat(u.peerId, u.username, u.color, u.avatarBase64 ?? null);
    } catch (err) {
      console.error('initiatePrivateChat failed', err);
    }
  }

  function handleTooltipMouseEnter() {
    cancelHide?.();
  }

  function handleTooltipMouseLeave() {
    dispatch('close');
  }
</script>

{#if user && position}
  <div
    class="fixed z-60"
    style={stylePos}
    in:fade={{ duration: 120 }}
    id={TOOLTIP_ID}
    role="tooltip"
    data-aether-tooltip="true"
    bind:this={el}
    on:mouseenter={handleTooltipMouseEnter}
    on:mouseleave={handleTooltipMouseLeave}
  >
    <div
      class="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-overlay)] shadow-[var(--shadow-md)] px-[var(--space-md)] py-[var(--space-md)] backdrop-blur"
      in:scale={{ duration: 120, start: 0.95 }}
    >
      <div class="flex items-center gap-[var(--space-md)]">
      <AvatarDisplay username={user.username} avatarBase64={user.avatarBase64 ?? null} size={56} showRing={true} />

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
          on:click={handleStartPrivateChat}
        >
          Start Private Chat
        </button>
      </div>
    </div>
  </div>
{/if}
