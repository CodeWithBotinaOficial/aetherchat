import { get } from 'svelte/store';
import { getAllRegisteredUsers } from '$lib/services/db.js';
import { userDirectoryStore, DEFAULT_SORT_MODE } from './state.js';

/**
 * @typedef {import('$lib/services/db.js').EnrichedUser} EnrichedUser
 * @typedef {import('./state.js').SortMode} SortMode
 */

function compareNullable(a, b, direction) {
  const dir = direction === 'desc' ? -1 : 1;
  const aNull = a === null || typeof a === 'undefined';
  const bNull = b === null || typeof b === 'undefined';
  if (aNull && bNull) return 0;
  if (aNull) return 1; // nulls go last
  if (bNull) return -1;
  if (a < b) return -1 * dir;
  if (a > b) return 1 * dir;
  return 0;
}

/**
 * @param {EnrichedUser[]} users
 * @param {SortMode} mode
 * @param {15|30|50|100|Infinity} pageSize
 * @returns {EnrichedUser[]}
 */
export function applySortFilterAndPage(users, mode, pageSize) {
  const list = Array.isArray(users) ? users.slice() : [];

  // 1) age range filter
  const ageRange = mode?.ageRange ?? null;
  let filtered = list;
  if (ageRange && typeof ageRange.min === 'number' && typeof ageRange.max === 'number') {
    filtered = filtered.filter((u) => typeof u?.age === 'number' && u.age >= ageRange.min && u.age <= ageRange.max);
  }

  // 2) birth month filter
  const birthMonth = typeof mode?.birthMonth === 'number' ? mode.birthMonth : null;
  if (birthMonth && birthMonth >= 1 && birthMonth <= 12) {
    filtered = filtered.filter((u) => {
      const dob = typeof u?.dateOfBirth === 'string' ? u.dateOfBirth : null;
      if (!dob) return false;
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
      if (!m) return false;
      const mo = Number(m[2]);
      return mo === birthMonth;
    });
  }

  // 3) sort
  const field = mode?.field ?? 'username';
  const direction = mode?.direction ?? 'asc';

  filtered.sort((a, b) => {
    if (field === 'registeredAt') return compareNullable(a?.registeredAt ?? null, b?.registeredAt ?? null, direction);
    if (field === 'age') return compareNullable(a?.age ?? null, b?.age ?? null, direction);
    if (field === 'birthMonth') {
      const aMo = typeof a?.dateOfBirth === 'string' ? Number(a.dateOfBirth.slice(5, 7)) : null;
      const bMo = typeof b?.dateOfBirth === 'string' ? Number(b.dateOfBirth.slice(5, 7)) : null;
      const aVal = Number.isFinite(aMo) ? aMo : null;
      const bVal = Number.isFinite(bMo) ? bMo : null;
      return compareNullable(aVal, bVal, direction);
    }
    // username (default)
    const an = typeof a?.username === 'string' ? a.username.toLowerCase() : null;
    const bn = typeof b?.username === 'string' ? b.username.toLowerCase() : null;
    return compareNullable(an, bn, direction);
  });

  // 4) pagination (no paging during search; callers enforce)
  if (pageSize === Infinity) return filtered;
  const n = typeof pageSize === 'number' ? pageSize : 15;
  return filtered.slice(0, Math.max(0, n));
}

function recomputeDisplayed(nextAllUsers) {
  userDirectoryStore.update((s) => {
    const allUsers = Array.isArray(nextAllUsers) ? nextAllUsers : s.allUsers;
    if (s.isSearching && s.searchQuery.trim().length > 0) {
      const q = s.searchQuery.trim().toLowerCase();
      const matches = allUsers.filter((u) => String(u?.username ?? '').toLowerCase().includes(q));
      return { ...s, allUsers, displayedUsers: matches, isLoading: false };
    }

    const displayed = applySortFilterAndPage(allUsers, s.sortMode, s.pageSize);
    return { ...s, allUsers, displayedUsers: displayed, isLoading: false };
  });
}

export async function loadUsers() {
  userDirectoryStore.update((s) => ({ ...s, isLoading: true }));
  const users = await getAllRegisteredUsers();
  userDirectoryStore.update((s) => ({ ...s, lastLoaded: Date.now(), allUsers: users }));
  recomputeDisplayed(users);
}

export async function refreshUsers() {
  // Preserve current filters/search/pageSize; just re-fetch data.
  userDirectoryStore.update((s) => ({ ...s, isLoading: true }));
  const users = await getAllRegisteredUsers();
  userDirectoryStore.update((s) => ({ ...s, lastLoaded: Date.now(), allUsers: users }));
  recomputeDisplayed(users);
}

/**
 * @param {Partial<SortMode>} mode
 */
export function setSortMode(mode) {
  const patch = mode && typeof mode === 'object' ? mode : {};
  userDirectoryStore.update((s) => {
    if (s.isSearching) return s;
    const nextMode = { ...s.sortMode, ...patch };
    const displayed = applySortFilterAndPage(s.allUsers, nextMode, s.pageSize);
    return { ...s, sortMode: nextMode, displayedUsers: displayed };
  });
}

/**
 * @param {15|30|50|100|Infinity} size
 */
export function setPageSize(size) {
  userDirectoryStore.update((s) => {
    if (s.isSearching) return s;
    const nextSize = size === Infinity ? Infinity : Number(size);
    const displayed = applySortFilterAndPage(s.allUsers, s.sortMode, nextSize);
    return { ...s, pageSize: nextSize, displayedUsers: displayed };
  });
}

export function resetFilters() {
  userDirectoryStore.update((s) => {
    const next = {
      ...s,
      searchQuery: '',
      isSearching: false,
      sortMode: { ...DEFAULT_SORT_MODE },
      pageSize: 15
    };
    return {
      ...next,
      displayedUsers: applySortFilterAndPage(next.allUsers, next.sortMode, next.pageSize)
    };
  });
}

export function __getStateForTests() {
  return get(userDirectoryStore);
}

