import { fireEvent, render, screen } from '@testing-library/svelte';
import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';

const ONE_BY_ONE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/ViW0xgAAAAASUVORK5CYII=';

it('renders initials when avatarBase64 is null', () => {
  render(AvatarDisplay, { props: { username: 'alice', avatarBase64: null, size: 36 } });
  expect(screen.getByText('AL')).toBeInTheDocument();
  expect(screen.queryByRole('img')).toBeNull();
});

it('renders <img> when avatarBase64 is provided', () => {
  render(AvatarDisplay, { props: { username: 'alice', avatarBase64: ONE_BY_ONE_PNG, size: 36 } });
  expect(screen.getByRole('img', { name: /alice/i })).toBeInTheDocument();
});

it('falls back to initials when the image fails to load', async () => {
  render(AvatarDisplay, { props: { username: 'alice', avatarBase64: 'data:image/png;base64,broken', size: 36 } });
  const img = screen.getByRole('img', { name: /alice/i });
  await fireEvent.error(img);
  expect(screen.getByText('AL')).toBeInTheDocument();
});

