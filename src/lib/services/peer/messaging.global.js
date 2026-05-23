import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import {
  GLOBAL_DELETED_PLACEHOLDER,
  addGlobalMessage,
  cascadeUpdateCitations as cascadeGlobalCitations,
  deleteMessage as deleteGlobalMessageInStore,
  persistMessagePatchWithCascade as persistGlobalPatchWithCascade,
  updateMessage as updateGlobalMessageInStore
} from '$lib/stores/chatStore.js';
import { getGlobalMessage } from '$lib/services/db.js';

import { GLOBAL_EDIT_WINDOW_MS } from './config.js';
import { avatarCache, buildMessage, pendingGlobalActionOutbox, pendingGlobalOutbox, safeSend } from './shared.js';

export async function broadcastGlobalMessage(text, media = null, profile, replies = null) {
  const state = get(peerStore);
  const id = state.peerId;
  if (!id) return;

  const trimmed = String(text ?? '').trim();
  const safeMedia = Array.isArray(media) && media.length > 0 ? media.slice(0, 2) : null;
  if (!trimmed && !safeMedia) return;

  const msgId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `m-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const timestamp = Date.now();

  const message = {
    id: msgId,
    peerId: id,
    username: profile.username,
    dateOfBirth: profile.dateOfBirth ?? null,
    color: profile.color,
    text: trimmed,
    media: safeMedia,
    replies: Array.isArray(replies) && replies.length > 0 ? replies : null,
    timestamp
  };

  const localMessage = { ...message, avatarBase64: profile.avatarBase64 ?? null };
  const envelope = buildMessage('GLOBAL_MSG', id, profile, { message }, timestamp);

  await addGlobalMessage(localMessage);

  const openPeers = [...get(peerStore).connectedPeers.values()].filter((e) => e.connection?.open !== false);
  if (openPeers.length === 0) {
    pendingGlobalOutbox.set(msgId, envelope);
    return;
  }
  for (const entry of openPeers) safeSend(entry.connection, envelope);
}

export async function broadcastGlobalMessageEdit(messageId, text, media = null, profile, replies = null) {
  const id = String(messageId ?? '').trim();
  if (!id) return;
  if (!profile?.username || profile.username === 'pre-registration') return;

  const trimmed = String(text ?? '').trim();
  const safeMedia = Array.isArray(media) && media.length > 0 ? media.slice(0, 2) : null;
  if (!trimmed && !safeMedia) return;

  const original = await getGlobalMessage(id);
  if (!original) return;
  if (String(original.username ?? '') !== profile.username) return;
  if (original.deleted) return;
  if (Date.now() - (typeof original.timestamp === 'number' ? original.timestamp : 0) > GLOBAL_EDIT_WINDOW_MS) return;

  const editedAt = Date.now();
  const safeReplies = Array.isArray(replies) && replies.length > 0 ? replies : null;

  updateGlobalMessageInStore(id, { text: trimmed, editedAt, replies: safeReplies, media: safeMedia }, profile.username);
  cascadeGlobalCitations(id, { newSnapshot: trimmed });
  await persistGlobalPatchWithCascade(
    id,
    { text: trimmed, editedAt, replies: safeReplies, media: safeMedia },
    { cascadeFromText: trimmed }
  );

  const stateAfter = get(peerStore);
  const myPeerId = stateAfter.peerId;
  if (!myPeerId) return;

  const envelope = buildMessage(
    'GLOBAL_MSG_EDIT',
    myPeerId,
    profile,
    { messageId: id, text: trimmed, media: safeMedia, replies: safeReplies, editedAt },
    Date.now()
  );

  const openPeers = [...stateAfter.connectedPeers.values()].filter((e) => e.connection?.open !== false);
  if (openPeers.length === 0) {
    pendingGlobalActionOutbox.set(`GLOBAL_MSG_EDIT:${id}`, envelope);
    return;
  }
  for (const entry of openPeers) safeSend(entry.connection, envelope);
}

export async function broadcastGlobalMessageDelete(messageId, profile) {
  const id = String(messageId ?? '').trim();
  if (!id) return;
  if (!profile?.username || profile.username === 'pre-registration') return;

  const original = await getGlobalMessage(id);
  if (!original) return;
  if (String(original.username ?? '') !== profile.username) return;
  if (original.deleted) return;
  if (Date.now() - (typeof original.timestamp === 'number' ? original.timestamp : 0) > GLOBAL_EDIT_WINDOW_MS) return;

  deleteGlobalMessageInStore(id, profile.username);
  cascadeGlobalCitations(id, { deleted: true });
  await persistGlobalPatchWithCascade(id, { deleted: true, text: GLOBAL_DELETED_PLACEHOLDER }, { cascadeDeleted: true });

  const stateAfter = get(peerStore);
  const myPeerId = stateAfter.peerId;
  if (!myPeerId) return;

  const envelope = buildMessage('GLOBAL_MSG_DELETE', myPeerId, profile, { messageId: id }, Date.now());
  const openPeers = [...stateAfter.connectedPeers.values()].filter((e) => e.connection?.open !== false);
  if (openPeers.length === 0) {
    pendingGlobalActionOutbox.set(`GLOBAL_MSG_DELETE:${id}`, envelope);
    return;
  }
  for (const entry of openPeers) safeSend(entry.connection, envelope);
}

export async function handleIncomingGlobalMessage(msg) {
  const incoming = msg.payload?.message;
  const text = typeof incoming?.text === 'string' ? incoming.text : msg.payload?.text;
  const safeText = typeof text === 'string' ? text.trim() : '';
  const replies = Array.isArray(incoming?.replies) ? incoming.replies : null;
  const media = Array.isArray(incoming?.media) && incoming.media.length > 0 ? incoming.media.slice(0, 2) : null;
  if (!safeText && !media) return;

  const incomingId = incoming?.id;
  const messageId =
    typeof incomingId === 'string' && incomingId.length > 0
      ? incomingId
      : globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `m-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  await addGlobalMessage({
    id: messageId,
    peerId: msg.from.peerId,
    username: msg.from.username,
    dateOfBirth: msg.from.dateOfBirth ?? null,
    color: msg.from.color,
    avatarBase64: get(avatarCache).get(msg.from.peerId) ?? null,
    text: safeText,
    media,
    replies,
    timestamp: typeof incoming?.timestamp === 'number' ? incoming.timestamp : msg.timestamp
  });
}

export async function handleIncomingGlobalMessageEdit(msg) {
  const id = String(msg.payload?.messageId ?? '').trim();
  const text = typeof msg.payload?.text === 'string' ? msg.payload.text.trim() : '';
  const replies = Array.isArray(msg.payload?.replies) ? msg.payload.replies : null;
  const media = Array.isArray(msg.payload?.media) && msg.payload.media.length > 0 ? msg.payload.media.slice(0, 2) : null;
  const editedAt = typeof msg.payload?.editedAt === 'number' ? msg.payload.editedAt : null;
  if (!id) return;
  if (!text && !media) return;

  const original = await getGlobalMessage(id);
  if (!original) return;
  if (String(original.username ?? '') !== String(msg.from.username ?? '')) return;
  if (original.deleted) return;
  const originalTs = typeof original.timestamp === 'number' ? original.timestamp : 0;
  if (Date.now() - originalTs > GLOBAL_EDIT_WINDOW_MS) return;

  updateGlobalMessageInStore(id, { text, editedAt: editedAt ?? Date.now(), replies, media }, msg.from.username);
  cascadeGlobalCitations(id, { newSnapshot: text });

  try {
    await persistGlobalPatchWithCascade(
      id,
      { text, editedAt: editedAt ?? Date.now(), replies, media },
      { cascadeFromText: text }
    );
  } catch (err) {
    console.error('GLOBAL_MSG_EDIT persist failed', err);
  }
}

export async function handleIncomingGlobalMessageDelete(msg) {
  const id = String(msg.payload?.messageId ?? '').trim();
  if (!id) return;

  const original = await getGlobalMessage(id);
  if (!original) return;
  if (String(original.username ?? '') !== String(msg.from.username ?? '')) return;
  if (original.deleted) return;
  const originalTs = typeof original.timestamp === 'number' ? original.timestamp : 0;
  if (Date.now() - originalTs > GLOBAL_EDIT_WINDOW_MS) return;

  deleteGlobalMessageInStore(id, msg.from.username);
  cascadeGlobalCitations(id, { deleted: true });
  try {
    await persistGlobalPatchWithCascade(id, { deleted: true, text: GLOBAL_DELETED_PLACEHOLDER }, { cascadeDeleted: true });
  } catch (err) {
    console.error('GLOBAL_MSG_DELETE persist failed', err);
  }
}
