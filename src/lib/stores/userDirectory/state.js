import { writable } from 'svelte/store';

/**
 * @typedef {import('$lib/services/db.js').EnrichedUser} EnrichedUser
 */

/**
 * @typedef {'username'|'registeredAt'|'age'|'birthMonth'} SortField
 * @typedef {'asc'|'desc'} SortDirection
 *
 * @typedef {{ min: number, max: number }} AgeRange
 *
 * @typedef {Object} SortMode
 * @property {SortField} field
 * @property {SortDirection} direction
 * @property {AgeRange|null} ageRange
 * @property {number|null} birthMonth 1-12
 */

/** @type {SortMode} */
export const DEFAULT_SORT_MODE = {
  field: 'username',
  direction: 'asc',
  ageRange: null,
  birthMonth: null
};

const initialState = {
  /** @type {EnrichedUser[]} */
  allUsers: [],
  /** @type {EnrichedUser[]} */
  displayedUsers: [],
  searchQuery: '',
  /** @type {SortMode} */
  sortMode: { ...DEFAULT_SORT_MODE },
  /** @type {15|30|50|100|Infinity} */
  pageSize: 15,
  isSearching: false,
  isLoading: false,
  lastLoaded: null
};

const { subscribe, update, set } = writable(initialState);
export const userDirectoryStore = { subscribe, update, set };

