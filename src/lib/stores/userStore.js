import { derived, get, writable } from 'svelte/store';
import { db, getStoredPeerId, getUser, saveUser } from '$lib/services/db.js';
import { generateInitialsAvatar } from '$lib/utils/avatar.js';
import { getUserColor } from '$lib/utils/colors.js';

/**
 * @typedef {import('$lib/services/db.js').User} User
 */

/** @type {import('svelte/store').Writable<User|null>} */
export const user = writable(null);
export const stablePeerId = writable(null);

export const isRegistered = derived(user, ($u) => $u !== null);

/**
 * Explicit hydration (called by app boot). Kept out of module init so the app
 * can enforce the account deletion cooldown check before loading profile data.
 */
export async function hydrateUserFromDb() {
  try {
    const u = await getUser();
    if (u) {
      user.set(u);
      try {
        const pid = await getStoredPeerId(u.username);
        stablePeerId.set(pid);
      } catch {
        stablePeerId.set(null);
      }
    }
  } catch (err) {
    console.error('userStore load failed', err);
  }
}

/**
 * @param {string} username
 * @param {string} dateOfBirth ISO date string (YYYY-MM-DD)
 * @param {string} [avatarBase64]
 */
export async function registerUser(username, dateOfBirth, avatarBase64) {
  try {
    const color = getUserColor(username);
    const avatar = avatarBase64 ?? (await generateInitialsAvatar(username, color));

    const record = {
      username,
      dateOfBirth: String(dateOfBirth ?? '').trim() || null,
      color,
      avatarBase64: avatar ?? null,
      bio: '',
      usernameLastChangedAt: null,
      ageChangedOnce: false,
      createdAt: Date.now()
    };

    await saveUser(record);
    user.set({ ...record, id: 1 });
    try {
      const pid = await getStoredPeerId(username);
      stablePeerId.set(pid);
    } catch {
      stablePeerId.set(null);
    }
  } catch (err) {
    console.error('registerUser failed', err);
    throw err;
  }
}

export async function clearUser() {
  try {
    await db.users.delete(1);
    user.set(null);
    stablePeerId.set(null);
  } catch (err) {
    console.error('clearUser failed', err);
    throw err;
  }
}

/**
 * Source of truth for "my peer id" during boot is the persisted peerId mapping.
 * Live PeerJS connection ids can be null during startup.
 * @param {string} peerId
 */
export function isOwnPeerId(peerId) {
  const pid = String(peerId ?? '').trim();
  if (!pid) return false;
  const mine = get(stablePeerId);
  return Boolean(mine && pid === mine);
}

export async function refreshStablePeerId() {
  const u = get(user);
  if (!u?.username) {
    stablePeerId.set(null);
    return null;
  }
  const pid = await getStoredPeerId(u.username);
  stablePeerId.set(pid);
  return pid;
}
