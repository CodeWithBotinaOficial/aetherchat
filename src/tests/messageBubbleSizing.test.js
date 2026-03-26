import { render } from '@testing-library/svelte';
import MessageBubble from '$lib/components/MessageBubble.svelte';

function stubMatchMedia(map) {
  const original = window.matchMedia;
  window.matchMedia = (q) => {
    const matches = Boolean(map[q]);
    return {
      matches,
      media: q,
      addEventListener() {},
      removeEventListener() {}
    };
  };
  return () => {
    window.matchMedia = original;
  };
}

it('MessageBubble renders username fully without truncation (normal-length username)', async () => {
  const restore = stubMatchMedia({
    '(max-width: 639px)': false,
    '(min-width: 1024px)': true,
    '(hover: none)': false
  });
  try {
    render(MessageBubble, {
      message: { id: 'm1', username: 'alice_normal', age: 22, color: 'hsl(1, 65%, 65%)', text: 'hello', timestamp: 1 },
      isOwn: false
    });
    await new Promise((r) => setTimeout(r, 0));

    const nameEl = document.querySelector('.meta-name');
    expect(nameEl).toBeTruthy();
    expect(nameEl.textContent).toBe('alice_normal');
    expect(nameEl.className).not.toMatch(/\btruncate\b/);
  } finally {
    restore();
  }
});

it('MessageBubble avatar is visible at expected size on mobile and desktop', async () => {
  // Desktop
  let restore = stubMatchMedia({
    '(max-width: 639px)': false,
    '(min-width: 1024px)': true,
    '(hover: none)': false
  });
  try {
    const { unmount } = render(MessageBubble, {
      message: { id: 'm2', username: 'alice', age: 1, color: 'hsl(1, 65%, 65%)', text: 'hello', timestamp: 1 },
      isOwn: true
    });
    await new Promise((r) => setTimeout(r, 0));
    const avatar = document.querySelector('.avatar');
    expect(avatar).toBeTruthy();
    const style = avatar.getAttribute('style') ?? '';
    expect(style).toMatch(/width:\s*40px/);
    expect(style).toMatch(/height:\s*40px/);
    unmount();
  } finally {
    restore();
  }

  // Mobile
  restore = stubMatchMedia({
    '(max-width: 639px)': true,
    '(min-width: 1024px)': false,
    '(hover: none)': true
  });
  try {
    const { unmount } = render(MessageBubble, {
      message: { id: 'm3', username: 'alice', age: 1, color: 'hsl(1, 65%, 65%)', text: 'hello', timestamp: 1 },
      isOwn: true
    });
    await new Promise((r) => setTimeout(r, 0));
    const avatar = document.querySelector('.avatar');
    expect(avatar).toBeTruthy();
    const style = avatar.getAttribute('style') ?? '';
    expect(style).toMatch(/width:\s*32px/);
    expect(style).toMatch(/height:\s*32px/);
    unmount();
  } finally {
    restore();
  }
});
