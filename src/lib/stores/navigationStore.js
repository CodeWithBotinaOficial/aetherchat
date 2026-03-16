import { writable } from 'svelte/store';

/** @type {import('svelte/store').Writable<'global'|'private'|'terms'>} */
export const activeTab = writable('global');

