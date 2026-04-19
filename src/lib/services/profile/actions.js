import { get } from 'svelte/store';
import { user as userStore } from '$lib/stores/userStore.js';
import { setDeletionCooldownUntil } from '$lib/stores/cooldownStore.js';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { activeTab } from '$lib/stores/navigationStore.js';
import { globalMessages as globalMessagesStore } from '$lib/stores/chatStore.js';
import { privateChatStore } from '$lib/stores/privateChatStore.js';
import {
  clearDeletionCooldown,
  db,
  registerUsernameLocally,
  saveUser,
  setDeletionCooldown,
  unregisterUsernameLocally
} from '$lib/services/db.js';
import {
  broadcastProfileUpdated,
  broadcastUserDeleted,
  broadcastUsernameChanged,
  checkUsernameAvailability,
  disconnectPeer,
  setLocalUserProfile
} from '$lib/services/peer.js';
import { generateInitialsAvatar, validateAvatarFile } from '$lib/utils/avatar.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

export const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/**
 * @param {any} u
 * @param {number} [now=Date.now()]
 * @returns {{ locked: boolean, remainingMs: number }}
 */
export function getUsernameCooldown(u, now = Date.now()) {
  const last = typeof u?.usernameLastChangedAt === 'number' ? u.usernameLastChangedAt : null;
  if (!last) return { locked: false, remainingMs: 0 };
  const remainingMs = Math.max(0, ONE_DAY_MS - (Number(now) - last));
  return { locked: remainingMs > 0, remainingMs };
}

/**
 * @param {number} ms
 * @returns {string}
 */
export function formatCooldownHoursMinutes(ms) {
  const totalMin = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

function toPeerProfile(u) {
  return {
    username: u.username,
    color: u.color,
    age: u.age,
    avatarBase64: u.avatarBase64 ?? null,
    bio: u.bio ?? '',
    createdAt: u.createdAt
  };
}

/**
 * @param {string} nextUsername
 * @returns {Promise<{ ok: true } | { ok: false, error: string, suggestion?: string }>}
 */
export async function changeUsername(nextUsername) {
  const u = get(userStore);
  if (!u) return { ok: false, error: 'Not registered.' };

  const desired = String(nextUsername ?? '').trim();
  if (!desired) return { ok: false, error: 'Username is required.' };
  if (!USERNAME_RE.test(desired)) return { ok: false, error: '3-20 chars, letters/numbers/underscore only.' };
  if (desired === u.username) return { ok: true };

  const cd = getUsernameCooldown(u);
  if (cd.locked) return { ok: false, error: `You can change your username again in ${formatCooldownHoursMinutes(cd.remainingMs)}.` };

  const availability = await checkUsernameAvailability(desired);
  if (!availability.available) {
    return {
      ok: false,
      error: `"${desired}" is taken.`,
      suggestion: availability.suggestion
    };
  }

  const oldUsername = u.username;
  const changedAt = Date.now();
  const peerId = get(peerStore).peerId ?? 'pending';

  const updated = { ...u, username: desired, usernameLastChangedAt: changedAt };

  // Persist user row first so the UI refreshes even if registry broadcasts fail.
  await saveUser(updated);
  userStore.set(updated);

  // Local registry: release old, then claim new.
  await unregisterUsernameLocally(oldUsername);
  await registerUsernameLocally({
    username: desired,
    peerId,
    registeredAt: changedAt,
    lastSeenAt: changedAt
  });

  // Update our peerId mapping row (best-effort).
  try {
    await db.peerIds.delete(oldUsername);
    await db.peerIds.put({ username: desired, peerId });
  } catch {
    // ignore
  }

  // Update outgoing profile + notify peers.
  const profile = toPeerProfile(updated);
  setLocalUserProfile(profile);
  broadcastUsernameChanged({ oldUsername, newUsername: desired, peerId, changedAt }, profile);

  return { ok: true };
}

/**
 * @param {number} nextAge
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function changeAge(nextAge) {
  const u = get(userStore);
  if (!u) return { ok: false, error: 'Not registered.' };
  if (u.ageChangedOnce) return { ok: false, error: 'Age is locked.' };

  const n = Number(nextAge);
  if (!Number.isFinite(n) || n < 16) return { ok: false, error: 'Age must be at least 16.' };

  const updated = { ...u, age: Math.floor(n), ageChangedOnce: true };
  await saveUser(updated);
  userStore.set(updated);

  const profile = toPeerProfile(updated);
  setLocalUserProfile(profile);
  // Age changes ride the existing PRESENCE_ANNOUNCE path via setLocalUserProfile().

  return { ok: true };
}

/**
 * @param {string} nextBio
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function changeBio(nextBio) {
  const u = get(userStore);
  if (!u) return { ok: false, error: 'Not registered.' };

  const raw = String(nextBio ?? '');
  const bio = raw.length > 120 ? raw.slice(0, 120) : raw;

  const updated = { ...u, bio };
  await saveUser(updated);
  userStore.set(updated);

  const profile = toPeerProfile(updated);
  setLocalUserProfile(profile);
  broadcastProfileUpdated({ bio }, profile);

  return { ok: true };
}

/**
 * @param {File|null} file
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function uploadAvatar(file) {
  const u = get(userStore);
  if (!u) return { ok: false, error: 'Not registered.' };

  const res = validateAvatarFile(file);
  if (!res.valid) return { ok: false, error: res.error ?? 'Invalid avatar file.' };

  const avatarBase64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });

  const updated = { ...u, avatarBase64: String(avatarBase64) };
  await saveUser(updated);
  userStore.set(updated);

  const profile = toPeerProfile(updated);
  setLocalUserProfile(profile);
  broadcastProfileUpdated({ avatarBase64: updated.avatarBase64 }, profile);

  return { ok: true };
}

/**
 * Revert to the generated initials avatar.
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function removeAvatar() {
  const u = get(userStore);
  if (!u) return { ok: false, error: 'Not registered.' };

  const avatarBase64 = await generateInitialsAvatar(u.username, u.color);
  const updated = { ...u, avatarBase64: avatarBase64 ?? null };
  await saveUser(updated);
  userStore.set(updated);

  const profile = toPeerProfile(updated);
  setLocalUserProfile(profile);
  broadcastProfileUpdated({ avatarBase64: updated.avatarBase64 }, profile);

  return { ok: true };
}

/**
 * Deletes the local account + data and enforces a 48h browser cooldown.
 * @returns {Promise<{ ok: true, until: number } | { ok: false, error: string }>}
 */
export async function deleteAccount() {
  const u = get(userStore);
  if (!u) return { ok: false, error: 'Not registered.' };

  const peerId = get(peerStore).peerId ?? 'pending';
  const profile = toPeerProfile(u);

  // STEP 1: broadcast before mutating local state.
  broadcastUserDeleted({ username: u.username, peerId }, profile);

  // STEP 2-8: delete local IndexedDB data (in the requested order).
  try {
    // 2) Delete all global messages authored by this user.
    await db.globalMessages.where('username').equals(u.username).delete();
    if (peerId && peerId !== 'pending') {
      await db.globalMessages.where('peerId').equals(peerId).delete();
    }

    // 3) Delete all private chats and their messages from local IndexedDB.
    await db.privateMessages.clear();
    await db.sentMessagesPlaintext.clear();
    await db.sessionKeys.clear();
    await db.privateChats.clear();

    // 4) Delete all queued messages from local IndexedDB.
    await db.queuedMessages.clear();
    await db.queuedActions.clear();

    // 5) Delete the username from the registry table.
    await unregisterUsernameLocally(u.username);

    // 6) Delete the user's peerId entry from the peerIds table.
    await db.peerIds.delete(u.username);

    // 7) Delete all knownPeers entries.
    await db.knownPeers.clear();

    // 8) Delete the user profile from IndexedDB.
    await db.users.delete(1);
  } catch (err) {
    console.error('deleteAccount IndexedDB cleanup failed', err);
  }

  // STEP 9: Clear in-memory stores.
  userStore.set(null);
  globalMessagesStore.set([]);
  privateChatStore.set({ chats: new Map(), activeChatId: null, pendingKeyExchanges: new Map() });
  activeTab.set('global');

  // STEP 10: persist cooldown row in a table that survives user deletion.
  const until = Date.now() + FORTY_EIGHT_HOURS_MS;
  await setDeletionCooldown(until);
  setDeletionCooldownUntil(until);

  // STEP 11: disconnect networking (UI is blocked by cooldown screen anyway).
  disconnectPeer();

  return { ok: true, until };
}

/**
 * For tests / admin flows: clears an active cooldown and the in-memory gate store.
 */
export async function clearAccountDeletionCooldown() {
  try {
    await clearDeletionCooldown();
  } finally {
    setDeletionCooldownUntil(null);
  }
}

export const __test = { ONE_DAY_MS, FORTY_EIGHT_HOURS_MS };
