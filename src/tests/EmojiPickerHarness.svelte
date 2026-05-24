<script>
  import ChatInput from '$lib/components/ChatInput.svelte';
  import EmojiPicker from '$lib/components/emojiPicker/EmojiPicker.svelte';
  import { insertEmojiAtCursor } from '$lib/utils/emojiInserter.js';
  import { addRecentEmoji } from '$lib/stores/emojiRecents.js';

  export let mediaOpen = false;
  export let emojiOpen = false;
  export let value = '';

  /** @type {HTMLTextAreaElement|null} */
  let textareaRef = null;

  function onEmojiPick(ev) {
    const char = String(ev?.detail?.char ?? '');
    if (!char || !textareaRef) return;
    insertEmojiAtCursor(textareaRef, char);
    addRecentEmoji(char);
    textareaRef.focus?.();
  }
</script>

<div>
  {#if emojiOpen}
    <EmojiPicker open={emojiOpen} on:pick={onEmojiPick} on:close={() => (emojiOpen = false)} />
  {/if}

  {#if mediaOpen}
    <div data-testid="media-picker">media picker</div>
  {/if}

  <ChatInput
    bind:value
    bind:textareaRef
    mediaItems={[]}
    on:toggleEmojiPicker={() => {
      mediaOpen = false;
      emojiOpen = !emojiOpen;
    }}
    on:toggleMediaPicker={() => {
      emojiOpen = false;
      mediaOpen = !mediaOpen;
    }}
    on:send={() => {
      emojiOpen = false;
    }}
  />
</div>

