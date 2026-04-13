import { db } from './schema.js';

/**
 * Save the local user (there is only ever one local user).
 * @param {import('./types.js').User} user
 */
export async function saveUser(user) {
  try {
    const record = { ...user, id: 1 };
    await db.users.put(record);
  } catch (err) {
    console.error('saveUser failed', err);
    throw err;
  }
}

/**
 * Get the local user (or null).
 * @returns {Promise<import('./types.js').User|null>}
 */
export async function getUser() {
  try {
    return (await db.users.get(1)) ?? null;
  } catch (err) {
    console.error('getUser failed', err);
    throw err;
  }
}
