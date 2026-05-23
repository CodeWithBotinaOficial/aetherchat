import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { activeTab } from '$lib/stores/navigationStore.js';
import {
  addOutgoingMessage,
  cascadeUpdateCitations as cascadePrivateCitations,
  deleteChatFromStore,
  deleteMessage as deletePrivateMessageInStore,
  openChat,
  privateChatStore,
  setChatOnlineStatus,
  setKeyExchangeState,
  updateMessage as updatePrivateMessageInStore,
  updateMessageQueued,
  upsertChatEntry
} from '$lib/stores/privateChatStore.js';
import {
  db,
  getPrivateChat,
  savePrivateMessage as saveEncryptedPrivateMessage,
  saveQueuedAction,
  saveQueuedMessage,
  saveSentMessagePlaintext,
  updateChatMeta,
  updatePrivateMessage,
  upsertPrivateChat
} from '$lib/services/db.js';
import { buildSessionId, createSession, encryptForSession, isSessionActive } from '$lib/services/crypto.js';
import { encodePrivateBody } from '$lib/utils/privateMessageCodec.js';

import {
  buildDirectMessage,
  cachedProfile,
  clearKeyExchangeTimeout,
  isPrivateSessionConfirmed,
  sendToPeer,
  startKeyExchangeTimeout,
  userProfileRef
} from './shared.js';
import { flushQueueForPeer, persistPrivateCitationCascade } from './queue.js';

export async function initiatePrivateChat(theirPeerId, theirUsername, theirColor, theirAvatarBase64) {
  const state = get(peerStore);
  const myPeerId = state.peerId;
  const profile = userProfileRef ?? cachedProfile;
  if (!myPeerId || !profile?.username || profile.username === 'pre-registration') return;

  activeTab.set('private');

  const chatId = buildSessionId(profile.username, theirUsername);
  const now = Date.now();

  const storeState = get(privateChatStore);
  const existingChat = storeState.chats.get(chatId) ?? null;
  if (!existingChat) {
    let existingDbChat = null;
    try {
      existingDbChat = await getPrivateChat(chatId);
    } catch (err) {
      console.error('getPrivateChat failed', err);
    }
    if (existingDbChat) {
      upsertChatEntry({
        id: existingDbChat.id,
        theirPeerId: existingDbChat.theirPeerId,
        theirUsername: existingDbChat.theirUsername,
        theirColor: existingDbChat.theirColor,
        theirAvatarBase64: existingDbChat.theirAvatarBase64 ?? null,
        lastActivity: existingDbChat.lastActivity ?? now,
        keyExchangeState: 'idle',
        isOnline: state.connectedPeers.has(theirPeerId)
      });
    } else {
      await upsertPrivateChat({
        id: chatId,
        myPeerId,
        myUsername: profile.username,
        theirPeerId,
        theirUsername,
        theirColor,
        theirAvatarBase64: theirAvatarBase64 ?? null,
        createdAt: now,
        lastActivity: now,
        lastMessagePreview: null,
        unreadCount: 0
      });
      upsertChatEntry({
        id: chatId,
        theirPeerId,
        theirUsername,
        theirColor,
        theirAvatarBase64: theirAvatarBase64 ?? null,
        lastActivity: now,
        keyExchangeState: 'idle',
        isOnline: state.connectedPeers.has(theirPeerId)
      });
    }
  }

  openChat(chatId);
  setChatOnlineStatus(theirPeerId, state.connectedPeers.has(theirPeerId));

  const peerConn = state.connectedPeers.get(theirPeerId)?.connection ?? null;
  if (!peerConn || peerConn.open === false) {
    setKeyExchangeState(chatId, isSessionActive(chatId) ? 'active' : 'idle');
    return;
  }

  if (isSessionActive(chatId) && isPrivateSessionConfirmed(chatId)) {
    setKeyExchangeState(chatId, 'active');
    return;
  }

  setKeyExchangeState(chatId, 'initiated');
  try {
    const { publicKeyBase64 } = await createSession(profile.username, theirUsername);
    startKeyExchangeTimeout(chatId);
    sendToPeer(theirPeerId, buildDirectMessage('PRIVATE_KEY_EXCHANGE', myPeerId, profile, theirPeerId, { publicKeyBase64 }, now));
  } catch (err) {
    console.error('initiatePrivateChat key exchange failed', err);
    clearKeyExchangeTimeout(chatId);
    setKeyExchangeState(chatId, 'failed');
  }
}

export async function sendPrivateMessage(chatId, theirPeerId, plaintext, media = null, replies = null) {
  const state = get(peerStore);
  const myPeerId = state.peerId;
  const profile = userProfileRef ?? cachedProfile;
  const cid = String(chatId ?? '').trim();
  if (!cid || !theirPeerId || !profile || !myPeerId) return;
  if (!profile.username || profile.username === 'pre-registration') return;

  const text = String(plaintext ?? '');
  const trimmed = text.trim();
  const safeMedia = Array.isArray(media) && media.length > 0 ? media.slice(0, 2) : null;
  if (!trimmed && !safeMedia) return;

  const safeReplies = Array.isArray(replies) && replies.length > 0 ? replies : null;
  const messageId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `pm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const timestamp = Date.now();

  addOutgoingMessage(cid, { id: messageId, text: trimmed, media: safeMedia, timestamp, replies: safeReplies });

  const sessionActive = isSessionActive(cid);
  const peerOnline = state.connectedPeers.get(theirPeerId)?.connection?.open === true;

  if (sessionActive && peerOnline && isPrivateSessionConfirmed(cid)) {
    const body = encodePrivateBody(trimmed, safeMedia, null);
    const { ciphertext, iv } = await encryptForSession(cid, body);
    let repliesEnc = null;
    if (safeReplies) {
      try {
        const raw = JSON.stringify(safeReplies);
        const enc = await encryptForSession(cid, raw);
        repliesEnc = { ciphertext: enc.ciphertext, iv: enc.iv };
      } catch (err) {
        console.error('encrypt replies failed', err);
        repliesEnc = null;
      }
    }

    await saveEncryptedPrivateMessage({
      id: messageId,
      chatId: cid,
      direction: 'sent',
      ciphertext,
      iv,
      replies: repliesEnc,
      timestamp,
      delivered: false
    });
    await saveSentMessagePlaintext({ id: messageId, chatId: cid, plaintext: body, timestamp });

    updateChatMeta(cid, { lastMessagePreview: trimmed.slice(0, 40), lastActivity: timestamp }).catch((err) =>
      console.error('updateChatMeta failed', err)
    );

    sendToPeer(theirPeerId, buildDirectMessage('PRIVATE_MSG', myPeerId, profile, theirPeerId, { ciphertext, iv, messageId, replies: repliesEnc }, timestamp));
    return;
  }

  try {
    await saveQueuedMessage({
      id: messageId,
      chatId: cid,
      theirPeerId,
      plaintext: encodePrivateBody(trimmed, safeMedia, null),
      repliesJson: safeReplies ? JSON.stringify(safeReplies) : null,
      timestamp
    });
    updateMessageQueued(cid, messageId, true);
  } catch (err) {
    console.error('saveQueuedMessage failed', err);
  }

  updateChatMeta(cid, { lastMessagePreview: trimmed.slice(0, 40), lastActivity: timestamp }).catch((err) =>
    console.error('updateChatMeta failed', err)
  );
  if (peerOnline) void flushQueueForPeer(theirPeerId);
}

export async function editPrivateMessage(chatId, theirPeerId, messageId, text, media = null, replies = null) {
  const cid = String(chatId ?? '').trim();
  const mid = String(messageId ?? '').trim();
  if (!cid || !mid) return;

  const state = get(peerStore);
  const myPeerId = state.peerId;
  const profile = userProfileRef ?? cachedProfile;
  if (!profile?.username || profile.username === 'pre-registration') return;

  const rawText = String(text ?? '');
  const trimmed = rawText.trim();
  const safeMedia = Array.isArray(media) && media.length > 0 ? media.slice(0, 2) : null;
  if (!trimmed && !safeMedia) return;

  try {
    const row = await db.privateMessages.get(mid);
    if (!row || row.chatId !== cid || row.direction !== 'sent' || row.deleted) return;
  } catch {
    return;
  }

  const safeReplies = Array.isArray(replies) && replies.length > 0 ? replies : null;
  const editedAt = Date.now();

  updatePrivateMessageInStore(cid, mid, { text: trimmed, media: safeMedia, editedAt, replies: safeReplies, deleted: false }, 'me');
  cascadePrivateCitations(cid, mid, { newSnapshot: trimmed });
  persistPrivateCitationCascade(cid, mid, { newSnapshot: trimmed }).catch((err) => console.error('persistPrivateCitationCascade (edit) failed', err));

  try {
    await updatePrivateMessage(mid, { editedAt, deleted: false });
    const row = await db.privateMessages.get(mid);
    const ts = typeof row?.timestamp === 'number' ? row.timestamp : Date.now();
    await saveSentMessagePlaintext({ id: mid, chatId: cid, plaintext: encodePrivateBody(trimmed, safeMedia, editedAt), timestamp: ts });
  } catch (err) {
    console.error('editPrivateMessage persist local failed', err);
  }

  const peerOnline = theirPeerId ? state.connectedPeers.get(theirPeerId)?.connection?.open === true : false;
  const canEncryptNow = isSessionActive(cid) && isPrivateSessionConfirmed(cid) && peerOnline;
  if (!canEncryptNow || !myPeerId || !theirPeerId) {
    try {
      const actionId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `qa-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      await saveQueuedAction({
        id: actionId,
        chatId: cid,
        theirPeerId: String(theirPeerId ?? ''),
        kind: 'edit',
        messageId: mid,
        plaintext: encodePrivateBody(trimmed, safeMedia, editedAt),
        repliesJson: safeReplies ? JSON.stringify(safeReplies) : null,
        editedAt,
        timestamp: Date.now()
      });
    } catch (err) {
      console.error('saveQueuedAction failed', err);
    }
    if (peerOnline && theirPeerId) void flushQueueForPeer(theirPeerId);
    return;
  }

  try {
    const body = encodePrivateBody(trimmed, safeMedia, editedAt);
    const { ciphertext, iv } = await encryptForSession(cid, body);
    let repliesEnc = null;
    if (safeReplies) {
      try {
        const enc = await encryptForSession(cid, JSON.stringify(safeReplies));
        repliesEnc = { ciphertext: enc.ciphertext, iv: enc.iv };
      } catch (err) {
        console.error('encrypt replies failed', err);
        repliesEnc = null;
      }
    }
    await updatePrivateMessage(mid, { ciphertext, iv, replies: repliesEnc, editedAt, deleted: false });
    sendToPeer(theirPeerId, buildDirectMessage('PRIVATE_MSG_EDIT', myPeerId, profile, theirPeerId, { messageId: mid, ciphertext, iv, replies: repliesEnc, editedAt }, Date.now()));
  } catch (err) {
    console.error('editPrivateMessage encrypt/send failed', err);
  }
}

export async function deletePrivateMessage(chatId, theirPeerId, messageId) {
  const cid = String(chatId ?? '').trim();
  const mid = String(messageId ?? '').trim();
  if (!cid || !mid) return;

  const state = get(peerStore);
  const myPeerId = state.peerId;
  const profile = userProfileRef ?? cachedProfile;
  if (!profile?.username || profile.username === 'pre-registration') return;

  try {
    const row = await db.privateMessages.get(mid);
    if (!row || row.chatId !== cid || row.direction !== 'sent' || row.deleted) return;
  } catch {
    return;
  }

  deletePrivateMessageInStore(cid, mid, profile.username);
  cascadePrivateCitations(cid, mid, { deleted: true });
  persistPrivateCitationCascade(cid, mid, { deleted: true }).catch((err) => console.error('persistPrivateCitationCascade (delete) failed', err));

  try {
    await updatePrivateMessage(mid, { deleted: true });
  } catch {
    // ignore
  }

  const peerOnline = theirPeerId ? state.connectedPeers.get(theirPeerId)?.connection?.open === true : false;
  const canSendNow = peerOnline && myPeerId && theirPeerId;
  if (!canSendNow) {
    try {
      const actionId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `qa-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      await saveQueuedAction({
        id: actionId,
        chatId: cid,
        theirPeerId: String(theirPeerId ?? ''),
        kind: 'delete',
        messageId: mid,
        plaintext: null,
        repliesJson: null,
        editedAt: null,
        timestamp: Date.now()
      });
    } catch (err) {
      console.error('saveQueuedAction failed', err);
    }
    if (peerOnline && theirPeerId) void flushQueueForPeer(theirPeerId);
    return;
  }

  sendToPeer(theirPeerId, buildDirectMessage('PRIVATE_MSG_DELETE', myPeerId, profile, theirPeerId, { messageId: mid }, Date.now()));
}

export async function closePrivateChat(chatIdOrTheirPeerId) {
  const state = get(peerStore);
  const myPeerId = state.peerId;
  const rawValue = chatIdOrTheirPeerId;
  const rawStr = String(chatIdOrTheirPeerId ?? '').trim();
  if (!rawStr) return;

  let chatId = null;
  let theirPeerId;

  try {
    const storeChats = get(privateChatStore).chats;
    if (storeChats?.has?.(rawValue)) {
      const entry = storeChats.get(rawValue);
      chatId = rawValue;
      theirPeerId = entry?.theirPeerId ?? null;
    } else if (storeChats?.has?.(rawStr)) {
      const entry = storeChats.get(rawStr);
      chatId = rawStr;
      theirPeerId = entry?.theirPeerId ?? null;
    }
  } catch {
    // ignore
  }

  if (!chatId) {
    try {
      const dbChat = await getPrivateChat(rawStr);
      if (dbChat) {
        chatId = rawStr;
        theirPeerId = dbChat?.theirPeerId ?? null;
      }
    } catch {
      // ignore
    }
  }

  if (!chatId) {
    theirPeerId = rawStr;
    try {
      for (const [id, chat] of get(privateChatStore).chats.entries()) {
        if (chat?.theirPeerId === theirPeerId) {
          chatId = id;
          break;
        }
      }
    } catch {
      // ignore
    }
    if (!chatId) {
      try {
        const row = await db.privateChats.where('theirPeerId').equals(theirPeerId).first();
        if (row?.id) chatId = row.id;
      } catch {
        // ignore
      }
    }
  }
  if (!chatId) return;

  await deleteChatFromStore(chatId);

  if (myPeerId && cachedProfile && theirPeerId && state.connectedPeers.has(theirPeerId)) {
    sendToPeer(theirPeerId, buildDirectMessage('PRIVATE_CHAT_CLOSED', myPeerId, cachedProfile, theirPeerId, { chatId }, Date.now()));
  }
}
