import { writable } from 'svelte/store';

/** @type {import('svelte/store').Writable<'global'|'private'|'users'|'terms'>} */
export const activeTab = writable('global');
