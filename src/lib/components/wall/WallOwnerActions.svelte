<script>
  import { openProfile } from '$lib/stores/profileStore.js';

  export let disabled = false;
</script>

<button
  type="button"
  class="btn btn-owner"
  on:click={openProfile}
  disabled={disabled}
  aria-label="Edit profile"
  title="Edit profile"
>
  Edit Profile
</button>

<style>
  .btn {
    height: 40px;
    padding: 0 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-weight: 900;
    font-size: var(--font-size-sm);
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  @media (hover: hover) {
    .btn:hover:not(:disabled) {
      background: var(--bg-overlay);
    }
  }
</style>

