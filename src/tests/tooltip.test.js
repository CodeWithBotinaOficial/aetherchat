import { waitFor } from '@testing-library/dom';
import GlobalChat from '$lib/components/GlobalChat.svelte';
import { db } from '$lib/services/db.js';
import { globalMessages } from '$lib/stores/chatStore.js';
import { peer } from '$lib/stores/peerStore.js';
import { user } from '$lib/stores/userStore.js';

async function clearAllTables() {
  await db.transaction(
    'rw',
    db.users,
    db.globalMessages,
    db.privateChats,
    db.privateMessages,
    db.knownPeers,
    async () => {
      await Promise.all([
        db.users.clear(),
        db.globalMessages.clear(),
        db.privateChats.clear(),
        db.privateMessages.clear(),
        db.knownPeers.clear()
      ]);
    }
  );
}

beforeEach(async () => {
  await clearAllTables();
  document.body.innerHTML = '';
  user.set(null);
  globalMessages.set([]);
  peer.set({ peerId: null, isConnected: false, connectedPeers: new Map() });
});

afterEach(() => {
  document.body.innerHTML = '';
});

async function mountWithOneMessage() {
  // Svelte components can be instantiated via `new` in tests (see svelte.config.js).
  const component = new GlobalChat({ target: document.body });

  // Let GlobalChat's onMount (DB load) settle first, then set the store directly to avoid races.
  await new Promise((r) => setTimeout(r, 30));
  globalMessages.set([
    {
      peerId: 'p1',
      username: 'alice',
      age: 22,
      color: 'hsl(1, 65%, 65%)',
      text: 'hello tooltip',
      timestamp: Date.now()
    }
  ]);

  const bubble = await waitFor(() => {
    const el = document.querySelector('[data-aether-bubble="true"]');
    if (!el) throw new Error('bubble not ready');
    return el;
  });

  return { component, bubble };
}

it('Moving cursor from bubble to tooltip does not close the tooltip', async () => {
  const { component, bubble } = await mountWithOneMessage();

  bubble.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 120, clientY: 120 }));

  const tooltip = await waitFor(() => {
    const el = document.querySelector('[data-aether-tooltip="true"]');
    if (!el) throw new Error('tooltip not ready');
    return el;
  });

  bubble.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
  tooltip.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

  // Wait longer than the hide delay (120ms) to ensure it would have closed.
  await new Promise((r) => setTimeout(r, 160));
  expect(document.querySelector('[data-aether-tooltip="true"]')).toBeTruthy();

  tooltip.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  expect(document.querySelector('[data-aether-tooltip="true"]')).toBeNull();

  component.$destroy();
});

it('Tooltip closes when cursor leaves the bubble and does not enter the tooltip', async () => {
  const { component, bubble } = await mountWithOneMessage();

  bubble.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 120, clientY: 120 }));
  await waitFor(() => {
    const el = document.querySelector('[data-aether-tooltip="true"]');
    if (!el) throw new Error('tooltip not ready');
    return el;
  });

  bubble.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 160));
  expect(document.querySelector('[data-aether-tooltip="true"]')).toBeNull();

  component.$destroy();
});

it('On touch: tooltip opens on tap and closes on outside tap', async () => {
  // Force touch mode before component mounts (GlobalChat reads this in onMount).
  try {
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 1, configurable: true });
  } catch {
    // ignore if environment doesn't allow overriding
  }
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = (q) => {
    if (q === '(hover: none)') return { matches: true, media: q, addEventListener() {}, removeEventListener() {} };
    return originalMatchMedia ? originalMatchMedia(q) : { matches: false, media: q, addEventListener() {}, removeEventListener() {} };
  };

  const { component, bubble } = await mountWithOneMessage();

  const tap = new Event('pointerup', { bubbles: true });
  Object.defineProperty(tap, 'pointerType', { value: 'touch' });
  Object.defineProperty(tap, 'clientX', { value: 100 });
  Object.defineProperty(tap, 'clientY', { value: 100 });
  bubble.dispatchEvent(tap);

  await waitFor(() => {
    const el = document.querySelector('[data-aether-tooltip="true"]');
    if (!el) throw new Error('tooltip not ready');
    return el;
  });

  const outside = new Event('pointerdown', { bubbles: true });
  document.body.dispatchEvent(outside);

  await new Promise((r) => setTimeout(r, 0));
  expect(document.querySelector('[data-aether-tooltip="true"]')).toBeNull();

  component.$destroy();
  window.matchMedia = originalMatchMedia;
});
