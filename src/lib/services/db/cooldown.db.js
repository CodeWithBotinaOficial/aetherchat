import { db } from './schema.js';

/**
 * @typedef {{ id: 'cooldown', until: number }} DeletionCooldownRow
 */

const COOLDOWN_ID = 'cooldown';

/**
 * @returns {Promise<DeletionCooldownRow|null>}
 */
export async function getDeletionCooldown() {
  try {
    return (await db.cooldown.get(COOLDOWN_ID)) ?? null;
  } catch (err) {
    console.error('getDeletionCooldown failed', err);
    throw err;
  }
}

/**
 * @param {number} until
 */
export async function setDeletionCooldown(until) {
  try {
    const ts = Number(until);
    if (!Number.isFinite(ts)) throw new Error('Invalid cooldown timestamp');
    await db.cooldown.put({ id: COOLDOWN_ID, until: ts });
  } catch (err) {
    console.error('setDeletionCooldown failed', err);
    throw err;
  }
}

export async function clearDeletionCooldown() {
  try {
    await db.cooldown.delete(COOLDOWN_ID);
  } catch (err) {
    console.error('clearDeletionCooldown failed', err);
    throw err;
  }
}

