import { get } from 'svelte/store';
import { fireEvent, render, screen } from '@testing-library/svelte';

import { db } from '$lib/services/db/schema.js';
import { registerUsernameLocally } from '$lib/services/db/registry.db.js';

import { peer as peerStore } from '$lib/stores/peerStore.js';

import { userDirectoryStore, DEFAULT_SORT_MODE } from '$lib/stores/userDirectory/state.js';
import { loadUsers, refreshUsers, resetFilters, setPageSize, setSortMode } from '$lib/stores/userDirectory/filters.js';
import { setSearch } from '$lib/stores/userDirectory/search.js';

import UserCard from '$lib/components/userDirectory/UserCard.svelte';
import UserDirectoryGrid from '$lib/components/userDirectory/UserDirectoryGrid.svelte';
import UserDirectoryPagination from '$lib/components/userDirectory/UserDirectoryPagination.svelte';

async function clearAllTables() {
  await db.transaction(
    'rw',
    db.users,
    db.globalMessages,
    db.privateChats,
    db.privateMessages,
    db.sentMessagesPlaintext,
    db.sessionKeys,
    db.queuedMessages,
    db.queuedActions,
    db.knownPeers,
    db.usernameRegistry,
    db.peerIds,
    db.cooldown,
    db.follows,
    db.wallComments,
    async () => {
      await Promise.all([
        db.users.clear(),
        db.globalMessages.clear(),
        db.privateChats.clear(),
        db.privateMessages.clear(),
        db.sentMessagesPlaintext.clear(),
        db.sessionKeys.clear(),
        db.queuedMessages.clear(),
        db.queuedActions.clear(),
        db.knownPeers.clear(),
        db.usernameRegistry.clear(),
        db.peerIds.clear(),
        db.cooldown.clear(),
        db.follows.clear(),
        db.wallComments.clear()
      ]);
    }
  );
}

function resetUserDirectoryStore() {
  userDirectoryStore.set({
    allUsers: [],
    displayedUsers: [],
    searchQuery: '',
    sortMode: { ...DEFAULT_SORT_MODE },
    pageSize: 15,
    isSearching: false,
    isLoading: false,
    lastLoaded: null
  });
}

describe('DB helper: getAllRegisteredUsers', () => {
  beforeEach(async () => {
    await clearAllTables();
  });

  it('returns array of EnrichedUser objects and sets age/isBirthday', async () => {
    const { getAllRegisteredUsers } = await import('$lib/services/db/registry.db.js');

    // Local user (so we exercise enrichment priority #1).
    await db.users.put({
      id: 1,
      username: 'Alice',
      dateOfBirth: '2000-05-16',
      color: 'x',
      avatarBase64: null,
      bio: 'hello',
      createdAt: Date.now()
    });
    await db.peerIds.put({ username: 'Alice', peerId: 'me' });

    await registerUsernameLocally({
      username: 'Alice',
      peerId: 'me',
      registeredAt: 111,
      lastSeenAt: Date.now()
    });

    // Remote user (registry-only fallback)
    await registerUsernameLocally({
      username: 'bob',
      peerId: 'p2',
      registeredAt: 222,
      lastSeenAt: Date.now()
    });

    const list = await getAllRegisteredUsers();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(2);

    const alice = list.find((u) => u.peerId === 'me');
    expect(alice).toBeTruthy();
    expect(alice.username).toBe('Alice');
    expect(alice.registeredAt).toBe(111);
    expect(alice.dateOfBirth).toBe('2000-05-16');
    expect(typeof alice.age).toBe('number');
    expect(typeof alice.isBirthday).toBe('boolean');

    const bob = list.find((u) => u.peerId === 'p2');
    expect(bob).toBeTruthy();
    expect(bob.username).toBe('bob');
    expect(bob.dateOfBirth).toBeNull();
    expect(bob.age).toBeNull();
    expect(bob.isBirthday).toBe(false);
  });
});

describe('Store: filters.js', () => {
  beforeEach(async () => {
    await clearAllTables();
    resetUserDirectoryStore();
  });

  it('loadUsers populates allUsers and applies default sort', async () => {
    await registerUsernameLocally({ username: 'bob', peerId: 'p2', registeredAt: 2, lastSeenAt: Date.now() });
    await registerUsernameLocally({ username: 'alice', peerId: 'p1', registeredAt: 1, lastSeenAt: Date.now() });

    await loadUsers();
    const st = get(userDirectoryStore);
    expect(st.allUsers).toHaveLength(2);
    expect(st.displayedUsers.map((u) => u.username)).toEqual(['alice', 'bob']);
  });

  it('resetFilters restores defaults and recomputes displayedUsers', () => {
    userDirectoryStore.set({
      allUsers: [
        { username: 'b', peerId: 'p2', registeredAt: 2, dateOfBirth: null, age: null, bio: '', avatarBase64: null, isBirthday: false },
        { username: 'a', peerId: 'p1', registeredAt: 1, dateOfBirth: null, age: null, bio: '', avatarBase64: null, isBirthday: false }
      ],
      displayedUsers: [],
      searchQuery: 'x',
      sortMode: { field: 'registeredAt', direction: 'desc', ageRange: { min: 18, max: 20 }, birthMonth: 5 },
      pageSize: 30,
      isSearching: true,
      isLoading: false,
      lastLoaded: null
    });

    resetFilters();
    const st = get(userDirectoryStore);
    expect(st.sortMode).toEqual(DEFAULT_SORT_MODE);
    expect(st.pageSize).toBe(15);
    expect(st.searchQuery).toBe('');
    expect(st.isSearching).toBe(false);
    expect(st.displayedUsers.map((u) => u.username)).toEqual(['a', 'b']);
  });

  it('setSortMode({ field: username, direction: asc }) sorts alphabetically', () => {
    userDirectoryStore.set({
      ...get(userDirectoryStore),
      allUsers: [
        { username: 'bob', peerId: 'p2', registeredAt: 2, dateOfBirth: null, age: null, bio: '', avatarBase64: null, isBirthday: false },
        { username: 'alice', peerId: 'p1', registeredAt: 1, dateOfBirth: null, age: null, bio: '', avatarBase64: null, isBirthday: false }
      ],
      isSearching: false,
      searchQuery: ''
    });
    setSortMode({ field: 'username', direction: 'asc' });
    expect(get(userDirectoryStore).displayedUsers.map((u) => u.username)).toEqual(['alice', 'bob']);
  });

  it('setSortMode({ field: registeredAt, direction: desc }) sorts newest first', () => {
    userDirectoryStore.set({
      ...get(userDirectoryStore),
      allUsers: [
        { username: 'old', peerId: 'p1', registeredAt: 1, dateOfBirth: null, age: null, bio: '', avatarBase64: null, isBirthday: false },
        { username: 'new', peerId: 'p2', registeredAt: 2, dateOfBirth: null, age: null, bio: '', avatarBase64: null, isBirthday: false }
      ],
      isSearching: false,
      searchQuery: ''
    });
    setSortMode({ field: 'registeredAt', direction: 'desc' });
    expect(get(userDirectoryStore).displayedUsers.map((u) => u.username)).toEqual(['new', 'old']);
  });

  it('setSortMode({ field: age, direction: asc }) sorts by age ascending, null ages last', () => {
    userDirectoryStore.set({
      ...get(userDirectoryStore),
      allUsers: [
        { username: 'c', peerId: 'p3', registeredAt: 3, dateOfBirth: null, age: null, bio: '', avatarBase64: null, isBirthday: false },
        { username: 'a', peerId: 'p1', registeredAt: 1, dateOfBirth: '2000-01-01', age: 20, bio: '', avatarBase64: null, isBirthday: false },
        { username: 'b', peerId: 'p2', registeredAt: 2, dateOfBirth: '2002-01-01', age: 18, bio: '', avatarBase64: null, isBirthday: false }
      ],
      isSearching: false,
      searchQuery: ''
    });
    setSortMode({ field: 'age', direction: 'asc' });
    expect(get(userDirectoryStore).displayedUsers.map((u) => u.username)).toEqual(['b', 'a', 'c']);
  });

  it('setSortMode({ birthMonth: 5 }) filters to users born in May', () => {
    userDirectoryStore.set({
      ...get(userDirectoryStore),
      allUsers: [
        { username: 'm1', peerId: 'm1', registeredAt: 1, dateOfBirth: '2000-05-01', age: 1, bio: '', avatarBase64: null, isBirthday: false },
        { username: 'm2', peerId: 'm2', registeredAt: 2, dateOfBirth: '2000-06-01', age: 1, bio: '', avatarBase64: null, isBirthday: false }
      ],
      isSearching: false,
      searchQuery: ''
    });
    setSortMode({ birthMonth: 5 });
    expect(get(userDirectoryStore).displayedUsers.map((u) => u.username)).toEqual(['m1']);
  });

  it('setSortMode({ ageRange: { min, max } }) filters by age range', () => {
    userDirectoryStore.set({
      ...get(userDirectoryStore),
      allUsers: [
        { username: 'u1', peerId: 'u1', registeredAt: 1, dateOfBirth: null, age: 17, bio: '', avatarBase64: null, isBirthday: false },
        { username: 'u2', peerId: 'u2', registeredAt: 2, dateOfBirth: null, age: 30, bio: '', avatarBase64: null, isBirthday: false }
      ],
      isSearching: false,
      searchQuery: ''
    });
    setSortMode({ ageRange: { min: 18, max: 25 } });
    expect(get(userDirectoryStore).displayedUsers).toHaveLength(0);
  });

  it('setPageSize(30) limits displayedUsers; setPageSize(Infinity) shows all users', () => {
    userDirectoryStore.set({
      ...get(userDirectoryStore),
      allUsers: Array.from({ length: 80 }).map((_, i) => ({
        username: `u${String(i).padStart(3, '0')}`,
        peerId: `p${i}`,
        registeredAt: i,
        dateOfBirth: null,
        age: null,
        bio: '',
        avatarBase64: null,
        isBirthday: false
      })),
      isSearching: false,
      searchQuery: ''
    });
    setPageSize(30);
    expect(get(userDirectoryStore).displayedUsers).toHaveLength(30);
    setPageSize(Infinity);
    expect(get(userDirectoryStore).displayedUsers).toHaveLength(80);
  });

  it('refreshUsers reloads from DB and preserves current sortMode and pageSize', async () => {
    await registerUsernameLocally({ username: 'bob', peerId: 'p2', registeredAt: 2, lastSeenAt: Date.now() });
    await registerUsernameLocally({ username: 'alice', peerId: 'p1', registeredAt: 1, lastSeenAt: Date.now() });
    await loadUsers();

    setSortMode({ field: 'registeredAt', direction: 'desc' });
    setPageSize(30);

    // Add another user to DB and refresh.
    await registerUsernameLocally({ username: 'charlie', peerId: 'p3', registeredAt: 3, lastSeenAt: Date.now() });
    await refreshUsers();

    const st = get(userDirectoryStore);
    expect(st.sortMode.field).toBe('registeredAt');
    expect(st.sortMode.direction).toBe('desc');
    expect(st.pageSize).toBe(30);
    expect(st.allUsers).toHaveLength(3);
  });
});

describe('Store: search.js', () => {
  beforeEach(() => {
    resetUserDirectoryStore();
  });

  it("setSearch('ali') filters by username contains (case-insensitive)", () => {
    userDirectoryStore.set({
      ...get(userDirectoryStore),
      allUsers: [
        { username: 'Alice', peerId: 'a', registeredAt: 1, dateOfBirth: null, age: null, bio: '', avatarBase64: null, isBirthday: false },
        { username: 'Bob', peerId: 'b', registeredAt: 2, dateOfBirth: null, age: null, bio: '', avatarBase64: null, isBirthday: false }
      ],
      isSearching: false,
      searchQuery: '',
      pageSize: 1
    });

    setSearch('ali');
    expect(get(userDirectoryStore).isSearching).toBe(true);
    expect(get(userDirectoryStore).displayedUsers.map((u) => u.username)).toEqual(['Alice']);
  });

  it("setSearch('') restores pre-search displayedUsers with preserved sortMode", () => {
    userDirectoryStore.set({
      ...get(userDirectoryStore),
      allUsers: [
        { username: 'a', peerId: 'a', registeredAt: 1, dateOfBirth: null, age: null, bio: '', avatarBase64: null, isBirthday: false },
        { username: 'b', peerId: 'b', registeredAt: 2, dateOfBirth: null, age: null, bio: '', avatarBase64: null, isBirthday: false },
        { username: 'c', peerId: 'c', registeredAt: 3, dateOfBirth: null, age: null, bio: '', avatarBase64: null, isBirthday: false }
      ],
      sortMode: { field: 'registeredAt', direction: 'desc', ageRange: null, birthMonth: null },
      pageSize: 2,
      isSearching: false,
      searchQuery: ''
    });

    setSearch('a');
    expect(get(userDirectoryStore).isSearching).toBe(true);
    setSearch('');
    expect(get(userDirectoryStore).isSearching).toBe(false);
    expect(get(userDirectoryStore).displayedUsers.map((u) => u.username)).toEqual(['c', 'b']);
  });

  it('Partial match: al matches Alice, Balthazar, Sal; no match returns empty', () => {
    userDirectoryStore.set({
      ...get(userDirectoryStore),
      allUsers: [
        { username: 'Alice', peerId: 'a', registeredAt: 1, dateOfBirth: null, age: null, bio: '', avatarBase64: null, isBirthday: false },
        { username: 'Balthazar', peerId: 'b', registeredAt: 2, dateOfBirth: null, age: null, bio: '', avatarBase64: null, isBirthday: false },
        { username: 'Sal', peerId: 'c', registeredAt: 3, dateOfBirth: null, age: null, bio: '', avatarBase64: null, isBirthday: false }
      ]
    });

    setSearch('al');
    expect(get(userDirectoryStore).displayedUsers.map((u) => u.username)).toEqual(['Alice', 'Balthazar', 'Sal']);

    setSearch('zzzz');
    expect(get(userDirectoryStore).displayedUsers).toEqual([]);
  });
});

describe('UserCard', () => {
  beforeEach(() => {
    peerStore.set({
      peerId: null,
      isConnected: false,
      connectionState: 'offline',
      error: null,
      reconnectAttempt: 0,
      isLobbyHost: false,
      lobbyPeer: null,
      currentLobbyHostId: null,
      lastSyncAt: null,
      connectedPeers: new Map()
    });
  });

  it('Birthday card renders birthday label when isBirthday is true', () => {
    render(UserCard, {
      props: {
        user: {
          username: 'alice',
          peerId: 'p1',
          registeredAt: 1,
          dateOfBirth: '2000-01-01',
          age: 20,
          bio: '',
          avatarBase64: null,
          isBirthday: true
        }
      }
    });
    expect(screen.getByText(/Birthday today!/i)).toBeInTheDocument();
  });

  it('Birthday card does not render birthday label when isBirthday is false', () => {
    render(UserCard, {
      props: {
        user: {
          username: 'alice',
          peerId: 'p1',
          registeredAt: 1,
          dateOfBirth: '2000-01-01',
          age: 20,
          bio: '',
          avatarBase64: null,
          isBirthday: false
        }
      }
    });
    expect(screen.queryByText(/Birthday today!/i)).toBeNull();
  });

  it('Age shows "—" when dateOfBirth is null', () => {
    render(UserCard, {
      props: {
        user: {
          username: 'alice',
          peerId: 'p1',
          registeredAt: 1,
          dateOfBirth: null,
          age: null,
          bio: '',
          avatarBase64: null,
          isBirthday: false
        }
      }
    });
    expect(screen.getByText(/Age:\s*—/i)).toBeInTheDocument();
  });

  it('Bio is not rendered when empty', () => {
    const { container } = render(UserCard, {
      props: {
        user: {
          username: 'alice',
          peerId: 'p1',
          registeredAt: 1,
          dateOfBirth: null,
          age: null,
          bio: '',
          avatarBase64: null,
          isBirthday: false
        }
      }
    });
    expect(container.querySelector('.bio')).toBeNull();
  });
});

describe('Pagination', () => {
  beforeEach(() => {
    resetUserDirectoryStore();
  });

  it('Page size selector not shown when allUsers.length <= 15', () => {
    userDirectoryStore.set({
      ...get(userDirectoryStore),
      allUsers: Array.from({ length: 15 }).map((_, i) => ({
        username: `u${i}`,
        peerId: `p${i}`,
        registeredAt: i,
        dateOfBirth: null,
        age: null,
        bio: '',
        avatarBase64: null,
        isBirthday: false
      })),
      displayedUsers: Array.from({ length: 15 }).map((_, i) => ({
        username: `u${i}`,
        peerId: `p${i}`,
        registeredAt: i,
        dateOfBirth: null,
        age: null,
        bio: '',
        avatarBase64: null,
        isBirthday: false
      })),
      isSearching: false,
      isLoading: false
    });

    render(UserDirectoryGrid);
    expect(screen.queryByLabelText(/user directory pagination controls/i)).toBeNull();
  });

  it('"View All Users" button appears when pageSize === 100 and total > 100', () => {
    userDirectoryStore.set({
      ...get(userDirectoryStore),
      allUsers: Array.from({ length: 120 }).map((_, i) => ({
        username: `u${i}`,
        peerId: `p${i}`,
        registeredAt: i,
        dateOfBirth: null,
        age: null,
        bio: '',
        avatarBase64: null,
        isBirthday: false
      })),
      displayedUsers: Array.from({ length: 100 }).map((_, i) => ({
        username: `u${i}`,
        peerId: `p${i}`,
        registeredAt: i,
        dateOfBirth: null,
        age: null,
        bio: '',
        avatarBase64: null,
        isBirthday: false
      })),
      pageSize: 100,
      isSearching: false,
      isLoading: false
    });

    render(UserDirectoryGrid);
    expect(screen.getByRole('button', { name: /view all users/i })).toBeInTheDocument();
  });

  it('Selecting 30 calls setPageSize(30) (via store update)', async () => {
    userDirectoryStore.set({
      ...get(userDirectoryStore),
      allUsers: Array.from({ length: 40 }).map((_, i) => ({
        username: `u${i}`,
        peerId: `p${i}`,
        registeredAt: i,
        dateOfBirth: null,
        age: null,
        bio: '',
        avatarBase64: null,
        isBirthday: false
      })),
      displayedUsers: Array.from({ length: 15 }).map((_, i) => ({
        username: `u${i}`,
        peerId: `p${i}`,
        registeredAt: i,
        dateOfBirth: null,
        age: null,
        bio: '',
        avatarBase64: null,
        isBirthday: false
      })),
      pageSize: 15,
      isSearching: false,
      isLoading: false
    });

    render(UserDirectoryPagination);
    const btn = screen.getByRole('button', { name: /show 30 users/i });
    await fireEvent.click(btn);
    expect(get(userDirectoryStore).pageSize).toBe(30);
  });
});

