/**
 * Phase 17: replace persisted `age` with `dateOfBirth` (YYYY-MM-DD).
 * Dexie/IndexedDB has no strict column schema, so we explicitly backfill + delete fields.
 *
 * Best-effort migration:
 * - If we only have `age`, approximate DOB as Jan 1 of (currentYear - age).
 *   This preserves minimum-age UX without pretending we know the real birthday.
 *
 * @param {import('dexie').Transaction} tx
 */
export async function upgradeBirthdateV17(tx) {
  const currentYear = new Date().getFullYear();

  const users = tx.table('users');
  await users.toCollection().modify((u) => {
    const hasDob = typeof u?.dateOfBirth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(u.dateOfBirth);
    if (!hasDob) {
      const age = typeof u?.age === 'number' ? u.age : null;
      if (typeof age === 'number' && Number.isFinite(age) && age > 0) {
        u.dateOfBirth = `${currentYear - Math.floor(age)}-01-01`;
      } else {
        u.dateOfBirth = null;
      }
    }
    if (Object.prototype.hasOwnProperty.call(u, 'age')) delete u.age;
  });

  const globalMessages = tx.table('globalMessages');
  await globalMessages.toCollection().modify((m) => {
    const hasDob = typeof m?.dateOfBirth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.dateOfBirth);
    if (!hasDob) {
      const age = typeof m?.age === 'number' ? m.age : null;
      if (typeof age === 'number' && Number.isFinite(age) && age > 0) {
        m.dateOfBirth = `${currentYear - Math.floor(age)}-01-01`;
      } else {
        m.dateOfBirth = null;
      }
    }
    if (Object.prototype.hasOwnProperty.call(m, 'age')) delete m.age;
  });

  const privateChats = tx.table('privateChats');
  await privateChats.toCollection().modify((c) => {
    const hasDob =
      typeof c?.theirDateOfBirth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.theirDateOfBirth);
    if (!hasDob) {
      const age = typeof c?.theirAge === 'number' ? c.theirAge : null;
      if (typeof age === 'number' && Number.isFinite(age) && age > 0) {
        c.theirDateOfBirth = `${currentYear - Math.floor(age)}-01-01`;
      } else {
        c.theirDateOfBirth = null;
      }
    }
    if (Object.prototype.hasOwnProperty.call(c, 'theirAge')) delete c.theirAge;
  });
}

