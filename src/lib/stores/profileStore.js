import { writable } from 'svelte/store';

/** @type {import('svelte/store').Writable<boolean>} */
export const isProfileOpen = writable(false);

export function openProfile() {
  isProfileOpen.set(true);
}

export function closeProfile() {
  isProfileOpen.set(false);
}

