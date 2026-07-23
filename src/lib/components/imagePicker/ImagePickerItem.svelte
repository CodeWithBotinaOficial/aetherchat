<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  
  /** @type {Blob | null} */
  export let blob = null;
  /** @type {File | null} */
  export let file = null;
  export let selected = false;
  export let disabled = false;
  
  const dispatch = createEventDispatcher();
  let objectUrl = null;
  
  onMount(() => {
    if (file) {
      objectUrl = URL.createObjectURL(file);
    } else if (blob) {
      objectUrl = URL.createObjectURL(blob);
    }
  });
  
  onDestroy(() => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  });
  
  function handleClick() {
    if (!disabled || selected) {
      dispatch('toggle');
    }
  }
</script>

<button 
  type="button" 
  class="relative w-full aspect-square overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] p-0 m-0 cursor-pointer"
  class:opacity-50={disabled && !selected}
  class:cursor-not-allowed={disabled && !selected}
  on:click={handleClick}
  aria-label="Toggle image selection"
>
  {#if objectUrl}
    <img src={objectUrl} alt="Thumbnail" class="w-full h-full object-cover block" />
  {:else}
    <div class="w-full h-full flex items-center justify-center bg-[var(--bg-surface)]">
      <div class="w-6 h-6 rounded-full border-2 border-t-[var(--accent)] border-r-[var(--accent)] border-b-transparent border-l-transparent animate-spin"></div>
    </div>
  {/if}
  
  {#if selected}
    <div class="absolute inset-0 bg-[var(--accent)] bg-opacity-40 flex items-center justify-center">
      <svg class="w-8 h-8 text-white drop-shadow-md" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path>
      </svg>
    </div>
    <div class="absolute inset-0 border-2 border-[var(--accent)] rounded-[var(--radius-sm)] pointer-events-none"></div>
  {:else if disabled}
    <div class="absolute inset-0 bg-[rgba(100,100,100,0.5)] pointer-events-none"></div>
  {/if}
</button>
