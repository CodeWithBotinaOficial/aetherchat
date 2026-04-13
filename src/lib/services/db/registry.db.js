import { db } from './schema.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_YEAR_MS = 365 * ONE_DAY_MS;

/**
 * Normalize usernames for uniqueness checks (case-insensitive, accent-insensitive).
 * @param {string} username
 * @returns {string}
 */
function normalizeUsername(username) {
  return String(username ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Upsert a username registry entry by normalized username.
 * @param {import('./types.js').UsernameRegistryEntry} entry
 */
export async function registerUsernameLocally(entry) {
  try {
    const norm = normalizeUsername(entry.username);
    if (!norm) return;

    await db.transaction('rw', db.usernameRegistry, async () => {
      const existing = await db.usernameRegistry.where('username').equals(norm).first();
      const record = {
        username: norm,
        peerId: entry.peerId,
        registeredAt: entry.registeredAt,
        lastSeenAt: entry.lastSeenAt
      };
      if (existing) {
        await db.usernameRegistry.put({ ...existing, ...record, id: existing.id });
      } else {
        await db.usernameRegistry.add(record);
      }
    });
  } catch (err) {
    console.error('registerUsernameLocally failed', err);
    throw err;
  }
}

/**
 * @param {string} username
 * @returns {Promise<boolean>}
 */
export async function isUsernameTaken(username) {
  try {
    const norm = normalizeUsername(username);
    if (!norm) return false;
    const existing = await db.usernameRegistry.where('username').equals(norm).first();
    return Boolean(existing);
  } catch (err) {
    console.error('isUsernameTaken failed', err);
    throw err;
  }
}

/**
 * @returns {Promise<import('./types.js').UsernameRegistryEntry[]>}
 */
export async function getFullUsernameRegistry() {
  try {
    return await db.usernameRegistry.orderBy('registeredAt').toArray();
  } catch (err) {
    console.error('getFullUsernameRegistry failed', err);
    throw err;
  }
}

/**
 * Merge remote registry entries with local registry.
 * Earlier registration always wins; lastSeenAt is merged as max().
 * @param {import('./types.js').UsernameRegistryEntry[]} remoteEntries
 */
export async function mergeUsernameRegistry(remoteEntries) {
  try {
    const list = Array.isArray(remoteEntries) ? remoteEntries : [];
    if (list.length === 0) return;

    await db.transaction('rw', db.usernameRegistry, async () => {
      for (const entry of list) {
        const norm = normalizeUsername(entry?.username);
        if (!norm) continue;

        const remote = {
          username: norm,
          peerId: entry.peerId,
          registeredAt: entry.registeredAt,
          lastSeenAt: entry.lastSeenAt
        };

        const local = await db.usernameRegistry.where('username').equals(norm).first();
        if (!local) {
          await db.usernameRegistry.add(remote);
          continue;
        }

        const localWins = (local.registeredAt ?? Number.POSITIVE_INFINITY) <= (remote.registeredAt ?? Number.POSITIVE_INFINITY);
        if (localWins) {
          const remoteIsNewer = (remote.lastSeenAt ?? 0) >= (local.lastSeenAt ?? 0);
          await db.usernameRegistry.put({
            ...local,
            // Registration ownership stays with the earliest registrant, but contact peerId can change.
            peerId: remoteIsNewer && remote.peerId ? remote.peerId : local.peerId,
            lastSeenAt: Math.max(local.lastSeenAt ?? 0, remote.lastSeenAt ?? 0),
            id: local.id
          });
        } else {
          await db.usernameRegistry.put({
            ...local,
            ...remote,
            lastSeenAt: Math.max(local.lastSeenAt ?? 0, remote.lastSeenAt ?? 0),
            id: local.id
          });
        }
      }
    });
  } catch (err) {
    console.error('mergeUsernameRegistry failed', err);
    throw err;
  }
}

/**
 * Remove username registry entries that haven't been seen in over 1 year.
 * @returns {Promise<number>}
 */
export async function pruneStaleRegistryEntries() {
  try {
    const cutoff = Date.now() - ONE_YEAR_MS;
    return await db.usernameRegistry.where('lastSeenAt').below(cutoff).delete();
  } catch (err) {
    console.error('pruneStaleRegistryEntries failed', err);
    throw err;
  }
}

export const __test = { normalizeUsername };
