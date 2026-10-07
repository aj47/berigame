import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { BOSS_CONFIG_ID, SpireMode, SpireStage, bossConfigOr, bossConfigProblem, type BossConfigLike } from '../../../shared/sim';
import { requireOwner } from '../lib/access';
import { clatterClose, clatterDebug, clatterOpen } from '../lib/clatterhorn';
import { currentTick } from '../lib/players';
import { spireCloseMode, spireDebug } from '../lib/spire';

/**
 * World-owner switches for both bosses (FINAL_SPEC 5.1, 5.5). `configure_bosses`
 * validates, upserts the boss_config row and applies the opening/closing
 * effects at once; `boss_debug` validates and dispatches the live-check ops.
 * The effects live in lib/clatterhorn.ts (WP5) and lib/spire.ts (WP4).
 * `spirePracticeOpen` is stored but unused in this release (practice runs are cut).
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
  (ctx, args) => {
    requireOwner(ctx);
    const cfg: BossConfigLike = {
      clatterhornOpen: args.clatterhornOpen,
      spireOpen: args.spireOpen,
      spirePracticeOpen: args.spirePracticeOpen,
      spireMaxRuns: args.spireMaxRuns,
      spireHpBase: args.spireHpBase,
      spireHpPerMember: args.spireHpPerMember,
      clatterHpBase: args.clatterHpBase,
      clatterHpPerChallenger: args.clatterHpPerChallenger,
    };
    const problem = bossConfigProblem(cfg);
    if (problem) throw new SenderError(problem);
    const T = currentTick(ctx);
    const old = ctx.db.bossConfig.id.find(BOSS_CONFIG_ID);
    const before = bossConfigOr(old);
    const row = { id: BOSS_CONFIG_ID, ...cfg };
    if (old) ctx.db.bossConfig.id.update(row); else ctx.db.bossConfig.insert(row);
    // Clatterhorn reacts to transitions only: a reopen keeps fightCount, defeats and owed rewards.
    if (before.clatterhornOpen && !cfg.clatterhornOpen) clatterClose(ctx, T);
    else if (!before.clatterhornOpen && cfg.clatterhornOpen) clatterOpen(ctx, T, cfg);
    // A closed Spire is closed again every time (the kill switch): lobbies go, Active runs fail with refunds.
    if (!cfg.spireOpen) spireCloseMode(ctx, T, SpireMode.Normal);
  }
);

/** Ops for live checks (`frontend/scripts/boss-check.mjs`); run ops name an Active run. */
const CLATTER_DEBUG_OPS: readonly string[] = ['clatter_wake', 'clatter_respawn', 'clatter_hp', 'clatter_drum'];
const SPIRE_RUN_DEBUG_OPS: readonly string[] = ['spire_hp', 'spire_phase'];
const SPIRE_WORLD_DEBUG_OPS: readonly string[] = ['spire_fail_all'];

export const bossDebug = spacetimedb.reducer(
  { op: t.string(), runId: t.u64(), value: t.u32() },
  (ctx, { op, runId, value }) => {
    requireOwner(ctx);
    const T = currentTick(ctx);
    if (CLATTER_DEBUG_OPS.includes(op)) {
      clatterDebug(ctx, T, op, value);
      return;
    }
    if (SPIRE_RUN_DEBUG_OPS.includes(op)) {
      if (ctx.db.spireRun.id.find(runId)?.stage !== SpireStage.Active) throw new SenderError('This run is not active');
      spireDebug(ctx, T, op, runId, value);
      return;
    }
    if (SPIRE_WORLD_DEBUG_OPS.includes(op)) {
      spireDebug(ctx, T, op, runId, value);
      return;
    }
    throw new SenderError('This debug action does not exist');
  }
);
