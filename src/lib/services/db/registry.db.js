import { db } from './schema.js';
import { getStoredPeerId } from './peerIds.db.js';
import { getUser } from './users.db.js';
import { calculateAge, isBirthday } from '../../utils/time.js';
import { get } from 'svelte/store';
import { peer as peerStore } from '$lib/stores/peerStore.js';
import { avatarCache } from '$lib/services/peer/shared.js';

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
 * @param {string} username
 * @returns {Promise<import('./types.js').UsernameRegistryEntry|null>}
 */
export async function getUsernameRegistryEntry(username) {
  try {
    const norm = normalizeUsername(username);
    if (!norm) return null;
    return (await db.usernameRegistry.where('username').equals(norm).first()) ?? null;
  } catch (err) {
    console.error('getUsernameRegistryEntry failed', err);
    throw err;
  }
}

/**
 * Remove a username registry entry (normalized match).
 * @param {string} username
 * @returns {Promise<number>} number of rows deleted
 */
export async function unregisterUsernameLocally(username) {
  try {
    const norm = normalizeUsername(username);
    if (!norm) return 0;
    return await db.usernameRegistry.where('username').equals(norm).delete();
  } catch (err) {
    console.error('unregisterUsernameLocally failed', err);
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

/**
 * Enriched user record used by the User Directory feature.
 *
 * Data is sourced strictly from local storage:
 * 1) local user's `users` table (full profile)
 * 2) remote peers' `knownPeers` table (best-effort, if profile fields were persisted during P2P flows)
 * 3) fallback to registry-only fields
 *
 * IMPORTANT: this does not make any new P2P requests to fill missing data.
 *
 * @typedef {Object} EnrichedUser
 * @property {string} username
 * @property {string} peerId
 * @property {number} registeredAt
 * @property {string|null} dateOfBirth ISO date string (YYYY-MM-DD) or null
 * @property {number|null} age
 * @property {string} bio
 * @property {string|null} avatarBase64
 * @property {boolean} isBirthday
 */

/**
 * Build an enriched user list from the local username registry plus optional local metadata.
 * @returns {Promise<EnrichedUser[]>}
 */
export async function getAllRegisteredUsers() {
  try {
    const [registry, localUser, knownPeers] = await Promise.all([
      db.usernameRegistry.orderBy('registeredAt').toArray(),
      getUser(),
      db.knownPeers.toArray()
    ]);

    const myUsername = localUser?.username ?? '';
    const myPeerId = myUsername ? await getStoredPeerId(myUsername) : null;

    const connectedPeers = get(peerStore)?.connectedPeers ?? new Map();
    const avatars = get(avatarCache) ?? new Map();

    const knownByPeerId = new Map();
    const knownByNormUsername = new Map();
    for (const kp of knownPeers) {
      const pid = String(kp?.peerId ?? '').trim();
      const uname = String(kp?.username ?? '').trim();
      if (pid) knownByPeerId.set(pid, kp);
      const norm = normalizeUsername(uname);
      if (norm) knownByNormUsername.set(norm, kp);
    }

    return registry
      .map((entry) => {
        const pid = String(entry?.peerId ?? '').trim();
        const normUsername = String(entry?.username ?? '').trim();
        const registeredAt = typeof entry?.registeredAt === 'number' ? entry.registeredAt : 0;

        /** @type {string} */
        let username = normUsername;
        /** @type {string|null} */
        let dateOfBirth = null;
        /** @type {string} */
        let bio = '';
        /** @type {string|null} */
        let avatarBase64 = null;

        const isLocal = Boolean(myPeerId && pid && pid === myPeerId);
        if (isLocal && localUser) {
          username = String(localUser.username ?? '') || username;
          dateOfBirth = typeof localUser.dateOfBirth === 'string' ? localUser.dateOfBirth : null;
          bio = typeof localUser.bio === 'string' ? localUser.bio : '';
          avatarBase64 = typeof localUser.avatarBase64 === 'string' && localUser.avatarBase64.length > 0 ? localUser.avatarBase64 : null;
        } else {
          // Remote enrichment: use only local data already present in this session.
          // IMPORTANT: we do not make any P2P requests here to fill missing fields.
          const live = pid ? connectedPeers.get(pid) : null;
          if (live) {
            const liveUsername = String(live?.username ?? '').trim();
            if (liveUsername) username = liveUsername;
            dateOfBirth = typeof live?.dateOfBirth === 'string' ? live.dateOfBirth : null;
            bio = typeof live?.bio === 'string' ? live.bio : '';
            avatarBase64 =
              (typeof live?.avatarBase64 === 'string' && live.avatarBase64.length > 0 ? live.avatarBase64 : null) ??
              (typeof avatars?.get?.(pid) === 'string' ? avatars.get(pid) : null);
          }

          const kp = (pid && knownByPeerId.get(pid)) || (normUsername && knownByNormUsername.get(normUsername)) || null;
          if (kp) {
            const kpUsername = String(kp?.username ?? '').trim();
            if (kpUsername) username = kpUsername;

            // These fields are optional: they may not exist unless persisted by prior builds/flows.
            if (dateOfBirth === null) dateOfBirth = typeof kp?.dateOfBirth === 'string' ? kp.dateOfBirth : null;
            if (!bio) bio = typeof kp?.bio === 'string' ? kp.bio : '';
            if (avatarBase64 === null) avatarBase64 = typeof kp?.avatarBase64 === 'string' && kp.avatarBase64.length > 0 ? kp.avatarBase64 : null;
          }
        }

        const age = dateOfBirth ? calculateAge(dateOfBirth) : null;
        const birthday = dateOfBirth ? isBirthday(dateOfBirth) : false;

        return {
          username,
          peerId: pid,
          registeredAt,
          dateOfBirth,
          age: typeof age === 'number' ? age : null,
          bio: typeof bio === 'string' ? bio : '',
          avatarBase64,
          isBirthday: Boolean(birthday)
        };
      })
      .filter((u) => u.peerId && u.username);
  } catch (err) {
    console.error('getAllRegisteredUsers failed', err);
    throw err;
  }
}

export const __test = { normalizeUsername };
