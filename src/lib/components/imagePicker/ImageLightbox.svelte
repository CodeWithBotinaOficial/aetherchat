<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { fade, scale } from 'svelte/transition';

  /** @type {Array<{ id: string, url: string, blob: Blob }>} */
  export let images = [];
  export let currentIndex = 0;
  
  const dispatch = createEventDispatcher();
  
  /** @type {HTMLDivElement} */
  let lightboxEl;
  
  function handleClose() {
    dispatch('close');
  }
  
  function next() {
    if (currentIndex < images.length - 1) {
      currentIndex++;
    }
  }
  
  function prev() {
    if (currentIndex > 0) {
      currentIndex--;
    }
  }
  
  function handleKeydown(e) {
    if (e.key === 'Escape') handleClose();
    if (e.key === 'ArrowRight') next();
    if (e.key === 'ArrowLeft') prev();
  }
  
  onMount(() => {
    // Prevent background scrolling
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    
    if (lightboxEl) {
      lightboxEl.focus();
    }
    
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  });
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div 
  class="fixed inset-0 z-[100] bg-black/90 flex flex-col backdrop-blur-sm outline-none"
  transition:fade={{ duration: 200 }}
  on:click={handleClose}
  on:keydown={handleKeydown}
  tabindex="-1"
  bind:this={lightboxEl}
>
  <!-- Header -->
  <div class="flex items-center justify-between p-[var(--space-md)] text-white absolute top-0 left-0 right-0 z-10" on:click|stopPropagation>
    <div class="text-[var(--font-size-sm)] font-bold">
      {currentIndex + 1} of {images.length}
    </div>
    
    <div class="flex items-center gap-[var(--space-sm)]">
      <a 
        href={images[currentIndex]?.url} 
        download={`image_${images[currentIndex]?.id}.jpg`}
        class="w-[44px] h-[44px] rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 text-white cursor-pointer transition-colors"
        aria-label="Download image"
        title="Download"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
      </a>
      
      <button 
        type="button"
        class="w-[44px] h-[44px] rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 text-white cursor-pointer transition-colors border-none p-0"
        on:click|stopPropagation={handleClose}
        aria-label="Close lightbox"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  </div>
  
  <!-- Image Container -->
  <div class="flex-1 flex items-center justify-center p-[var(--space-md)] overflow-hidden relative" on:click|stopPropagation>
    {#key currentIndex}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
      <img 
        src={images[currentIndex]?.url} 
        alt="Enlarged attachment" 
        class="max-w-full max-h-[85vh] object-contain shadow-2xl"
        transition:scale={{ duration: 250, start: 0.95 }}
        on:click={next}
      />
    {/key}
    
    <!-- Navigation Buttons -->
    {#if currentIndex > 0}
      <button 
        type="button"
        class="absolute left-[var(--space-md)] top-1/2 -translate-y-1/2 w-[44px] h-[44px] rounded-full flex items-center justify-center bg-black/50 hover:bg-black/80 text-white cursor-pointer transition-colors border-none p-0"
        on:click|stopPropagation={prev}
        aria-label="Previous image"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </button>
    {/if}
    
    {#if currentIndex < images.length - 1}
      <button 
        type="button"
        class="absolute right-[var(--space-md)] top-1/2 -translate-y-1/2 w-[44px] h-[44px] rounded-full flex items-center justify-center bg-black/50 hover:bg-black/80 text-white cursor-pointer transition-colors border-none p-0"
        on:click|stopPropagation={next}
        aria-label="Next image"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </button>
    {/if}
  </div>
</div>
