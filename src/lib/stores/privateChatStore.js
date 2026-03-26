import { derived, get, writable } from 'svelte/store';
import { tick } from 'svelte';
import { buildSessionId, closeSession, decryptForSession, isSessionActive, resumeSession } from '$lib/services/crypto.js';
import { snapshotText } from '$lib/utils/replies.js';
import {
  clearQueuedMessagesForChat,
  deletePrivateChat,
  deleteSessionKeyRing,
  getSessionKeyRing,
  getSentMessagesPlaintext,
  getPrivateChats,
  getPrivateMessages,
  getQueuedMessagesForChat,
  saveSessionKeyRing,
  updateChatMeta
} from '$lib/services/db.js';

// ── State shape ──────────────────────────────────────────────────────────────
// {
//   chats: Map<chatId, ChatEntry>
//   activeChatId: string | null
//   pendingKeyExchanges: Map<peerId, 'waiting_ack'>
// }

/**
 * @typedef {{ messageId: string, authorUsername: string, authorColor: string, textSnapshot: string }} PendingReply
 */

const initialState = {
  chats: new Map(),
  activeChatId: null,
  pendingKeyExchanges: new Map()
};

const { subscribe, update, set } = writable(initialState);
export const privateChatStore = { subscribe, update, set };

function isSessionKeyMismatch(err) {
  // WebCrypto AES-GCM authentication failures typically surface as OperationError.
  return err?.name === 'OperationError';
}

function decryptFailurePlaceholder(err) {
  if (isSessionKeyMismatch(err)) return '🔒 Encrypted in a previous session';
  if (String(err?.message ?? '').includes('No active session')) return '🔒 Encrypted message (no active session)';
  return '🔒 Encrypted message (decryption error)';
}

// ── Derived stores ───────────────────────────────────────────────────────────

export const chatList = derived(privateChatStore, ($s) => [...$s.chats.values()].sort((a, b) => b.lastActivity - a.lastActivity));

export const activeChat = derived(privateChatStore, ($s) =>
  $s.activeChatId ? $s.chats.get($s.activeChatId) ?? null : null
);

export const totalUnread = derived(privateChatStore, ($s) => [...$s.chats.values()].reduce((sum, c) => sum + c.unreadCount, 0));

function withChat(updateFn) {
  update((s) => {
    const nextChats = new Map(s.chats);
    updateFn(nextChats, s);
    return { ...s, chats: nextChats };
  });
}

// ── Actions ──────────────────────────────────────────────────────────────────

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
        return {
          id: m.id,
          direction: 'sent',
          text: plaintext ?? '🔒 Sent message (plaintext not available)',
          ciphertext: m.ciphertext,
          iv: m.iv,
          repliesCiphertext,
          repliesIv,
          replies: null,
          timestamp: m.timestamp,
          delivered: Boolean(m.delivered),
          sealed: false
        };
      }
      return {
        id: m.id,
        direction: 'received',
        text: null,
        ciphertext: m.ciphertext,
        iv: m.iv,
        repliesCiphertext,
        repliesIv,
        replies: null,
        timestamp: m.timestamp,
        delivered: Boolean(m.delivered),
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
      sealed: false
    }));

    const allMessages = [...messages, ...queuedInMemory].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

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
      /** @type {any[]|null} */
      let replies = null;
      if (canDecrypt) {
        try {
          text = await decryptForSession(sessionId, m.ciphertext, m.iv);
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
        delivered: Boolean(m.delivered)
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
      // Only attempt to decrypt received sealed messages.
      const hasRepliesCipher = typeof m?.repliesCiphertext === 'string' && typeof m?.repliesIv === 'string';

      // Decrypt message text (received sealed) when possible.
      if (m?.sealed && m.direction !== 'sent' && typeof m.ciphertext === 'string' && typeof m.iv === 'string') {
        try {
          const text = await decryptForSession(sessionId, m.ciphertext, m.iv);
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
          return { ...m, text, replies, sealed: false };
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
      { id, direction: 'sent', text, replies, timestamp, delivered: false, queued: false, sealed: false }
    ];
    chats.set(chatId, { ...chat, messages, lastMessage: text, lastActivity: timestamp });
  });
}

export function addIncomingMessage(chatId, { id, text, timestamp, replies = null, ciphertext = null, iv = null, sealed = false, repliesCiphertext = null, repliesIv = null }) {
  update((s) => {
    const next = new Map(s.chats);
    const chat = next.get(chatId);
    if (!chat) return s;

    const messages = [
      ...chat.messages,
      { id, direction: 'received', text, replies, ciphertext, iv, repliesCiphertext, repliesIv, timestamp, delivered: true, sealed: Boolean(sealed) }
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

export function setKeyExchangeState(chatId, state) {
  withChat((chats) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    chats.set(chatId, { ...chat, keyExchangeState: state });
  });
}

export function setChatOnlineStatus(theirPeerId, isOnline) {
  withChat((chats) => {
    for (const [id, chat] of chats.entries()) {
      if (chat.theirPeerId === theirPeerId) chats.set(id, { ...chat, isOnline });
    }
  });
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

export function markChatAsRead(chatId) {
  withChat((chats) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    chats.set(chatId, { ...chat, unreadCount: 0 });
  });
  updateChatMeta(chatId, { unreadCount: 0 }).catch((err) => console.error('updateChatMeta failed', err));
}

/**
 * @param {string} chatId
 * @param {{ id?: string, username?: string, color?: string, text?: string }} message
 */
export function addPendingReply(chatId, message) {
  const cid = String(chatId ?? '').trim();
  if (!cid) return;
  const mid = String(message?.id ?? '').trim();
  if (!mid) return;

  withChat((chats) => {
    const chat = chats.get(cid);
    if (!chat) return;
    /** @type {PendingReply[]} */
    const cur = Array.isArray(chat.pendingReplies) ? chat.pendingReplies : [];
    if (cur.some((r) => r.messageId === mid)) return;
    const next = [
      ...cur,
      {
        messageId: mid,
        authorUsername: String(message?.username ?? '').trim() || 'unknown',
        authorColor: String(message?.color ?? '').trim() || 'hsl(0, 0%, 65%)',
        textSnapshot: snapshotText(message?.text, 120)
      }
    ];
    chats.set(cid, { ...chat, pendingReplies: next });
  });
}

/**
 * @param {string} chatId
 * @param {string} messageId
 */
export function removePendingReply(chatId, messageId) {
  const cid = String(chatId ?? '').trim();
  const mid = String(messageId ?? '').trim();
  if (!cid || !mid) return;
  withChat((chats) => {
    const chat = chats.get(cid);
    if (!chat) return;
    const cur = Array.isArray(chat.pendingReplies) ? chat.pendingReplies : [];
    chats.set(cid, { ...chat, pendingReplies: cur.filter((r) => r.messageId !== mid) });
  });
}

/**
 * @param {string} chatId
 */
export function clearPendingReplies(chatId) {
  const cid = String(chatId ?? '').trim();
  if (!cid) return;
  withChat((chats) => {
    const chat = chats.get(cid);
    if (!chat) return;
    chats.set(cid, { ...chat, pendingReplies: [] });
  });
}
