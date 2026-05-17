<script>
  import { peer as peerStore } from '$lib/stores/peerStore.js';
  import { avatarCache } from '$lib/services/peer.js';
  import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';
  import { openWall } from '$lib/stores/wall/actions.js';
  import { calculateAge } from '$lib/utils/time.js';

  export let user;

  $: pid = String(user?.peerId ?? '').trim();
  $: uname = String(user?.username ?? '').trim();
  $: online = pid ? $peerStore.connectedPeers.has(pid) : false;
  $: isBirthday = Boolean(user?.isBirthday);
  $: live = pid ? $peerStore.connectedPeers.get(pid) : null;
  $: displayAvatar =
    user?.avatarBase64 ??
    (typeof live?.avatarBase64 === 'string' && live.avatarBase64.length > 0 ? live.avatarBase64 : null) ??
    ($avatarCache?.get?.(pid) ?? null);
  $: displayBio = String(user?.bio ?? '').trim() || String(live?.bio ?? '').trim() || '';
  $: displayDob = typeof live?.dateOfBirth === 'string' ? live.dateOfBirth : (user?.dateOfBirth ?? null);
  $: displayAge = displayDob ? calculateAge(displayDob) : null;
</script>

<button
  type="button"
  class={`card ${isBirthday ? 'birthday' : ''}`}
  on:click={() => {
    if (!pid || !uname) return;
    openWall({
      peerId: pid,
      username: uname,
      color: '',
      dateOfBirth: user?.dateOfBirth ?? null,
      avatarBase64: user?.avatarBase64 ?? null,
      bio: user?.bio ?? ''
    }).catch((err) => console.error('openWall failed', err));
  }}
  aria-label={`Open ${uname}'s wall`}
>
  <div class="status" aria-label={online ? 'Online' : 'Offline'}>
    <span class={`dot ${online ? 'on' : 'off'}`}></span>
  </div>

  <div class="avatar">
    <AvatarDisplay username={uname} avatarBase64={displayAvatar} size={64} showRing={true} />
  </div>

  <div class="name" title={uname}>
    {uname}
  </div>

  {#if isBirthday}
    <div class="birthday-label" aria-label="Birthday today">
      <span class="cake" aria-hidden="true">🎂</span>
      Birthday today!
    </div>
  {/if}

  <div class="age">
    Age: {displayDob ? (displayAge ?? '—') : '—'}
  </div>

  {#if displayBio.length > 0}
    <div class="bio">{displayBio}</div>
  {/if}
</button>

<style>
  .card {
    width: 100%;
    text-align: left;
    border: 1px solid var(--border);
    background: var(--bg-surface);
    color: var(--text-primary);
    border-radius: 8px;
    padding: 14px 14px 12px 14px;
    display: grid;
    gap: 10px;
    justify-items: center;
    position: relative;
    cursor: pointer;
    min-height: 190px;
  }

  .card:active {
    transform: translateY(1px);
  }

  .birthday {
    border-color: color-mix(in srgb, var(--warning) 35%, var(--border));
    background: color-mix(in srgb, var(--warning) 8%, var(--bg-surface));
  }

  .status {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 9999px;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
  }

  .dot.on {
    border-color: color-mix(in srgb, var(--success) 40%, var(--border));
    background: var(--success);
  }

  .dot.off {
    opacity: 0.75;
  }

  .avatar {
    margin-top: 4px;
  }

  .name {
    max-width: 100%;
    font-weight: 900;
    font-size: 1.1rem;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .birthday-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 900;
    padding: 4px 10px;
    border-radius: var(--radius-full);
    border: 1px solid color-mix(in srgb, var(--warning) 35%, var(--border));
    background: color-mix(in srgb, var(--warning) 12%, var(--bg-elevated));
  }

  .cake {
    line-height: 1;
  }

  .age {
    font-size: 12px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .bio {
    width: 100%;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (hover: hover) {
    .card:hover {
      background: var(--bg-elevated);
      box-shadow: var(--shadow-md);
    }
  }
</style>
