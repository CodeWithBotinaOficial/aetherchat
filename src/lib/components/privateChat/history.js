import { decryptForSession, isSessionActive } from '$lib/services/crypto.js';
import { getPrivateMessagesPage } from '$lib/services/db.js';
import { showToast } from '$lib/stores/toastStore.js';
import { cssEscape } from '$lib/utils/replies.js';
import { decodePrivateBody } from '$lib/utils/privateMessageCodec.js';

/**
 * Loads older messages for the active private chat and prepends them to the in-memory store.
 *
 * @param {{
 *   chat: any,
 *   hasMore: boolean,
 *   setHasMore: (next: boolean) => void,
 *   setLoadingOlder: (next: boolean) => void,
 *   prependMessages: (chatId: string, messages: any[]) => void,
 * }} opts
 */
export async function loadOlderPrivateMessages(opts) {
  const chat = opts.chat;
  if (!chat) return;
  if ((chat.messages ?? []).length === 0) return;
  if (!opts.hasMore) return;

  opts.setLoadingOlder(true);

  const oldest = chat.messages[0]?.timestamp ?? Date.now();
  const page = await getPrivateMessagesPage(chat.id, oldest, 50);
  if (page.length === 0) {
    opts.setHasMore(false);
    opts.setLoadingOlder(false);
    return;
  }

  const canDecrypt = isSessionActive(chat.id);
  const decrypted = await Promise.all(
    page.map(async (m) => {
      const deleted = Boolean(m?.deleted);
      let text = deleted ? '[ This message was deleted ]' : '🔒 Encrypted message — start a new session to decrypt';
      let editedAt = Object.prototype.hasOwnProperty.call(m, 'editedAt') ? (m.editedAt ?? null) : null;
      /** @type {any[]|null} */
      let replies = null;

      if (canDecrypt && !deleted) {
        try {
          const raw = await decryptForSession(chat.id, m.ciphertext, m.iv);
          const decoded = decodePrivateBody(raw);
          text = decoded.text;
          editedAt = decoded.editedAt ?? editedAt;
        } catch (err) {
          if (err?.name !== 'OperationError') console.error('loadOlder decrypt failed:', err?.message ?? String(err));
        }

        if (typeof m?.replies?.ciphertext === 'string' && typeof m?.replies?.iv === 'string') {
          try {
            const raw = await decryptForSession(chat.id, m.replies.ciphertext, m.replies.iv);
            const parsed = JSON.parse(raw);
            replies = Array.isArray(parsed) ? parsed : null;
          } catch (err) {
            if (err?.name !== 'OperationError') console.error('loadOlder replies decrypt failed:', err?.message ?? String(err));
          }
        }
      }

      return {
        id: m.id,
        direction: m.direction,
        text,
        replies,
        repliesCiphertext: typeof m?.replies?.ciphertext === 'string' ? m.replies.ciphertext : null,
        repliesIv: typeof m?.replies?.iv === 'string' ? m.replies.iv : null,
        timestamp: m.timestamp,
        delivered: Boolean(m.delivered),
        editedAt,
        deleted,
        sealed: !canDecrypt && m.direction !== 'sent'
      };
    })
  );

  opts.prependMessages(chat.id, decrypted);
  opts.setLoadingOlder(false);
}

/**
 * Scrolls to a message, loading older pages as needed.
 *
 * @param {{
 *   listEl: HTMLDivElement|null,
 *   chat: any,
 *   messageId: string,
 *   getHasMore: () => boolean,
 *   loadOlder: () => Promise<void>,
 * }} opts
 */
export async function scrollToAndHighlightPrivateMessage(opts) {
  const id = String(opts?.messageId ?? '').trim();
  if (!id || !opts.listEl) return;

  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  const tryFindEl = () => opts.listEl?.querySelector?.(`[data-message-id="${cssEscape(id)}"]`) ?? null;

  let guard = 0;
  while (!((opts.chat?.messages ?? []).some((m) => m?.id === id)) && opts.getHasMore() && guard < 12) {
    guard += 1;
    await opts.loadOlder();
    await Promise.resolve();
  }

  if (!((opts.chat?.messages ?? []).some((m) => m?.id === id))) {
    showToast('Original message not available.');
    return;
  }

  const el = tryFindEl();
  if (!el) {
    await Promise.resolve();
  }
  const el2 = tryFindEl();
  if (!el2) {
    showToast('Original message not available.');
    return;
  }

  el2.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'center' });
  if (prefersReduced) return;
  el2.classList.add('aether-highlight');
  setTimeout(() => el2.classList.remove('aether-highlight'), 1500);
}
