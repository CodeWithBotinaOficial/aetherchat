import { derived, writable } from 'svelte/store';
import { db, getUser, saveUser } from '$lib/services/db.js';
import { generateInitialsAvatar } from '$lib/utils/avatar.js';
import { getUserColor } from '$lib/utils/colors.js';

/**
 * @typedef {import('$lib/services/db.js').User} User
 */

/** @type {import('svelte/store').Writable<User|null>} */
export const user = writable(null);

export const isRegistered = derived(user, ($u) => $u !== null);

/**
 * Explicit hydration (called by app boot). Kept out of module init so the app
 * can enforce the account deletion cooldown check before loading profile data.
 */
export async function hydrateUserFromDb() {
  try {
    const u = await getUser();
    if (u) user.set(u);
  } catch (err) {
    console.error('userStore load failed', err);
  }
}

/**
 * @param {string} username
 * @param {number} age
 * @param {string} [avatarBase64]
 */
export async function registerUser(username, age, avatarBase64) {
  try {
    const color = getUserColor(username);
    const avatar = avatarBase64 ?? (await generateInitialsAvatar(username, color));

    const record = {
      username,
      age,
      color,
      avatarBase64: avatar ?? null,
      bio: '',
      usernameLastChangedAt: null,
      ageChangedOnce: false,
      createdAt: Date.now()
    };

    await saveUser(record);
    user.set({ ...record, id: 1 });
  } catch (err) {
    console.error('registerUser failed', err);
    throw err;
  }
}

export async function clearUser() {
  try {
    await db.users.delete(1);
    user.set(null);
  } catch (err) {
    console.error('clearUser failed', err);
    throw err;
  }
}
