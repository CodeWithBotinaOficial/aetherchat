<script>
  /**
   * AvatarDisplay — renders a user avatar consistently everywhere.
   *
   * Props:
   *   username     {string}       — used for initials fallback and color
   *   avatarBase64 {string|null}  — if provided, renders the image
   *   size         {number}       — diameter in px
   *   showRing     {boolean}      — show colored ring border
   */
  export let username = '';
  export let avatarBase64 = null;
  export let size = 36;
  export let showRing = true;

  import { getUserColor } from '$lib/utils/colors.js';

  let allowImage = true;

  $: color = getUserColor(username);
  $: initials = getInitials(username);
  $: ringStyle = showRing ? `box-shadow: 0 0 0 2px ${color};` : '';
  $: containerStyle = `
    width: ${size}px;
    height: ${size}px;
    min-width: ${size}px;
    border-radius: 50%;
    overflow: hidden;
    ${ringStyle}
  `;
  $: fontSize = Math.max(10, Math.round(size * 0.38));

  $: if (avatarBase64) allowImage = true;
  $: showImage = allowImage && Boolean(avatarBase64);

  function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/[\s_-]+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  function onImgError() {
    allowImage = false;
  }
</script>

<div class="avatar" style={containerStyle} title={username}>
  {#if showImage}
    <img
      src={avatarBase64}
      alt={`${username}'s avatar`}
      style="width:100%; height:100%; object-fit:cover; display:block;"
      on:error={onImgError}
    />
  {:else}
    <div
      class="initials"
      style="
        width:100%; height:100%;
        display:flex; align-items:center; justify-content:center;
        background:{color};
        color: var(--bg-base);
        font-size:{fontSize}px;
        font-weight:700;
        font-family: var(--font-sans);
        letter-spacing: 0.03em;
        user-select:none;
      "
      aria-hidden="true"
    >
      {initials}
    </div>
  {/if}
</div>
