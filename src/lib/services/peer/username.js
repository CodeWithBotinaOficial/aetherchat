import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { privateChatStore, setChatOnlineStatus, upsertChatEntry } from '$lib/stores/privateChatStore.js';
import {
  db,
  getPrivateChat,
  getUsernameRegistryEntry,
  isUsernameTaken,
  registerUsernameLocally,
  unregisterUsernameLocally,
  upsertPrivateChat
} from '$lib/services/db.js';
import { broadcastToAll, buildFromProfile, cachedProfile, onMessage, sendToPeer, upsertConnectedPeer } from './shared.js';
import { handleRemoteUserDeletedSocial } from './social.js';

/**
 * Try a few suggestions; registry checks are local only.
 * @param {string} username
 * @returns {Promise<string>}
 */
export async function generateUsernameSuggestion(username) {
  const base = String(username ?? '').trim();
  if (!base) return `user${Math.floor(100 + Math.random() * 900)}`;

  for (let i = 0; i < 10; i += 1) {
    const suffix = Math.floor(100 + Math.random() * 900);
    const candidate = `${base}${suffix}`;
    // Best-effort: avoid suggestions already in the local registry.
    // Network uniqueness is enforced via the USERNAME_CHECK flow.
    const taken = await isUsernameTaken(candidate);
    if (!taken) return candidate;
  }

  return `${base}${Math.floor(100 + Math.random() * 900)}`;
}

/**
 * @param {string} desiredUsername
 * @returns {Promise<{ available: true } | { available: false, takenBy: string, suggestion: string }>}
 */
export async function checkUsernameAvailability(desiredUsername) {
  // Layer 1: local registry.
  const takenLocally = await isUsernameTaken(desiredUsername);
  if (takenLocally) {
    return {
      available: false,
      takenBy: 'local',
      suggestion: await generateUsernameSuggestion(desiredUsername)
    };
  }

  // Layer 2: live network query (only if we have direct peers).
  const connectedPeers = get(peerStore).connectedPeers;
  if (connectedPeers.size === 0) return { available: true };

  return await new Promise((resolve) => {
    const checkId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `chk-${Date.now()}-${Math.random()}`;
    const timer = setTimeout(() => resolve({ available: true }), 2000);

    const unsubscribe = onMessage('USERNAME_TAKEN', (msg) => {
      if (msg?.payload?.checkId !== checkId) return;
      clearTimeout(timer);
      unsubscribe();
      generateUsernameSuggestion(desiredUsername)
        .then((suggestion) => resolve({ available: false, takenBy: msg.from.peerId, suggestion }))
        .catch(() =>
          resolve({
            available: false,
            takenBy: msg.from.peerId,
            suggestion: `${desiredUsername}${Math.floor(100 + Math.random() * 900)}`
          })
        );
    });

    const from =
      cachedProfile && cachedProfile.username
        ? buildFromProfile(cachedProfile)
        : {
            peerId: get(peerStore).peerId ?? 'pre-registration',
            username: 'pre-registration',
            color: 'hsl(0, 0%, 70%)',
            dateOfBirth: null
          };

    broadcastToAll({
      type: 'USERNAME_CHECK',
      from,
      payload: { username: desiredUsername, checkId },
      timestamp: Date.now()
    });
  });
}

/**
 * Broadcast a one-time username registration event so all peers can update their local registry.
 * Note: in a fully decentralized system, simultaneous registrations can still conflict in rare races.
 * @param {import('./types.js').UserProfile} profile
 */
export function broadcastUsernameRegistered(profile) {
  const state = get(peerStore);
  const id = state.peerId;
  if (!id) return;
  if (!profile?.username) return;

  broadcastToAll({
    type: 'USERNAME_REGISTERED',
    from: buildFromProfile(profile),
    payload: {
      username: profile.username,
      peerId: id,
      registeredAt: profile.createdAt ?? Date.now()
    },
    timestamp: Date.now()
  });
}

export async function handleUsernameCheck(msg, profile) {
  const username = msg.payload?.username;
  const checkId = msg.payload?.checkId;
  if (typeof username !== 'string' || typeof checkId !== 'string') return;
  const taken = await isUsernameTaken(username);
  if (!taken) return;
  sendToPeer(msg.from.peerId, {
    type: 'USERNAME_TAKEN',
    from: buildFromProfile(profile),
    payload: { checkId, username },
    timestamp: Date.now()
  });
}

export async function handleUsernameRegistered(msg) {
  const username = msg.payload?.username;
  const peerId = msg.payload?.peerId;
  const registeredAt = msg.payload?.registeredAt;
  if (typeof username !== 'string' || username.trim().length === 0) return;
  if (typeof peerId !== 'string' || peerId.length === 0) return;
  if (typeof registeredAt !== 'number') return;

  await registerUsernameLocally({
    username,
    peerId,
    registeredAt,
    lastSeenAt: Date.now()
  });
}

export async function handleUsernameChanged(msg, fromConn) {
  const oldUsername = msg.payload?.oldUsername;
  const newUsername = msg.payload?.newUsername;
  const peerId = msg.payload?.peerId;
  const changedAt = msg.payload?.changedAt;
  if (typeof oldUsername !== 'string' || oldUsername.trim().length === 0) return;
  if (typeof newUsername !== 'string' || newUsername.trim().length === 0) return;
  if (typeof peerId !== 'string' || peerId.length === 0) return;
  if (typeof changedAt !== 'number') return;

  const remotePeerId = msg.from.peerId;
  try {
    await unregisterUsernameLocally(oldUsername);
    await registerUsernameLocally({ username: newUsername, peerId, registeredAt: changedAt, lastSeenAt: Date.now() });
  } catch (err) {
    console.error('USERNAME_CHANGED registry update failed', err);
  }

  upsertConnectedPeer(remotePeerId, fromConn, { username: newUsername });

  try {
    for (const chat of get(privateChatStore).chats.values()) {
      if (chat?.theirPeerId !== remotePeerId) continue;
      upsertChatEntry({ id: chat.id, theirUsername: newUsername });
      const existing = await getPrivateChat(chat.id);
      if (existing) await upsertPrivateChat({ ...existing, theirUsername: newUsername });
    }
  } catch {
    // ignore
  }
}

export async function handleUserDeletedMessage(msg) {
  const username = msg.payload?.username;
  const peerId = msg.payload?.peerId;
  if (typeof username !== 'string' || username.trim().length === 0) return;
  if (typeof peerId !== 'string' || peerId.length === 0) return;
  if (peerId !== msg.from.peerId) return;

  const entry = await getUsernameRegistryEntry(username);
  if (!entry || entry.peerId !== msg.from.peerId) return;

  try {
    await unregisterUsernameLocally(username);
  } catch (err) {
    console.error('USER_DELETED unregister failed', err);
  }

  try {
    await db.knownPeers.where('peerId').equals(msg.from.peerId).delete();
  } catch {
    // ignore
  }

  // Remove from connectedPeers.
  const remotePeerId = msg.from.peerId;
  const state = get(peerStore);
  if (state.connectedPeers.has(remotePeerId)) {
    state.connectedPeers.get(remotePeerId)?.connection?.close?.();
  }
  // Store mutation is handled by net connection close; update status + remove entry defensively.
  setChatOnlineStatus(remotePeerId, false);

  // Mark any private chats with this peer as deleted, but keep message history.
  const placeholder = '[ User deleted their account ]';
  try {
    for (const chat of get(privateChatStore).chats.values()) {
      if (chat?.theirPeerId !== remotePeerId) continue;
      upsertChatEntry({ id: chat.id, theirUsername: placeholder, isOnline: false });
      const existing = await getPrivateChat(chat.id);
      if (existing) await upsertPrivateChat({ ...existing, theirUsername: placeholder });
    }
  } catch {
    // ignore
  }

  try {
    await handleRemoteUserDeletedSocial(remotePeerId);
  } catch (err) {
    console.error('USER_DELETED social cleanup failed', err);
  }
}

export async function handleUsernameReleasedMessage(msg) {
  const username = msg.payload?.username;
  const peerId = msg.payload?.peerId;
  if (typeof username !== 'string' || username.trim().length === 0) return;
  if (typeof peerId !== 'string' || peerId.length === 0) return;
  if (peerId !== msg.from.peerId) return;

  try {
    await unregisterUsernameLocally(username);
  } catch (err) {
    console.error('USERNAME_RELEASED unregister failed', err);
  }
  try {
    await db.knownPeers.where('peerId').equals(peerId).delete();
  } catch {
    // ignore
  }
}

export function broadcastUsernameChanged(payload, profile) {
  const state = get(peerStore);
  const id = state.peerId;
  if (!id) return;
  if (!profile?.username || profile.username === 'pre-registration') return;
  broadcastToAll({ type: 'USERNAME_CHANGED', from: buildFromProfile(profile), payload, timestamp: Date.now() });
}

export function broadcastUserDeleted(payload, profile) {
  const state = get(peerStore);
  const id = state.peerId;
  if (!id) return;
  if (!profile?.username || profile.username === 'pre-registration') return;
  broadcastToAll({ type: 'USER_DELETED', from: buildFromProfile(profile), payload, timestamp: Date.now() });
}

export function broadcastUsernameReleased(payload, profile) {
  const state = get(peerStore);
  const id = state.peerId;
  if (!id) return;
  if (!profile?.username || profile.username === 'pre-registration') return;
  broadcastToAll({ type: 'USERNAME_RELEASED', from: buildFromProfile(profile), payload, timestamp: Date.now() });
}
