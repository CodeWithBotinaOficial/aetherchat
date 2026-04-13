import { get } from 'svelte/store';
import { tick } from 'svelte';
import { buildSessionId, closeSession } from '$lib/services/crypto.js';
import {
  clearQueuedMessagesForChat,
  clearQueuedActionsForChat,
  deletePrivateChat,
  deleteSessionKeyRing,
  getSessionKeyRing,
  getSentMessagesPlaintext,
  getPrivateChats,
  getPrivateMessages,
  getQueuedMessagesForChat,
  getQueuedActionsForChat,
  saveSessionKeyRing,
  updateChatMeta
} from '$lib/services/db.js';

import { PRIVATE_DELETED_PLACEHOLDER, privateChatStore, withChat } from './state.js';
import { decryptSealedMessages, loadChatMessages } from './actions.messages.js';

const { update } = privateChatStore;

/**
 * Loads chat metadata from DB into the store. Does not load messages yet.
 * @param {string} myPeerId
 */
export async function loadPrivateChats(myPeerId) {
  const chats = await getPrivateChats(myPeerId);
  const chatMap = new Map();

  for (const c of chats) {
    // Best-effort migration: older builds stored session keys under a peerId-based sessionId.
    // When chat IDs became username-based, those keys may still exist but be unreachable, causing
    // "Encrypted in a previous session" forever after restart. If we detect such a legacy ring,
    // copy it to the current chatId once.
    try {
      if (typeof c?.id === 'string' && c.id.includes(':') && c.myPeerId && c.theirPeerId) {
        const legacyId = buildSessionId(c.myPeerId, c.theirPeerId);
        if (legacyId && legacyId !== c.id) {
          const currentRing = await getSessionKeyRing(c.id);
          if (!currentRing?.keys?.length) {
            const legacyRing = await getSessionKeyRing(legacyId);
            if (legacyRing?.keys?.length) {
              await saveSessionKeyRing(c.id, legacyRing.keys);
              await deleteSessionKeyRing(legacyId);
            }
          }
        }
      }
    } catch {
      // ignore (migration is best-effort)
    }

    const dbMessages = await getPrivateMessages(c.id, 50);
    const sentPlain = await getSentMessagesPlaintext(c.id);
    const sentPlainMap = new Map(sentPlain.map((m) => [m.id, m.plaintext]));
    const messages = dbMessages.map((m) => {
      const repliesCiphertext = typeof m?.replies?.ciphertext === 'string' ? m.replies.ciphertext : null;
      const repliesIv = typeof m?.replies?.iv === 'string' ? m.replies.iv : null;
      if (m.direction === 'sent') {
        const plaintext = sentPlainMap.get(m.id);
        const deleted = Boolean(m.deleted);
        return {
          id: m.id,
          direction: 'sent',
          text: deleted ? PRIVATE_DELETED_PLACEHOLDER : plaintext ?? '🔒 Sent message (plaintext not available)',
          ciphertext: m.ciphertext,
          iv: m.iv,
          repliesCiphertext,
          repliesIv,
          replies: null,
          timestamp: m.timestamp,
          delivered: Boolean(m.delivered),
          editedAt: Object.prototype.hasOwnProperty.call(m, 'editedAt') ? (m.editedAt ?? null) : null,
          deleted,
          sealed: false
        };
      }
      const deleted = Boolean(m.deleted);
      return {
        id: m.id,
        direction: 'received',
        text: deleted ? PRIVATE_DELETED_PLACEHOLDER : null,
        ciphertext: m.ciphertext,
        iv: m.iv,
        repliesCiphertext,
        repliesIv,
        replies: null,
        timestamp: m.timestamp,
        delivered: Boolean(m.delivered),
        editedAt: Object.prototype.hasOwnProperty.call(m, 'editedAt') ? (m.editedAt ?? null) : null,
        deleted,
        sealed: true
      };
    });

    const queuedMsgs = await getQueuedMessagesForChat(c.id);
    const queuedInMemory = queuedMsgs.map((m) => ({
      id: m.id,
      direction: 'sent',
      text: m.plaintext,
      ciphertext: null,
      iv: null,
      repliesCiphertext: null,
      repliesIv: null,
      replies: (() => {
        const raw = m?.repliesJson;
        if (typeof raw !== 'string' || raw.trim().length === 0) return null;
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      })(),
      timestamp: m.timestamp,
      delivered: false,
      queued: true,
      editedAt: null,
      deleted: false,
      sealed: false
    }));

    // Load queued edit/delete actions (used to flush once session is confirmed).
    let queuedActions;
    try {
      queuedActions = await getQueuedActionsForChat(c.id);
    } catch {
      queuedActions = [];
    }

    let allMessages = [...messages, ...queuedInMemory].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

    // Apply queued local edits/deletes to the in-memory messages so they survive reloads
    // even when we cannot encrypt/flush yet (e.g. peer offline or session unconfirmed).
    for (const action of queuedActions ?? []) {
      if (!action?.messageId) continue;
      const mid = String(action.messageId);
      const idx = allMessages.findIndex((m) => m?.id === mid && m?.direction === 'sent');
      if (idx < 0) continue;
      const cur = allMessages[idx];
      if (action.kind === 'delete') {
        allMessages = allMessages.slice();
        allMessages[idx] = { ...cur, deleted: true, text: PRIVATE_DELETED_PLACEHOLDER };
        continue;
      }
      if (action.kind === 'edit') {
        const plaintext = typeof action.plaintext === 'string' ? action.plaintext : cur.text;
        const editedAt = typeof action.editedAt === 'number' ? action.editedAt : cur.editedAt ?? null;
        /** @type {any[]|null} */
        let replies = cur.replies ?? null;
        if (typeof action?.repliesJson === 'string' && action.repliesJson.trim().length > 0) {
          try {
            const parsed = JSON.parse(action.repliesJson);
            replies = Array.isArray(parsed) ? parsed : null;
          } catch {
            // keep existing
          }
        } else if (Object.prototype.hasOwnProperty.call(action, 'repliesJson')) {
          replies = null;
        }
        allMessages = allMessages.slice();
        allMessages[idx] = { ...cur, deleted: false, text: plaintext, editedAt, replies };
      }
    }

    chatMap.set(c.id, {
      id: c.id,
      theirPeerId: c.theirPeerId,
      theirUsername: c.theirUsername,
      theirColor: c.theirColor,
      theirAvatarBase64: c.theirAvatarBase64 ?? null,
      messages: allMessages,
      unreadCount: typeof c.unreadCount === 'number' ? c.unreadCount : 0,
      lastMessage: c.lastMessagePreview ?? null,
      lastActivity: c.lastActivity ?? c.createdAt ?? Date.now(),
      isOnline: false,
      keyExchangeState: 'idle',
      pendingReplies: [],
      queuedActions,
      __loaded: true
    });
  }

  update((s) => ({ ...s, chats: chatMap }));
}

/**
 * @param {string} chatId
 */
export function openChat(chatId) {
  update((s) => {
    const next = new Map(s.chats);
    const chat = next.get(chatId);
    if (chat) next.set(chatId, { ...chat, unreadCount: 0 });
    return { ...s, chats: next, activeChatId: chatId };
  });

  // Lazily load messages on first open. sessionId === chatId by design.
  const state = get(privateChatStore);
  const chat = state.chats.get(chatId);
  if (chat && !chat.__loaded) {
    loadChatMessages(chatId, chatId).catch((err) => console.error('loadChatMessages failed', err));
  }
  // Best-effort: attempt to decrypt any sealed messages. decryptForSession will
  // transparently resume the key ring from storage when available.
  decryptSealedMessages(chatId, chatId).catch((err) => console.error('decryptSealedMessages failed', err));

  // Persist unreadCount reset.
  updateChatMeta(chatId, { unreadCount: 0 }).catch((err) => console.error('updateChatMeta failed', err));
}

export function closeChat() {
  update((s) => ({ ...s, activeChatId: null }));
}

export function upsertChatEntry(entry) {
  withChat((chats) => {
    const prev = chats.get(entry.id);
    chats.set(entry.id, {
      ...(prev ?? {
        messages: [],
        unreadCount: 0,
        lastMessage: null,
        isOnline: false,
        keyExchangeState: 'idle',
        pendingReplies: [],
        __loaded: false
      }),
      // Back-compat: ensure pendingReplies always exists so UI doesn't need null checks.
      pendingReplies: Array.isArray(prev?.pendingReplies) ? prev.pendingReplies : [],
      ...entry
    });
  });
}

export async function deleteChatFromStore(chatId) {
  // STEP 1: close the active chat first so derived stores compute null cleanly.
  update((s) => ({ ...s, activeChatId: s.activeChatId === chatId ? null : s.activeChatId }));

  // STEP 2: allow Svelte to flush before removing the chat from the Map.
  await tick();

  // STEP 3: remove from in-memory store.
  update((s) => {
    const next = new Map(s.chats);
    next.delete(chatId);
    return { ...s, chats: next };
  });

  // STEP 4: delete persisted data (best effort; never crash the UI on failure).
  try {
    await deletePrivateChat(chatId);
    await clearQueuedMessagesForChat(chatId);
    await clearQueuedActionsForChat(chatId);
  } catch (err) {
    console.error('Failed to delete private chat from DB', err);
  }

  // STEP 5: clear crypto session so GC can collect CryptoKey objects.
  try {
    closeSession(chatId);
  } catch {
    // Best-effort cleanup; ignore.
    void 0;
  }
}
