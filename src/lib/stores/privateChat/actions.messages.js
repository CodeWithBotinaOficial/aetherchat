import { get } from 'svelte/store';
import { decryptForSession, isSessionActive, resumeSession } from '$lib/services/crypto.js';
import { decodePrivateBody } from '$lib/utils/privateMessageCodec.js';
import { getPrivateMessages } from '$lib/services/db.js';

import { PRIVATE_DELETED_PLACEHOLDER, privateChatStore, withChat } from './state.js';

const { update } = privateChatStore;

function isSessionKeyMismatch(err) {
  // WebCrypto AES-GCM authentication failures typically surface as OperationError.
  return err?.name === 'OperationError';
}

function decryptFailurePlaceholder(err) {
  if (isSessionKeyMismatch(err)) return '🔒 Encrypted in a previous session';
  if (String(err?.message ?? '').includes('No active session')) return '🔒 Encrypted message (no active session)';
  return '🔒 Encrypted message (decryption error)';
}

/**
 * Loads messages from DB and attempts to decrypt using the active session.
 * Undecryptable messages are shown as a placeholder.
 * @param {string} chatId
 * @param {string} sessionId
 */
export async function loadChatMessages(chatId, sessionId) {
  const rows = await getPrivateMessages(chatId, 100);
  const canDecrypt = isSessionActive(sessionId);

  const decrypted = await Promise.all(
    rows.map(async (m) => {
      let text = '🔒 Encrypted message — start a new session to decrypt';
      let editedAt = Object.prototype.hasOwnProperty.call(m, 'editedAt') ? (m.editedAt ?? null) : null;
      /** @type {any[]|null} */
      let replies = null;
      if (canDecrypt) {
        try {
          const raw = await decryptForSession(sessionId, m.ciphertext, m.iv);
          const decoded = decodePrivateBody(raw);
          text = decoded.text;
          editedAt = decoded.editedAt ?? editedAt;
        } catch {
          // keep placeholder
        }
        if (typeof m?.replies?.ciphertext === 'string' && typeof m?.replies?.iv === 'string') {
          try {
            const raw = await decryptForSession(sessionId, m.replies.ciphertext, m.replies.iv);
            const parsed = JSON.parse(raw);
            replies = Array.isArray(parsed) ? parsed : null;
          } catch {
            // ignore
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
        deleted: Boolean(m.deleted),
        sealed: !canDecrypt && m.direction !== 'sent'
      };
    })
  );

  withChat((chats) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    const last = decrypted[decrypted.length - 1];
    chats.set(chatId, {
      ...chat,
      messages: decrypted,
      __loaded: true,
      lastMessage: canDecrypt ? (last?.text ?? null) : null
    });
  });
}

export async function decryptSealedMessages(chatId, sessionId) {
  const chat = get(privateChatStore).chats.get(chatId);
  if (!chat) return;

  // Best-effort: load the persisted key ring so previously-received messages can
  // decrypt after a browser restart (Phase 9).
  try {
    await resumeSession(sessionId);
  } catch {
    // ignore
  }

  const decrypted = await Promise.all(
    chat.messages.map(async (m) => {
      // Deleted messages always render the placeholder; no need to decrypt.
      if (m?.deleted) return { ...m, text: PRIVATE_DELETED_PLACEHOLDER, sealed: false };

      // Only attempt to decrypt received sealed messages.
      const hasRepliesCipher = typeof m?.repliesCiphertext === 'string' && typeof m?.repliesIv === 'string';

      // Decrypt message text (received sealed) when possible.
      if (m?.sealed && m.direction !== 'sent' && typeof m.ciphertext === 'string' && typeof m.iv === 'string') {
        try {
          const rawText = await decryptForSession(sessionId, m.ciphertext, m.iv);
          const decoded = decodePrivateBody(rawText);
          // If we can decrypt the message, also try decrypting replies.
          let replies = m?.replies ?? null;
          if (hasRepliesCipher) {
            try {
              const raw = await decryptForSession(sessionId, m.repliesCiphertext, m.repliesIv);
              const parsed = JSON.parse(raw);
              replies = Array.isArray(parsed) ? parsed : null;
            } catch {
              // ignore
            }
          }
          return { ...m, text: decoded.text, editedAt: decoded.editedAt ?? (m.editedAt ?? null), replies, sealed: false };
        } catch (err) {
          if (!isSessionKeyMismatch(err)) {
            console.error(
              'decryptSealedMessages decrypt failed:',
              err?.message ?? String(err),
              { chatId, messageId: m?.id ?? null, sessionId }
            );
          }
          // Keep sealed so we can retry later (e.g. after a key ring resumes from storage).
          return { ...m, text: decryptFailurePlaceholder(err), sealed: true };
        }
      }

      // Decrypt replies for already-readable messages (sent plaintext copy, or received already decrypted).
      if (m?.sealed) return m;
      if (!hasRepliesCipher) return m;
      try {
        const raw = await decryptForSession(sessionId, m.repliesCiphertext, m.repliesIv);
        const parsed = JSON.parse(raw);
        const replies = Array.isArray(parsed) ? parsed : null;
        return { ...m, replies };
      } catch (err) {
        if (!isSessionKeyMismatch(err)) {
          console.error(
            'decryptSealedMessages replies decrypt failed:',
            err?.message ?? String(err),
            { chatId, messageId: m?.id ?? null, sessionId }
          );
        }
        return m;
      }
    })
  );

  withChat((chats) => {
    const curr = chats.get(chatId);
    if (!curr) return;
    chats.set(chatId, { ...curr, messages: decrypted });
  });
}

export function addOutgoingMessage(chatId, { id, text, timestamp, replies = null }) {
  withChat((chats) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    const messages = [
      ...chat.messages,
      { id, direction: 'sent', text, replies, timestamp, delivered: false, queued: false, editedAt: null, deleted: false, sealed: false }
    ];
    chats.set(chatId, { ...chat, messages, lastMessage: text, lastActivity: timestamp });
  });
}

export function addIncomingMessage(
  chatId,
  { id, text, timestamp, replies = null, ciphertext = null, iv = null, sealed = false, repliesCiphertext = null, repliesIv = null, editedAt = null, deleted = false }
) {
  update((s) => {
    const next = new Map(s.chats);
    const chat = next.get(chatId);
    if (!chat) return s;

    const messages = [
      ...chat.messages,
      { id, direction: 'received', text, replies, ciphertext, iv, repliesCiphertext, repliesIv, timestamp, delivered: true, editedAt, deleted: Boolean(deleted), sealed: Boolean(sealed) }
    ];
    const unreadInc = s.activeChatId === chatId ? 0 : 1;
    next.set(chatId, {
      ...chat,
      messages,
      lastMessage: text,
      lastActivity: timestamp,
      unreadCount: (chat.unreadCount ?? 0) + unreadInc
    });
    return { ...s, chats: next };
  });
}

export function prependMessages(chatId, messages) {
  withChat((chats) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    const next = [...messages, ...chat.messages];
    chats.set(chatId, { ...chat, messages: next });
  });
}

export function markDelivered(chatId, messageId) {
  withChat((chats) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    const messages = chat.messages.map((m) => (m.id === messageId ? { ...m, delivered: true } : m));
    chats.set(chatId, { ...chat, messages });
  });
}

export function updateMessageQueued(chatId, messageId, queued) {
  withChat((chats) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    const messages = chat.messages.map((m) => (m.id === messageId ? { ...m, queued: Boolean(queued) } : m));
    chats.set(chatId, { ...chat, messages });
  });
}
