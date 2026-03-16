<script>
  import { onMount, tick } from 'svelte';
  import { addGlobalMessage, globalMessages, loadGlobalMessages } from '$lib/stores/chatStore.js';
  import { peer } from '$lib/stores/peerStore.js';
  import { user } from '$lib/stores/userStore.js';
  import { broadcastGlobalMessage } from '$lib/services/peer.js';
  import { generateInitialsAvatar } from '$lib/utils/avatar.js';

  import ChatInput from '$lib/components/ChatInput.svelte';
  import MessageBubble from '$lib/components/MessageBubble.svelte';
  import UserTooltip from '$lib/components/UserTooltip.svelte';

  /** @type {HTMLDivElement|null} */
  let listEl = null;

  // Tooltip state
  let tooltipUser = null;
  let tooltipPos = null;
  let tooltipKey = '';
  /** @type {(() => void) | null} */
  let tooltipCancelHide = null;
  const TOOLTIP_ID = 'aether-user-tooltip';
  const bubbleRefs = Object.create(null);
  let isTouch = false;
  let outsideListenerAttached = false;
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
    const { message, messageKey, position } = e.detail;
    const avatarBase64 = await ensureAvatar(message.username, message.color);
    tooltipUser = {
      username: message.username,
      age: message.age,
      color: message.color,
      avatarBase64
    };
    tooltipPos = position;
    tooltipKey = String(messageKey ?? '');
    tooltipCancelHide = bubbleRefs[tooltipKey]?.cancelHide ?? null;

    if (isTouch) attachOutsideClose();
  }

  function onHoverMove(e) {
    tooltipPos = e.detail.position;
  }

  function onHoverLeave() {
    tooltipUser = null;
    tooltipPos = null;
    tooltipKey = '';
    tooltipCancelHide = null;
    detachOutsideClose();
  }

  function onTooltipClose() {
    onHoverLeave();
  }

  async function onSend(e) {
    const u = $user;
    if (!u) return;

    if ($peer.peerId) {
      // Peer service handles optimistic add + network broadcast.
      await broadcastGlobalMessage(e.detail.text, {
        username: u.username,
        color: u.color,
        age: u.age,
        avatarBase64: u.avatarBase64
      });
    } else {
      // Offline fallback: local-only message.
      await addGlobalMessage({
        peerId: 'local',
        username: u.username,
        age: u.age,
        color: u.color,
        text: e.detail.text,
        timestamp: Date.now()
      });
    }

    await scrollToBottom();
    computeRange($globalMessages);
  }

  onMount(() => {
    isTouch = window.matchMedia?.('(hover: none)').matches || (navigator.maxTouchPoints ?? 0) > 0;

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

  function attachOutsideClose() {
    if (outsideListenerAttached) return;
    outsideListenerAttached = true;

    const handler = (ev) => {
      if (!tooltipUser) return;
      const path = ev.composedPath?.() ?? [];
      const hit = path.some(
        (n) => n?.dataset?.aetherTooltip === 'true' || n?.dataset?.aetherBubble === 'true'
      );
      if (!hit) onHoverLeave();
    };

    document.addEventListener('pointerdown', handler, true);
    document.addEventListener('mousedown', handler, true);

    detachOutsideClose = () => {
      if (!outsideListenerAttached) return;
      outsideListenerAttached = false;
      document.removeEventListener('pointerdown', handler, true);
      document.removeEventListener('mousedown', handler, true);
      detachOutsideClose = () => {};
    };
  }

  let detachOutsideClose = () => {};
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
                messageKey={m.id ?? `${m.timestamp}-${m.username}-${m.text}`}
                bind:this={bubbleRefs[String(m.id ?? `${m.timestamp}-${m.username}-${m.text}`)]}
                isOwn={$user?.username === m.username}
                tooltipId={tooltipUser && tooltipKey === String(m.id ?? `${m.timestamp}-${m.username}-${m.text}`) ? TOOLTIP_ID : ''}
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

  <UserTooltip
    user={tooltipUser}
    position={tooltipPos}
    cancelHide={tooltipCancelHide}
    on:close={onTooltipClose}
    on:startPrivateChat={onStartPrivateChat}
  />
</div>
