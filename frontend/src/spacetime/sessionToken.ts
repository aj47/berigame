/** Browser credentials are scoped to the server and world, never logged. */
export const LEGACY_TOKEN_KEY = 'berigame_stdb_token';
const LEGACY_CLAIM_KEY = `${LEGACY_TOKEN_KEY}:migrated_to`;

export function sessionTokenKey(uri: string, database: string): string {
  const server = new URL(uri);
  server.protocol = server.protocol === 'https:' ? 'wss:' : server.protocol === 'http:' ? 'ws:' : server.protocol;
  return `${LEGACY_TOKEN_KEY}:v2:${encodeURIComponent(server.toString().replace(/\/$/, ''))}:${encodeURIComponent(database)}`;
}

export function readSessionToken(storage: Storage, uri: string, database: string): string | undefined {
  const key = sessionTokenKey(uri, database);
  const scoped = storage.getItem(key);
  if (scoped) return scoped;
  const server = new URL(uri);
  const localDefault = ['localhost', '127.0.0.1', '[::1]'].includes(server.hostname) && server.port === '3000';
  const legacy = storage.getItem(LEGACY_TOKEN_KEY);
  // Preserve the existing local character once. An unscoped credential must
  // not be replayed against every new server/world the frontend is pointed at.
  if (legacy && localDefault && !storage.getItem(LEGACY_CLAIM_KEY)) {
    storage.setItem(key, legacy);
    storage.setItem(LEGACY_CLAIM_KEY, key);
    return legacy;
  }
  return undefined;
}

/** Called only by an explicit user action; backup must succeed before removal. */
export function resetSessionToken(storage: Storage, key: string): void {
  const saved = storage.getItem(key);
  if (saved) storage.setItem(`${key}:backup:${Date.now()}`, saved);
  storage.removeItem(key);
}

/** This is a recovery hint, not authentication or signature verification. */
export function visiblyInvalidToken(token: string | undefined): boolean {
  if (!token) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return true;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload !== 'object' || payload === null || (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now());
  } catch { return true; }
}
