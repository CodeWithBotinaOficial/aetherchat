import { writable } from 'svelte/store';

const STORAGE_KEY = 'aetherchat_image_recents';
const MAX_RECENTS = 20;

/**
 * @typedef {Object} ImageRecentEntry
 * @property {string} transferId
 * @property {string} filename
 * @property {string} mimeType
 * @property {number} sizeBytes
 * @property {number} sentAt
 */

function createStore() {
  let initial = [];
  if (typeof localStorage !== 'undefined') {
    try {
      initial = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (err) {
      console.warn('Failed to parse imageRecents from localStorage', err);
    }
  }

  const { subscribe, update } = writable(initial);

  return {
    subscribe,
    /**
     * @param {ImageRecentEntry} entry
     */
    addImageRecent: (entry) => {
      update((current) => {
        const filtered = current.filter((r) => r.transferId !== entry.transferId);
        const next = [entry, ...filtered].slice(0, MAX_RECENTS);
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          } catch (err) {
            console.warn('Failed to write imageRecents to localStorage', err);
          }
        }
        return next;
      });
    }
  };
}

export const imageRecents = createStore();
