export function formatRelativeTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function formatAbsoluteTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatMessageTime(timestamp) {
  const diff = Date.now() - timestamp;
  if (diff < 3600000) return formatRelativeTime(timestamp); // < 1h: relative
  return formatAbsoluteTime(timestamp);
}

/**
 * Calculate age (completed years) from an ISO date string `YYYY-MM-DD`.
 * @param {string} dateOfBirth
 * @param {Date} [today=new Date()]
 * @returns {number}
 */
export function calculateAge(dateOfBirth, today = new Date()) {
  const raw = String(dateOfBirth ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return 0;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return 0;
  if (mo < 1 || mo > 12) return 0;
  if (d < 1 || d > 31) return 0;

  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const td = today.getDate();

  let age = ty - y;
  // If birthday hasn't happened yet this year, subtract one.
  if (tm < mo || (tm === mo && td < d)) age -= 1;
  return Math.max(0, age);
}

/**
 * Returns true if today is the user's birthday (same month + day).
 * @param {string} dateOfBirth
 * @param {Date} [today=new Date()]
 * @returns {boolean}
 */
export function isBirthday(dateOfBirth, today = new Date()) {
  const raw = String(dateOfBirth ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return false;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(mo) || !Number.isFinite(d)) return false;
  return today.getMonth() + 1 === mo && today.getDate() === d;
}
