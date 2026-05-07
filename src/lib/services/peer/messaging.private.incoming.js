import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import {
  addIncomingMessage,
  cascadeUpdateCitations as cascadePrivateCitations,
  deleteMessage as deletePrivateMessageInStore,
  decryptSealedMessages,
  markDelivered,
  privateChatStore,
  setKeyExchangeState,
  updateMessage as updatePrivateMessageInStore,
  upsertChatEntry
} from '$lib/stores/privateChatStore.js';
import {
  db,
  getPrivateChat,
  markMessageDelivered,
  savePrivateMessage as saveEncryptedPrivateMessage,
  updateChatMeta,
  updatePrivateMessage,
  upsertPrivateChat
} from '$lib/services/db.js';
import {
  buildSessionId,
  completeSession,
  createSession,
  decryptForSession,
  isSessionActive,
  resumeSession
} from '$lib/services/crypto.js';
import { decodePrivateBody } from '$lib/utils/privateMessageCodec.js';

import {
  avatarCache,
  buildDirectMessage,
  confirmPrivateSession,
  decryptFailurePlaceholder,
  isSessionKeyMismatch,
  sendToPeer,
  clearKeyExchangeTimeout
} from './shared.js';
import { flushQueueForPeer, persistPrivateCitationCascade } from './queue.js';

export async function handleIncomingKeyExchange(msg, profile) {
  const myPeerId = get(peerStore).peerId;
  if (!myPeerId) return;
  if (msg.to !== myPeerId) return;

  const theirPeerId = msg.from.peerId;
  const myUsername = profile?.username ?? null;
  const theirUsername = msg.from.username;
  if (!myUsername || myUsername === 'pre-registration' || !theirUsername) return;

  const publicKeyBase64 = msg.payload?.publicKeyBase64;
  if (typeof publicKeyBase64 !== 'string' || publicKeyBase64.length === 0) return;

  const chatId = buildSessionId(myUsername, theirUsername);
  clearKeyExchangeTimeout(chatId);
  setKeyExchangeState(chatId, 'completing');

  try {
    await createSession(myUsername, theirUsername);
  } catch (err) {
    console.error('createSession (receiver) failed', err);
    setKeyExchangeState(chatId, 'failed');
    return;
  }

  /** @type {string|null} */
  let ackPublicKeyBase64;
  try {
    const res = await completeSession(myUsername, theirUsername, publicKeyBase64);
    ackPublicKeyBase64 = typeof res?.publicKeyBase64 === 'string' ? res.publicKeyBase64 : null;
  } catch (err) {
    console.error('completeSession (receiver) failed', err);
    setKeyExchangeState(chatId, 'failed');
    return;
  }

  setKeyExchangeState(chatId, 'active');
  confirmPrivateSession(chatId);
  await decryptSealedMessages(chatId, chatId);
  await flushQueueForPeer(theirPeerId);

  if (ackPublicKeyBase64) {
    sendToPeer(
      theirPeerId,
      buildDirectMessage('PRIVATE_KEY_EXCHANGE_ACK', myPeerId, profile, theirPeerId, { publicKeyBase64: ackPublicKeyBase64 })
    );
  }
}

export async function handleIncomingKeyExchangeAck(msg, profile) {
  const myPeerId = get(peerStore).peerId;
  if (!myPeerId) return;
  if (msg.to !== myPeerId) return;

  const theirPeerId = msg.from.peerId;
  const myUsername = profile?.username ?? null;
  const theirUsername = msg.from.username;
  if (!myUsername || myUsername === 'pre-registration' || !theirUsername) return;

  const publicKeyBase64 = msg.payload?.publicKeyBase64;
  if (typeof publicKeyBase64 !== 'string' || publicKeyBase64.length === 0) return;

  const chatId = buildSessionId(myUsername, theirUsername);
  clearKeyExchangeTimeout(chatId);
  try {
    await completeSession(myUsername, theirUsername, publicKeyBase64);
  } catch (err) {
    console.error('completeSession (initiator) failed', err);
    setKeyExchangeState(chatId, 'failed');
    return;
  }
  setKeyExchangeState(chatId, 'active');
  confirmPrivateSession(chatId);
  await decryptSealedMessages(chatId, chatId);
  await flushQueueForPeer(theirPeerId);
}

export async function handleIncomingPrivateMessage(msg, profile) {
  const myPeerId = get(peerStore).peerId;
  if (!myPeerId) return;
  if (msg.to !== myPeerId) return;

  const theirPeerId = msg.from.peerId;
  const myUsername = profile?.username ?? null;
  const theirUsername = msg.from.username;
  if (!myUsername || myUsername === 'pre-registration' || !theirUsername) return;

  const ciphertext = msg.payload?.ciphertext;
  const iv = msg.payload?.iv;
  const messageId = msg.payload?.messageId;
  const repliesEnc = msg.payload?.replies ?? null;
  if (typeof ciphertext !== 'string' || typeof iv !== 'string') return;
  if (typeof messageId !== 'string' || messageId.length === 0) return;

  const chatId = buildSessionId(myUsername, theirUsername);
  const cachedAvatar = get(avatarCache).get(theirPeerId) ?? get(peerStore).connectedPeers.get(theirPeerId)?.avatarBase64 ?? null;

  const now = Date.now();
  const existing = await getPrivateChat(chatId);
  await upsertPrivateChat({
    ...(existing ?? {}),
    id: chatId,
    myPeerId,
    myUsername,
    theirPeerId,
    theirUsername,
    theirColor: msg.from.color,
    theirAvatarBase64: cachedAvatar,
    theirDateOfBirth: msg.from.dateOfBirth ?? null,
    createdAt: existing?.createdAt ?? now,
    lastActivity: msg.timestamp ?? now,
    lastMessagePreview: existing?.lastMessagePreview ?? null,
    unreadCount: typeof existing?.unreadCount === 'number' ? existing.unreadCount : 0
  });

  upsertChatEntry({
    id: chatId,
    theirPeerId,
    theirUsername: msg.from.username,
    theirColor: msg.from.color,
    theirAvatarBase64: cachedAvatar,
    theirDateOfBirth: msg.from.dateOfBirth ?? null,
    lastActivity: msg.timestamp ?? now
  });

  let sealed = true;
  let text = '🔒 Encrypted message';
  let editedAt = null;
  let replies = null;
  const repliesCiphertext = typeof repliesEnc?.ciphertext === 'string' ? repliesEnc.ciphertext : null;
  const repliesIv = typeof repliesEnc?.iv === 'string' ? repliesEnc.iv : null;

  if (isSessionActive(chatId)) {
    try {
      const raw = await decryptForSession(chatId, ciphertext, iv);
      const decoded = decodePrivateBody(raw);
      text = decoded.text;
      editedAt = decoded.editedAt;
      sealed = false;
    } catch (err) {
      text = decryptFailurePlaceholder(err);
      if (!isSessionKeyMismatch(err)) console.error('PRIVATE_MSG decrypt failed', err);
    }
    if (!sealed && repliesCiphertext && repliesIv) {
      try {
        const raw = await decryptForSession(chatId, repliesCiphertext, repliesIv);
        const parsed = JSON.parse(raw);
        replies = Array.isArray(parsed) ? parsed : null;
      } catch {
        replies = null;
      }
    }
  }

  try {
    await saveEncryptedPrivateMessage({
      id: messageId,
      chatId,
      direction: 'received',
      ciphertext,
      iv,
      replies: repliesCiphertext && repliesIv ? { ciphertext: repliesCiphertext, iv: repliesIv } : null,
      timestamp: msg.timestamp ?? now,
      delivered: true,
      editedAt,
      deleted: false
    });
  } catch (err) {
    console.error('savePrivateMessage failed', err);
  }

  addIncomingMessage(chatId, {
    id: messageId,
    text,
    replies,
    ciphertext,
    iv,
    repliesCiphertext,
    repliesIv,
    sealed,
    timestamp: msg.timestamp ?? now,
    editedAt,
    deleted: false
  });

  try {
    const currentUnread = get(privateChatStore).chats.get(chatId)?.unreadCount ?? 0;
    await updateChatMeta(chatId, {
      lastMessagePreview: typeof text === 'string' ? text.slice(0, 40) : null,
      lastActivity: msg.timestamp ?? now,
      unreadCount: currentUnread
    });
  } catch (err) {
    console.error('updateChatMeta failed', err);
  }

  sendToPeer(theirPeerId, buildDirectMessage('PRIVATE_MSG_ACK', myPeerId, profile, theirPeerId, { messageId }, Date.now()));
}

export async function handleIncomingPrivateMessageEdit(msg, profile) {
  const myPeerId = get(peerStore).peerId;
  if (!myPeerId) return;
  if (msg.to !== myPeerId) return;

  const myUsername = profile?.username ?? null;
  const theirUsername = msg.from.username;
  if (!myUsername || myUsername === 'pre-registration' || !theirUsername) return;

  const messageId = String(msg.payload?.messageId ?? '').trim();
  const ciphertext = msg.payload?.ciphertext;
  const iv = msg.payload?.iv;
  const repliesEnc = msg.payload?.replies ?? null;
  const payloadEditedAt = typeof msg.payload?.editedAt === 'number' ? msg.payload.editedAt : null;
  if (!messageId || typeof ciphertext !== 'string' || typeof iv !== 'string') return;

  const chatId = buildSessionId(myUsername, theirUsername);
  const existingRow = await db.privateMessages.get(messageId);
  if (!existingRow || existingRow.chatId !== chatId || existingRow.direction !== 'received' || existingRow.deleted) return;

  try {
    if (!isSessionActive(chatId)) await resumeSession(chatId);
  } catch {
    // ignore
  }
  if (!isSessionActive(chatId)) return;

  let text;
  let editedAt;
  try {
    const raw = await decryptForSession(chatId, ciphertext, iv);
    const decoded = decodePrivateBody(raw);
    text = decoded.text;
    editedAt = decoded.editedAt ?? payloadEditedAt;
  } catch (err) {
    if (!isSessionKeyMismatch(err)) console.error('PRIVATE_MSG_EDIT decrypt failed', err);
    return;
  }

  let replies = null;
  const repliesCiphertext = typeof repliesEnc?.ciphertext === 'string' ? repliesEnc.ciphertext : null;
  const repliesIv = typeof repliesEnc?.iv === 'string' ? repliesEnc.iv : null;
  if (repliesCiphertext && repliesIv) {
    try {
      const raw = await decryptForSession(chatId, repliesCiphertext, repliesIv);
      const parsed = JSON.parse(raw);
      replies = Array.isArray(parsed) ? parsed : null;
    } catch {
      replies = null;
    }
  }

  try {
    await updatePrivateMessage(messageId, {
      ciphertext,
      iv,
      replies: repliesCiphertext && repliesIv ? { ciphertext: repliesCiphertext, iv: repliesIv } : null,
      editedAt: typeof editedAt === 'number' ? editedAt : null,
      deleted: false
    });
  } catch (err) {
    console.error('PRIVATE_MSG_EDIT persist failed', err);
  }

  updatePrivateMessageInStore(
    chatId,
    messageId,
    {
      text: typeof text === 'string' ? text : '🔒 Encrypted message',
      editedAt: typeof editedAt === 'number' ? editedAt : null,
      replies,
      ciphertext,
      iv,
      repliesCiphertext,
      repliesIv,
      sealed: false,
      deleted: false
    },
    'them'
  );
  cascadePrivateCitations(chatId, messageId, { newSnapshot: typeof text === 'string' ? text : '' });
  persistPrivateCitationCascade(chatId, messageId, { newSnapshot: typeof text === 'string' ? text : '' }).catch(() => {});
}

export async function handleIncomingPrivateMessageDelete(msg, profile) {
  const myPeerId = get(peerStore).peerId;
  if (!myPeerId) return;
  if (msg.to !== myPeerId) return;

  const myUsername = profile?.username ?? null;
  const theirUsername = msg.from.username;
  if (!myUsername || myUsername === 'pre-registration' || !theirUsername) return;

  const messageId = String(msg.payload?.messageId ?? '').trim();
  if (!messageId) return;

  const chatId = buildSessionId(myUsername, theirUsername);
  const existingRow = await db.privateMessages.get(messageId);
  if (!existingRow || existingRow.chatId !== chatId || existingRow.direction !== 'received' || existingRow.deleted) return;

  try {
    await updatePrivateMessage(messageId, { deleted: true });
  } catch {
    // ignore
  }

  deletePrivateMessageInStore(chatId, messageId, theirUsername);
  cascadePrivateCitations(chatId, messageId, { deleted: true });
  persistPrivateCitationCascade(chatId, messageId, { deleted: true }).catch(() => {});
}

export async function handleIncomingPrivateMessageAck(msg, profile) {
  const myPeerId = get(peerStore).peerId;
  if (!myPeerId) return;
  if (msg.to !== myPeerId) return;

  const myUsername = profile?.username ?? null;
  const theirUsername = msg.from.username;
  if (!myUsername || myUsername === 'pre-registration') return;
  if (!theirUsername) return;

  const messageId = String(msg.payload?.messageId ?? '').trim();
  if (!messageId) return;

  const chatId = buildSessionId(myUsername, theirUsername);
  markDelivered(chatId, messageId);
  try {
    await markMessageDelivered(messageId);
  } catch (err) {
    console.error('markMessageDelivered failed', err);
  }
}

export async function handleIncomingPrivateChatClosed(msg) {
  const myPeerId = get(peerStore).peerId;
  if (!myPeerId) return;
  if (msg.to !== myPeerId) return;

  const chatId = String(msg.payload?.chatId ?? '').trim();
  if (!chatId) return;
  const sysId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `sys-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  addIncomingMessage(chatId, {
    id: sysId,
    text: `${msg.from.username} has cleared this conversation on their end.`,
    timestamp: msg.timestamp ?? Date.now()
  });
}
