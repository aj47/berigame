import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { requireOwner } from '../lib/access';

/**
 * World-owner switches for both bosses (FINAL_SPEC 5.1). `configure_bosses`
 * upserts the boss_config row and applies opening/closing effects at once;
 * `boss_debug` drives live checks. `spirePracticeOpen` is stored but unused in
 * this release (practice runs are cut).
 *
 * WP0 stubs with the final argument schemas; WP6 fills in validation and
 * dispatch (effects live in lib/clatterhorn.ts and lib/spire.ts).
 */
export const configureBosses = spacetimedb.reducer(
  {
    clatterhornOpen: t.bool(),
    spireOpen: t.bool(),
    spirePracticeOpen: t.bool(),
    spireMaxRuns: t.u8(),
    spireHpBase: t.u32(),
    spireHpPerMember: t.u32(),
    clatterHpBase: t.u32(),
    clatterHpPerChallenger: t.u32(),
  },
  (ctx, _args) => {
    requireOwner(ctx);
    throw new SenderError('This boss is not ready yet');
  }
);

export const bossDebug = spacetimedb.reducer(
  { op: t.string(), runId: t.u64(), value: t.u32() },
  (ctx, _args) => {
    requireOwner(ctx);
    throw new SenderError('This boss is not ready yet');
  }
);
