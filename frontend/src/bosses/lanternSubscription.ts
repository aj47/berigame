import type { DbConnection } from '../module_bindings';
import { subscribeRunFight } from './spireSubscription';

/**
 * Lanternmaw's per-run fight subscription (BOSSES.md 9.12), the Spire's rule on the lantern tables: follows your
 * lantern_member row and subscribes `SELECT * FROM lantern_fight WHERE run_id = <id>` for its run only.
 */
export function subscribeLantern(conn: DbConnection, identityHex: string, onError: () => void): () => void {
  return subscribeRunFight(conn, identityHex, 'lanternMember', 'lantern_fight', onError);
}
