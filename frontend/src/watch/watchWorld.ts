import { tables, type DbConnection } from '../module_bindings';
import { WORLD_TABLES } from '../spacetime/worldSubscription';

/**
 * What a spectator holds: the public world, whole. A player's area subscription follows its own position, so a cut to
 * another character, a respawn across the map or a delayed picture would each wait for rows that are not there yet.
 * The cost is one feed per viewer rather than per area, which MAX_SPECTATORS bounds. Rows with row-level security come
 * back empty: a pass owns nothing, so no inventory or friend list ever reaches this page.
 */
export const WATCH_QUERIES = [
  'SELECT * FROM player', 'SELECT * FROM player_pos', 'SELECT * FROM player_skill', 'SELECT * FROM tree', 'SELECT * FROM ground_item',
  'SELECT * FROM combat_event', 'SELECT * FROM dummy_event', 'SELECT * FROM emote_event', 'SELECT * FROM giant_event',
  'SELECT * FROM frontier_object', 'SELECT * FROM spire_fight',
] as const;

export function subscribeWatchWorld(conn: DbConnection, onApplied: () => void, onError: () => void) {
  conn.subscriptionBuilder().onApplied(onApplied).onError(onError)
    .subscribe([...WORLD_TABLES.map((name) => (tables as any)[name]), ...WATCH_QUERIES]);
}

const refuse = () => Promise.reject(new Error('Spectators are read-only'));
/** The page cannot call a reducer at all. The server refuses a pass anyway (spacetimedb/src/schema.ts). */
export function lockReducers(conn: DbConnection) {
  Object.defineProperty(conn, 'reducers', { value: new Proxy({}, { get: () => refuse }) });
}
