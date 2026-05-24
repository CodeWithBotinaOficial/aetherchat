<script>
  import EmojiPicker from './EmojiPicker.svelte';
  import { insertEmojiAtCursor } from '$lib/utils/emojiInserter.js';
  import { addRecentEmoji } from '$lib/stores/emojiRecents.js';

  export let open = false;
  /** @type {HTMLInputElement | HTMLTextAreaElement | null} */
  export let inputEl = null;

  function onPick(ev) {
    const char = String(ev?.detail?.char ?? '');
    if (!char || !inputEl) return;
    insertEmojiAtCursor(inputEl, char);
    addRecentEmoji(char);
    inputEl.focus?.();
  }
</script>

<EmojiPicker bind:open on:pick={onPick} on:close={() => (open = false)} />

