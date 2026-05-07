import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { saveKnownPeer } from '$lib/services/db.js';
import { setChatOnlineStatus } from '$lib/stores/privateChatStore.js';

import { getPrivateChat, upsertPrivateChat } from '$lib/services/db.js';
import { buildSessionId, createSession, isSessionActive } from '$lib/services/crypto.js';
import { privateChatStore, setKeyExchangeState, upsertChatEntry } from '$lib/stores/privateChatStore.js';

import {
  broadcastToAll,
  buildDirectMessage,
  buildFromProfile,
  buildMessage,
  cachedProfile,
  clearKeyExchangeTimeout,
  sendToPeer,
  startKeyExchangeTimeout,
  setCachedAvatar,
  upsertConnectedPeer,
  userProfileRef
} from './shared.js';

/** @type {ReturnType<typeof setInterval>|null} */
let heartbeatIntervalId = null;

export function startHeartbeat(profile) {
  if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
  heartbeatIntervalId = setInterval(() => {
    const state = get(peerStore);
    if (state.connectedPeers.size === 0) return;
    const id = state.peerId;
    if (!id) return;
    const p = profile ?? cachedProfile;
    if (!p) return;
    broadcastToAll(buildMessage('HEARTBEAT', id, p, {}, Date.now()));
  }, 30_000);
}

export function stopHeartbeat() {
  if (!heartbeatIntervalId) return;
  clearInterval(heartbeatIntervalId);
  heartbeatIntervalId = null;
}

export function announcePresence(profile) {
  const state = get(peerStore);
  const id = state.peerId;
  if (!id) return;
  if (!profile) return;
  broadcastToAll({
    type: 'PRESENCE_ANNOUNCE',
    from: buildFromProfile(profile),
    payload: {
      username: profile.username,
      color: profile.color,
      dateOfBirth: profile.dateOfBirth ?? null,
      avatarBase64: profile.avatarBase64 ?? null,
      bio: profile.bio ?? ''
    },
    timestamp: Date.now()
  });
}

export async function handlePresenceAnnounceMessage(msg, fromConn) {
  const remotePeerId = msg.from.peerId;

  const avatarBase64 =
    typeof msg.payload?.avatarBase64 === 'string' && msg.payload.avatarBase64.length > 0 ? msg.payload.avatarBase64 : null;
  const bio = typeof msg.payload?.bio === 'string' ? msg.payload.bio : '';
  if (avatarBase64) setCachedAvatar(remotePeerId, avatarBase64);

  const theirUsername = msg.payload?.username ?? msg.from.username;
  upsertConnectedPeer(remotePeerId, fromConn, {
    username: theirUsername,
    color: msg.payload?.color ?? msg.from.color,
    dateOfBirth: Object.prototype.hasOwnProperty.call(msg.payload ?? {}, 'dateOfBirth')
      ? (msg.payload?.dateOfBirth ?? null)
      : (msg.from.dateOfBirth ?? null),
    avatarBase64,
    bio
  });

  await saveKnownPeer({ username: msg.from.username, peerId: remotePeerId, lastSeen: msg.timestamp ?? Date.now() });

  // Presence can imply a PeerJS ID refresh; allow private messaging to repair chat peerIds and re-key.
  try {
    const p = userProfileRef ?? cachedProfile;
    const myPeerId = get(peerStore).peerId;
    if (myPeerId && p?.username && p.username !== 'pre-registration' && theirUsername) {
      const chatId = buildSessionId(p.username, theirUsername);
      const chat = get(privateChatStore).chats.get(chatId);

      if (chat) {
        try {
          const existing = await getPrivateChat(chatId);
          if (existing) {
            await upsertPrivateChat({
              ...existing,
              myPeerId,
              myUsername: p.username,
              theirPeerId: remotePeerId,
              theirAvatarBase64: avatarBase64 ?? existing.theirAvatarBase64 ?? null
            });
          }
        } catch {
          // ignore
        }
        upsertChatEntry({
          id: chatId,
          theirPeerId: remotePeerId,
          isOnline: true,
          theirAvatarBase64: avatarBase64 ?? chat.theirAvatarBase64
        });
      }

      if (chat && !isSessionActive(chatId) && chat.keyExchangeState !== 'initiated' && chat.keyExchangeState !== 'completing') {
        try {
          const { publicKeyBase64 } = await createSession(p.username, theirUsername);
          setKeyExchangeState(chatId, 'initiated');
          startKeyExchangeTimeout(chatId);
          sendToPeer(
            remotePeerId,
            buildDirectMessage('PRIVATE_KEY_EXCHANGE', myPeerId, p, remotePeerId, { publicKeyBase64 }, Date.now())
          );
        } catch (err) {
          console.error('Auto re-key failed', err);
          clearKeyExchangeTimeout(chatId);
          setKeyExchangeState(chatId, 'failed');
        }
      }
    }
  } catch (err) {
    console.error('presence private repair failed', err);
  }

  setChatOnlineStatus(remotePeerId, true);
}

export async function handleHeartbeatMessage(msg) {
  const remotePeerId = msg.from.peerId;
  setChatOnlineStatus(remotePeerId, true);
  await saveKnownPeer({ username: msg.from.username, peerId: remotePeerId, lastSeen: msg.timestamp ?? Date.now() });
}

export async function handleProfileUpdatedMessage(msg, fromConn) {
  const remotePeerId = msg.from.peerId;
  const avatarBase64 =
    typeof msg.payload?.avatarBase64 === 'string' && msg.payload.avatarBase64.length > 0 ? msg.payload.avatarBase64 : null;
  const bio = typeof msg.payload?.bio === 'string' ? msg.payload.bio : null;

  if (avatarBase64) setCachedAvatar(remotePeerId, avatarBase64);

  upsertConnectedPeer(remotePeerId, fromConn, {
    avatarBase64: avatarBase64 ?? undefined,
    bio: bio ?? undefined
  });

  try {
    if (avatarBase64) {
      for (const chat of get(privateChatStore).chats.values()) {
        if (chat?.theirPeerId !== remotePeerId) continue;
        upsertChatEntry({ id: chat.id, theirAvatarBase64: avatarBase64 });
        const existing = await getPrivateChat(chat.id);
        if (existing) await upsertPrivateChat({ ...existing, theirAvatarBase64: avatarBase64 });
      }
    }
  } catch {
    // ignore
  }
}
