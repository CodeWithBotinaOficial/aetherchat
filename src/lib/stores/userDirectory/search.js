import { userDirectoryStore } from './state.js';
import { applySortFilterAndPage } from './filters.js';

/**
 * @typedef {import('$lib/services/db.js').EnrichedUser} EnrichedUser
 */

/**
 * @param {string} query
 */
export function setSearch(query) {
  const q = String(query ?? '');
  userDirectoryStore.update((s) => {
    const nextQuery = q;
    const trimmed = nextQuery.trim();
    const isSearching = trimmed.length > 0;

    if (isSearching) {
      const lower = trimmed.toLowerCase();
      /** @type {EnrichedUser[]} */
      const matches = s.allUsers.filter((u) => String(u?.username ?? '').toLowerCase().includes(lower));
      // During search: ignore sort + pagination and show all matches.
      return {
        ...s,
        searchQuery: nextQuery,
        isSearching: true,
        displayedUsers: matches
      };
    }

    // Search cleared: restore sort/filter/page size.
    return {
      ...s,
      searchQuery: '',
      isSearching: false,
      displayedUsers: applySortFilterAndPage(s.allUsers, s.sortMode, s.pageSize)
    };
  });
}

