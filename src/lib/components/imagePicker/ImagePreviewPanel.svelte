<script>
  import { createEventDispatcher, onDestroy } from 'svelte';
  
  /** @type {File[]} */
  export let files = []; 
  
  const dispatch = createEventDispatcher();
  
  let objectUrls = new Map(); // file -> url
  
  function getUrl(file) {
    if (!objectUrls.has(file)) {
      objectUrls.set(file, URL.createObjectURL(file));
    }
    return objectUrls.get(file);
  }
  
  function cleanupUrls(currentFiles) {
    for (const [file, url] of objectUrls.entries()) {
      if (!currentFiles.includes(file)) {
        URL.revokeObjectURL(url);
        objectUrls.delete(file);
      }
    }
  }
  
  $: cleanupUrls(files);
  
  onDestroy(() => {
    for (const url of objectUrls.values()) {
      URL.revokeObjectURL(url);
    }
    objectUrls.clear();
  });
  
  function remove(index) {
    dispatch('remove', { index });
  }
  
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
</script>

<div class="flex gap-[var(--space-sm)] overflow-x-auto p-[var(--space-sm)]">
  {#each files as file, i}
    <div class="relative flex flex-col items-center min-w-[120px] max-w-[120px]">
      <div class="relative w-[120px] h-[120px] rounded-[var(--radius-md)] overflow-hidden border border-[var(--border)] bg-[var(--bg-elevated)]">
        <img src={getUrl(file)} alt="Preview" class="w-full h-full object-cover" />
        <button
          type="button"
          class="absolute top-[4px] right-[4px] w-[24px] h-[24px] flex items-center justify-center rounded-full bg-[rgba(0,0,0,0.6)] text-white hover:bg-[rgba(0,0,0,0.8)] border-none cursor-pointer z-10"
          on:click={() => remove(i)}
          aria-label="Remove image"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="w-full mt-[var(--space-xs)] text-center">
        <div class="text-[var(--font-size-xs)] text-[var(--text-primary)] truncate" title={file.name}>
          {file.name}
        </div>
        <div class="text-[10px] text-[var(--text-muted)] mt-[2px]">
          {formatSize(file.size)}
        </div>
      </div>
    </div>
  {/each}
</div>
