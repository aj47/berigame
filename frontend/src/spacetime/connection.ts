import { subscribeFrontier } from './frontierSubscription';
import { subscribeSpire } from '../bosses/spireSubscription';
import { DbConnection, tables } from '../module_bindings';
import { useLoadingStore } from '../store';
import { startInterest, type InterestConn, type InterestManager } from './interestSubscription';
import { worldQueries, WORLD_TABLES } from './worldSubscription';

import { abortPendingCalls } from './pendingCalls';
import { readSessionToken, sessionTokenKey, visiblyInvalidToken } from './sessionToken';
import { reportSignedOut } from './visitRenewal';

const env = (import.meta as any).env ?? {};
export const SPACETIME_URI: string = env.VITE_SPACETIME_URI ?? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:3000`;
export const SPACETIME_DB: string = env.VITE_SPACETIME_DB ?? 'berigame';
export const TOKEN_KEY = sessionTokenKey(SPACETIME_URI, SPACETIME_DB);

function readToken(): string | undefined {
  try {
    return readSessionToken(localStorage, SPACETIME_URI, SPACETIME_DB);
  } catch {
    return undefined;
  }
}

function saveToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode etc. */
  }
}

/**
 * One connection builder for the whole app. The token persisted in
 * localStorage is what gives a browser a stable identity across refreshes,
 * which is what keeps its HP and inventory.
 */
/**
 * Connection lifecycle listeners (the reconnect controller in
 * SpacetimeProvider). Each connection reports "lost" at most once, whether it
 * failed to open, closed, or was dropped by us as a zombie.
 */
type Listener = { connected: () => void; lost: () => void };
let lifecycle: Listener | null = null;
export function setConnectionLifecycle(listener: Listener | null): void {
  lifecycle = listener;
}
const lostConnections = new WeakSet<object>();
const interests = new WeakMap<object, InterestManager>();

/** Ask the live connection for players' names it has not seen (one-shot lookups; see playerNames.ts). */
export function wantPlayerNames(hexes: Iterable<string>): void {
  const conn = current && typeof current === 'object' ? interests.get(current) : undefined;
  conn?.wantNames(hexes);
}
let current: unknown = null;
/** The live connection, if any (for dropping a zombie socket). */
export function currentConnection(): unknown {
  return current;
}

/**
 * Declare a connection dead: close it (marking the close as requested so the
 * SDK's built-in auto-reconnect stands down and ours owns the retry timing),
 * reset client state that depended on it, and notify the controller.
 */
export function markConnectionLost(conn: unknown, stale = false): void {
  const key = (conn && typeof conn === 'object') ? conn : null;
  if (key && key === current) current = null;
  if (key) { interests.get(key)?.dispose(); interests.delete(key); }
  if (key) {
    if (lostConnections.has(key)) return;
    lostConnections.add(key);
    try { (key as any).disconnect?.(); } catch { /* already closed */ }
  }
  // A late failure from a superseded attempt must not disturb the current one.
  if (stale) return;
  const loading = useLoadingStore.getState();
  loading.setWebsocketConnected(false);
  loading.setGameDataLoaded(false);
  abortPendingCalls();
  lifecycle?.lost();
}

let buildSeq = 0;
/** The newest attempt that has connected; failures from older attempts are ignored. */
let connectedSeq = 0;
/**
 * The key SpacetimeDBProvider pools this builder's connection under. The SDK's
 * ConnectionManager keys connections by `getUri()::getModuleName()`, and
 * `retain()` keeps handing back the existing connection (ignoring a new
 * builder) until that connection's `onclose` arrives, which on a dead network
 * or a zombie socket can take tens of seconds. Its `rebuild()` escape hatch
 * is not exported from `spacetimedb/react`, so each attempt gets its own key
 * instead: a new builder always opens a new socket at once, and the previous
 * entry is released (and its socket closed) by the provider. `getUri()` is
 * used only for that key; the socket URL comes from `withUri`.
 */
export function poolKeyUri(seq: number): string {
  return `${SPACETIME_URI}#attempt-${seq}`;
}

export function buildConnection() {
  const seq = ++buildSeq;
  const savedToken = readToken();
  const builder = connectionBuilder(seq, savedToken);
  builder.getUri = () => poolKeyUri(seq);
  return builder;
}

function connectionBuilder(seq: number, savedToken: string | undefined) {
  return DbConnection.builder()
    .withUri(SPACETIME_URI)
    .withDatabaseName(SPACETIME_DB)
    .withToken(savedToken)
    .onConnect((conn, identity, token) => {
      saveToken(token);
      current = conn;
      connectedSeq = Math.max(connectedSeq, seq);
      lifecycle?.connected();
      useLoadingStore.getState().setConnectionIssue(null, false);
      console.log('SpacetimeDB connected as', identity.toHexString().slice(0, 8));
      useLoadingStore.getState().setWebsocketConnected(true);
      subscribeFrontier(conn, identity.toHexString(), () => useLoadingStore.getState().setGameDataLoaded(false));
      // Your Spire run's fight row only (a per-run SQL subscription that follows your spire_member row).
      subscribeSpire(conn, identity.toHexString(), () => console.error('Spire fight subscription failed'));
      // Nearby players, nodes and ground items, plus your target, friends, crew and party (interestSubscription.ts).
      const interest = startInterest(conn as unknown as InterestConn, identity.toHexString(), () => console.error('Nearby world subscription failed'));
      interests.set(conn, interest);
      conn
        .subscriptionBuilder()
        // The loading screen lifts once the block around you has arrived too, so the world does not pop in.
        .onApplied(() => interest.whenReady(() => useLoadingStore.getState().setGameDataLoaded(true)))
        .onError((_ctx, err) => {
          console.error('World subscription failed');
          useLoadingStore.getState().setGameDataLoaded(false);
          useLoadingStore.getState().setLoadingMessage('The world could not be loaded. Rejoin to try again.');
        })
        .subscribe([...WORLD_TABLES.map((name) => (tables as any)[name]), ...worldQueries(), tables.bossNotice.where((row) => row.player.eq(identity))]);
    })
    .onConnectError((ctx, error) => {
      console.error('Game server connection failed');
      markConnectionLost(ctx, seq < connectedSeq);
      // The permit ended while this tab still held it (an idle logout, for one): ask the gateway, don't retry.
      if (/access required or expired/.test(error instanceof Error ? error.message : String(error))) reportSignedOut();
      useLoadingStore.getState().setConnectionIssue(
        /world is full/.test(error instanceof Error ? error.message : String(error))
          ? 'This world is full. Your character is saved; we will retry when a place is available.'
          : visiblyInvalidToken(savedToken)
          ? 'Your saved sign-in is invalid or expired. Rejoin to retry, or use sign-in recovery below.'
          : 'Cannot reach the game server. Rejoin to try again.',
        Boolean(savedToken),
      );
    })
    .onDisconnect((ctx) => {
      console.warn('SpacetimeDB disconnected');
      markConnectionLost(ctx, seq < connectedSeq);
    });
}
