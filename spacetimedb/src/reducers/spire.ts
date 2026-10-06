import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';

/**
 * The Sunken Spire's party reducers (FINAL_SPEC 5.1 with the CORE_SCOPE cuts:
 * every lobby is public, no practice runs, no kick, no queue). `clientRules`
 * is the caller's SPIRE_RULES_VERSION: an older bundle is refused.
 *
 * WP0 stubs with the final argument schemas; WP4 fills them in.
 */

/** Open a public lobby at the Spire Gate (you lead it; you need a spire_key). */
export const spireOpen = spacetimedb.reducer(
  { clientRules: t.u32() },
  (_ctx, _args) => {
    throw new SenderError('This boss is not ready yet');
  }
);

/** Join a lobby by run id, or quick-join the newest open lobby with runId 0. */
export const spireJoin = spacetimedb.reducer(
  { runId: t.u64(), clientRules: t.u32() },
  (_ctx, _args) => {
    throw new SenderError('This boss is not ready yet');
  }
);

/** Leave a lobby, or forfeit a run (no rewards). */
export const spireLeave = spacetimedb.reducer((_ctx) => {
  throw new SenderError('This boss is not ready yet');
});

/** The leader starts the run: every member's key is spent and the party descends. */
export const spireStart = spacetimedb.reducer(
  { clientRules: t.u32() },
  (_ctx, _args) => {
    throw new SenderError('This boss is not ready yet');
  }
);
