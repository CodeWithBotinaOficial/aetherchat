<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { db } from '$lib/services/db/schema.js';
  import { pickImageFiles } from '$lib/utils/imageFileInput.js';
  import ImagePickerItem from './ImagePickerItem.svelte';
  
  /** @type {File[]} */
  export let selectedFiles = [];
  export let maxImages = 4;
  
  const dispatch = createEventDispatcher();
  
  let dbImages = [];
  const fileCache = new SvelteMap(); // transferId -> File
  
  onMount(async () => {
    try {
      // Not a full native gallery, only previously sent/received images stored in IndexedDB.
      // Real device photo library requires native app or File System Access API.
      const records = await db.imageAttachments.orderBy('storedAt').reverse().limit(100).toArray();
      dbImages = records.map(rec => {
        // Handle ArrayBuffer to Blob reconstruction
        if (rec.data && !(rec.data instanceof Blob)) {
          try {
            rec.blob = new Blob([rec.data], { type: rec.mimeType || 'application/octet-stream' });
          } catch {
            rec.blob = new Blob([], { type: rec.mimeType || 'application/octet-stream' });
          }
        } else if (!rec.blob) {
          rec.blob = new Blob([], { type: rec.mimeType || 'application/octet-stream' });
        }
        return rec;
      });
    } catch (err) {
      console.error('Failed to load gallery images', err);
    }
  });
  
  function handleToggle(rec) {
    if (!fileCache.has(rec.transferId)) {
      const file = new File([rec.blob], rec.filename || 'image.jpg', { type: rec.mimeType || rec.blob.type });
      file._sourceId = rec.transferId;
      fileCache.set(rec.transferId, file);
    }
    const file = fileCache.get(rec.transferId);
    dispatch('toggleFile', { file });
  }
  
  function isSelected(rec) {
    const cached = fileCache.get(rec.transferId);
    if (!cached) return false;
    return selectedFiles.some(f => f === cached || f._sourceId === rec.transferId);
  }
  
  async function handleBrowseDevice() {
    const remaining = maxImages - selectedFiles.length;
    if (remaining <= 0) return;
    
    const { valid, errors } = await pickImageFiles({ multiple: true, maxImages: remaining });
    
    if (errors.length > 0) {
      dispatch('error', { errors });
    }
    
    if (valid.length > 0) {
      dispatch('addFiles', { files: valid });
    }
  }
</script>

<!-- Note: This component is shown as full screen overlay on mobile and absolute positioned inside picker on desktop -->
<div class="fixed inset-0 z-50 bg-[var(--bg-surface)] flex flex-col md:absolute md:inset-0">
  <div class="flex items-center justify-between p-[var(--space-md)] border-b border-[var(--border)]">
    <h2 class="text-[var(--font-size-md)] font-bold m-0 text-[var(--text-primary)]">Gallery</h2>
    <div class="flex items-center gap-[var(--space-sm)]">
      <button 
        type="button"
        class="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-[var(--space-md)] py-[var(--space-sm)] text-[var(--font-size-sm)] text-[var(--text-primary)] hover:bg-[var(--bg-overlay)] cursor-pointer"
        on:click={handleBrowseDevice}
      >
        Device Files
      </button>
      <button 
        type="button"
        class="w-[32px] h-[32px] rounded-full flex items-center justify-center bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-primary)] cursor-pointer"
        on:click={() => dispatch('close')}
        aria-label="Close gallery"
      >
        ×
      </button>
    </div>
  </div>
  
  <div class="flex-1 overflow-y-auto p-[var(--space-md)]">
    {#if dbImages.length === 0}
      <div class="text-center text-[var(--text-muted)] mt-10 text-[var(--font-size-sm)]">
        No recent images found in database.
        <br>
        <button type="button" class="mt-4 text-[var(--accent)] hover:underline cursor-pointer bg-transparent border-none p-0" on:click={handleBrowseDevice}>
          Browse from device
        </button>
      </div>
    {:else}
      <div class="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-[var(--space-xs)]">
        {#each dbImages as rec (rec.transferId)}
          <ImagePickerItem
            blob={rec.blob}
            selected={isSelected(rec)}
            disabled={!isSelected(rec) && selectedFiles.length >= maxImages}
            on:toggle={() => handleToggle(rec)}
          />
        {/each}
      </div>
    {/if}
  </div>
</div>
