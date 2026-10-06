/**
 * Owner switches and live HP knobs for both bosses (the `boss_config` row,
 * id 0). An absent row means the defaults: both bosses closed.
 */
export interface BossConfigLike {
  clatterhornOpen: boolean;
  spireOpen: boolean;
  /** Reserved: practice runs are not in this release (the column stays for a later one). */
  spirePracticeOpen: boolean;
  /** Concurrent Active Spire runs, 1..32. */
  spireMaxRuns: number;
  spireHpBase: number;
  spireHpPerMember: number;
  clatterHpBase: number;
  clatterHpPerChallenger: number;
}

export const BOSS_CONFIG_ID = 0;

export const BOSS_CONFIG_DEFAULTS: BossConfigLike = Object.freeze({
  clatterhornOpen: false,
  spireOpen: false,
  spirePracticeOpen: false,
  spireMaxRuns: 12,
  spireHpBase: 1000,
  spireHpPerMember: 700,
  clatterHpBase: 200,
  clatterHpPerChallenger: 150,
});

/** Inclusive ranges accepted by `configure_bosses`. */
export const BOSS_MAX_RUNS_RANGE = [1, 32] as const;
export const BOSS_HP_RANGE = [50, 20000] as const;
export const BOSS_CONFIG_RANGE_MESSAGE = 'This value is out of range';

/** The config row's values, or the defaults when there is no row. */
export function bossConfigOr(row?: BossConfigLike | null): BossConfigLike {
  if (!row) return { ...BOSS_CONFIG_DEFAULTS };
  return {
    clatterhornOpen: row.clatterhornOpen,
    spireOpen: row.spireOpen,
    spirePracticeOpen: row.spirePracticeOpen,
    spireMaxRuns: row.spireMaxRuns,
    spireHpBase: row.spireHpBase,
    spireHpPerMember: row.spireHpPerMember,
    clatterHpBase: row.clatterHpBase,
    clatterHpPerChallenger: row.clatterHpPerChallenger,
  };
}

const within = (n: number, [lo, hi]: readonly [number, number]) => Number.isInteger(n) && n >= lo && n <= hi;

/** "This value is out of range" or null. */
export function bossConfigProblem(cfg: BossConfigLike): string | null {
  if (!within(cfg.spireMaxRuns, BOSS_MAX_RUNS_RANGE)) return BOSS_CONFIG_RANGE_MESSAGE;
  for (const hp of [cfg.spireHpBase, cfg.spireHpPerMember, cfg.clatterHpBase, cfg.clatterHpPerChallenger]) {
    if (!within(hp, BOSS_HP_RANGE)) return BOSS_CONFIG_RANGE_MESSAGE;
  }
  return null;
}
