<script>
  import { onMount, tick } from 'svelte';
  import { addGlobalMessage, globalMessages, loadGlobalMessages } from '$lib/stores/chatStore.js';
  import { peer } from '$lib/stores/peerStore.js';
  import { user } from '$lib/stores/userStore.js';
  import { broadcastToAll } from '$lib/services/peer.js';
  import { generateInitialsAvatar } from '$lib/utils/avatar.js';

  import ChatInput from '$lib/components/ChatInput.svelte';
  import MessageBubble from '$lib/components/MessageBubble.svelte';
  import UserTooltip from '$lib/components/UserTooltip.svelte';

  /** @type {HTMLDivElement|null} */
  let listEl = null;

  // Tooltip state
  let tooltipUser = null;
  let tooltipPos = null;
  /** @type {Record<string, string>} */
  const avatarCache = Object.create(null);

  // Simple windowed list for large histories.
  const EST_ITEM_H = 84;
  const OVERSCAN = 10;
  let start = 0;
  let end = 0;

  function computeRange(msgs) {
    if (!listEl) {
      start = 0;
      end = msgs?.length ?? 0;
      return;
    }

    if ((msgs?.length ?? 0) <= 200) {
      start = 0;
      end = msgs.length;
      return;
    }

    const scrollTop = listEl.scrollTop;
    const height = listEl.clientHeight;
    const first = Math.floor(scrollTop / EST_ITEM_H) - OVERSCAN;
    const visibleCount = Math.ceil(height / EST_ITEM_H) + OVERSCAN * 2;
    start = Math.max(0, first);
    end = Math.min(msgs.length, start + visibleCount);
  }

  function maybeAutoScroll() {
    if (!listEl) return true;
    const bottomGap = listEl.scrollHeight - (listEl.scrollTop + listEl.clientHeight);
    return bottomGap < 140;
  }

  async function scrollToBottom() {
    if (!listEl) return;
    await tick();
    if (!listEl) return;
    listEl.scrollTop = listEl.scrollHeight;
  }

  async function ensureAvatar(username, color) {
    const key = `${username}::${color}`;
    if (avatarCache[key]) return avatarCache[key];
    try {
      const avatar = await generateInitialsAvatar(username, color);
      avatarCache[key] = avatar;
      return avatar;
    } catch (err) {
      console.error('ensureAvatar failed', err);
      return '';
    }
  }

  async function onHoverEnter(e) {
    const { message, position } = e.detail;
    const avatarBase64 = await ensureAvatar(message.username, message.color);
    tooltipUser = {
      username: message.username,
      age: message.age,
      color: message.color,
      avatarBase64
    };
    tooltipPos = position;
  }

  function onHoverMove(e) {
    tooltipPos = e.detail.position;
  }

  function onHoverLeave() {
    tooltipUser = null;
    tooltipPos = null;
  }

  async function onSend(e) {
    const u = $user;
    if (!u) return;

    const msg = {
      peerId: $peer.peerId ?? 'local',
      username: u.username,
      age: u.age,
      color: u.color,
      text: e.detail.text,
      timestamp: Date.now()
    };

    // Persist locally and show immediately.
    await addGlobalMessage(msg);

    // Best-effort broadcast.
    broadcastToAll({
      type: 'GLOBAL_MSG',
      from: { username: u.username, peerId: $peer.peerId ?? 'local', color: u.color, age: u.age },
      payload: { message: msg },
      timestamp: msg.timestamp
    });

    await scrollToBottom();
    computeRange($globalMessages);
  }

  onMount(() => {
    const unsubscribe = globalMessages.subscribe((msgs) => {
      computeRange(msgs);
      if (listEl && maybeAutoScroll()) void scrollToBottom();
    });

    (async () => {
      try {
        await loadGlobalMessages();
        await tick();
        await scrollToBottom();
        computeRange($globalMessages);
      } catch (err) {
        console.error('GlobalChat init failed', err);
      }
    })();

    return () => unsubscribe();
  });

  function onStartPrivateChat() {
    // Phase 2.
  }

  $: msgs = $globalMessages;
  $: windowed = msgs.length > 200;
  $: visibleMsgs = windowed ? msgs.slice(start, end) : msgs;
  $: padTop = windowed ? start * EST_ITEM_H : 0;
  $: padBottom = windowed ? Math.max(0, (msgs.length - end) * EST_ITEM_H) : 0;

</script>

<div class="h-full flex flex-col">
  <div class="flex-1 min-h-0">
    {#if $globalMessages.length === 0}
      <div class="h-full grid place-items-center px-[var(--space-lg)]">
        <div class="text-center">
          <div class="text-[var(--font-size-lg)] font-700">No messages yet. Say hello! 👋</div>
          <div class="mt-[var(--space-xs)] text-[var(--text-secondary)] text-[var(--font-size-sm)]">
            Messages are stored locally and shared peer-to-peer.
          </div>
        </div>
      </div>
    {:else}
      <div
        bind:this={listEl}
        class="h-full overflow-y-auto px-[var(--space-md)] py-[var(--space-md)]"
        on:scroll={() => computeRange(msgs)}
      >
        <div style={`padding-top:${padTop}px; padding-bottom:${padBottom}px;`}>
          {#each visibleMsgs as m (m.id ?? `${m.timestamp}-${m.username}-${m.text}`)}
            <div class="mb-[var(--space-sm)]">
              <MessageBubble
                message={m}
                isOwn={$user?.username === m.username}
                on:hoverEnter={onHoverEnter}
                on:hoverMove={onHoverMove}
                on:hoverLeave={onHoverLeave}
              />
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <ChatInput on:send={onSend} placeholder="Message the global room..." />

  <UserTooltip user={tooltipUser} position={tooltipPos} on:startPrivateChat={onStartPrivateChat} />
</div>
