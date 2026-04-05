import { render } from '@testing-library/svelte';
import MessageBubble from '$lib/components/MessageBubble.svelte';

it('Edited message renders an edited indicator', async () => {
  render(MessageBubble, {
    message: {
      id: 'm1',
      username: 'alice',
      age: 22,
      color: 'hsl(1, 65%, 65%)',
      text: 'hello',
      timestamp: 1,
      editedAt: Date.now(),
      deleted: false,
      replies: null
    },
    isOwn: true
  });

  expect(document.querySelector('.edited')).toBeTruthy();
  expect(document.querySelector('.edited')?.textContent).toContain('edited');
});

it('Deleted message renders deletion placeholder styling', async () => {
  render(MessageBubble, {
    message: {
      id: 'm2',
      username: 'alice',
      age: 22,
      color: 'hsl(1, 65%, 65%)',
      text: '[ This message was deleted ]',
      timestamp: 1,
      editedAt: null,
      deleted: true,
      replies: null
    },
    isOwn: true
  });

  const el = document.querySelector('.msg-text');
  expect(el).toBeTruthy();
  expect(el.className).toMatch(/\bmsg-deleted\b/);
  expect(el.textContent).toContain('deleted');
});

