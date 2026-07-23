<script>
  import { createEventDispatcher } from 'svelte';
  import { imageRecents } from '$lib/stores/imageRecents.js';
  import { getImageAttachment } from '$lib/services/db/imageAttachments.db.js';
  import ImagePickerItem from './ImagePickerItem.svelte';
  
  /** @type {File[]} */
  export let selectedFiles = [];
  export let maxImages = 4;
  
  const dispatch = createEventDispatcher();
  
  // Cache to store created File objects so reference equality works for selection
  let fileCache = new Map(); // transferId -> File
  let loadingBlobs = new Set();
  
  $: {
    for (const recent of $imageRecents) {
      if (!fileCache.has(recent.transferId) && !loadingBlobs.has(recent.transferId)) {
        loadingBlobs.add(recent.transferId);
        getImageAttachment(recent.transferId).then(blob => {
          if (blob) {
            const file = new File([blob], recent.filename || 'image.jpg', { type: recent.mimeType || blob.type });
            // Tag the file so we know it came from here, helpful for UI matching
            file._sourceId = recent.transferId;
            fileCache.set(recent.transferId, file);
            fileCache = fileCache; // trigger reactivity
          }
          loadingBlobs.delete(recent.transferId);
        }).catch(err => {
          console.error('Failed to load recent image blob', err);
          loadingBlobs.delete(recent.transferId);
        });
      }
    }
  }
  
  function handleToggle(recent) {
    const file = fileCache.get(recent.transferId);
    if (!file) return;
    dispatch('toggleFile', { file });
  }
  
  // Check if a recent entry is currently selected
  function isSelected(recent) {
    const cachedFile = fileCache.get(recent.transferId);
    if (!cachedFile) return false;
    return selectedFiles.some(f => f === cachedFile || f._sourceId === recent.transferId);
  }
</script>

<div class="flex items-center gap-[var(--space-sm)] overflow-x-auto p-[var(--space-sm)] snap-x">
  {#if $imageRecents.length === 0}
    <div class="text-[var(--font-size-sm)] text-[var(--text-muted)] p-[var(--space-md)] italic whitespace-nowrap">
      Your recently sent images appear here.
    </div>
  {:else}
    {#each $imageRecents as recent (recent.transferId)}
      <div class="w-[80px] h-[80px] flex-shrink-0 snap-start">
        <ImagePickerItem 
          file={fileCache.get(recent.transferId) || null}
          selected={isSelected(recent)}
          disabled={!isSelected(recent) && selectedFiles.length >= maxImages}
          on:toggle={() => handleToggle(recent)}
        />
      </div>
    {/each}
  {/if}
  
  <button 
    type="button"
    class="flex-shrink-0 flex flex-col items-center justify-center w-[80px] h-[80px] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-overlay)] text-[var(--text-secondary)] snap-start cursor-pointer transition-colors"
    on:click={() => dispatch('browse')}
  >
    <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
    </svg>
    <span class="text-[10px] uppercase font-bold">Browse</span>
  </button>
</div>
