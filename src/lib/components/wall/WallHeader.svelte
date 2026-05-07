<script>
  import AvatarDisplay from '$lib/components/AvatarDisplay.svelte';
  import WallStats from './WallStats.svelte';
  import WallOwnerActions from './WallOwnerActions.svelte';
  import { stablePeerId } from '$lib/stores/userStore.js';
  import { initiatePrivateChat } from '$lib/services/peer.js';
  import { toggleFollowWallOwner } from '$lib/stores/wall/actions.js';
  import { calculateAge, isBirthday } from '$lib/utils/time.js';

  export let wall = null;

  $: myPeerId = $stablePeerId ?? null;
  $: isOwner = Boolean(wall && myPeerId && wall.ownerPeerId === myPeerId);
  $: displayAge = wall?.ownerDateOfBirth ? calculateAge(wall.ownerDateOfBirth) : 0;
  $: showBirthday = wall?.ownerDateOfBirth ? isBirthday(wall.ownerDateOfBirth) : false;
</script>

{#if wall}
  <div class="header">
    <div class="top">
      <AvatarDisplay
        username={wall.ownerUsername}
        avatarBase64={wall.ownerAvatarBase64 ?? null}
        size={80}
        showRing={true}
      />

      <div class="meta">
        <div class="name-row">
          <div class="name">{wall.ownerUsername}</div>
          {#if wall.ownerDateOfBirth}
            <div class="age-badge" aria-label="Age">{displayAge}</div>
          {/if}
        </div>
        {#if wall.ownerBio?.trim?.()}
          <div class="bio">{wall.ownerBio}</div>
        {/if}
        {#if showBirthday}
          <div class="birthday-banner">🎂 Today is {wall.ownerUsername}'s birthday! Wish them a happy birthday! 🎉</div>
        {/if}

        <div class="stats-row">
          <WallStats followerCount={wall.followerCount} followingCount={wall.followingCount} />
          {#if wall.isOffline && !isOwner}
            <div class="offline" title="This peer is currently offline">offline</div>
          {:else if wall.isLoading && !isOwner}
            <div class="loading" title="Requesting latest wall data">syncing…</div>
          {/if}
        </div>
      </div>
    </div>

    <div class="actions">
      {#if isOwner}
        <WallOwnerActions />
      {:else}
        <button
          type="button"
          class={`btn ${wall.isFollowing ? 'btn-secondary' : 'btn-primary'}`}
          on:click|stopPropagation={toggleFollowWallOwner}
          aria-label={wall.isFollowing ? 'Unfollow' : 'Follow'}
          title={wall.isFollowing ? 'Unfollow' : 'Follow'}
        >
          {wall.isFollowing ? 'Following' : 'Follow'}
        </button>

        <button
          type="button"
          class="btn btn-secondary"
          on:click|stopPropagation={async () => {
            try {
              await initiatePrivateChat(wall.ownerPeerId, wall.ownerUsername, wall.ownerColor, wall.ownerAvatarBase64 ?? null);
            } catch (err) {
              console.error('initiatePrivateChat failed', err);
            }
          }}
          disabled={wall.isOffline}
          aria-label="Message"
          title={wall.isOffline ? 'Peer is offline' : 'Start private chat'}
        >
          Message
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .header {
    display: grid;
    gap: 14px;
  }

  .top {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 14px;
    align-items: start;
  }

  .meta {
    min-width: 0;
  }

  .name-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .name {
    font-weight: 900;
    letter-spacing: -0.02em;
    font-size: 1.4rem;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }

  .age-badge {
    height: 24px;
    padding: 0 10px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    font-weight: 800;
    display: inline-flex;
    align-items: center;
  }

  .bio {
    margin-top: 6px;
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .birthday-banner {
    margin-top: 10px;
    border-radius: var(--radius-md);
    border: 1px solid color-mix(in srgb, var(--warning) 35%, var(--border));
    background: color-mix(in srgb, var(--warning) 12%, var(--bg-elevated));
    color: var(--text-primary);
    padding: 10px 12px;
    font-size: var(--font-size-sm);
    font-weight: 800;
  }

  .stats-row {
    margin-top: 10px;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }

  .offline,
  .loading {
    height: 32px;
    padding: 0 10px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    display: inline-flex;
    align-items: center;
  }

  .offline {
    border-color: color-mix(in srgb, var(--warning) 35%, var(--border));
    background: color-mix(in srgb, var(--warning) 10%, var(--bg-elevated));
    color: var(--text-secondary);
  }

  .actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .btn {
    height: 40px;
    padding: 0 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    font-weight: 900;
    font-size: var(--font-size-sm);
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--text-primary);
  }

  .btn-secondary {
    background: var(--bg-elevated);
    color: var(--text-primary);
  }

  @media (hover: hover) {
    .btn-secondary:hover:not(:disabled) {
      background: var(--bg-overlay);
    }
    .btn-primary:hover:not(:disabled) {
      background: var(--accent-hover);
    }
  }
</style>
