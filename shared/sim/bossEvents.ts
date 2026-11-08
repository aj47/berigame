/**
 * Wire codes of the two boss event tables (all u8, append-only).
 * `boss_event` is world-visible; `boss_notice` reaches only its `player` (RLS).
 */

export const BossId = { Clatterhorn: 1, Spire: 2, Lanternmaw: 3 } as const;
export type BossId = (typeof BossId)[keyof typeof BossId];

/** `boss_event.kind`. */
export const BossEventKind = {
  ClatterWake: 0,
  /** quantity = rewardees */
  ClatterDefeat: 1,
  ClatterRespawn: 2,
  ClatterReset: 3,
  /** runId, quantity = party size */
  SpireRunStart: 4,
  /** runId, quantity = party size, value = clear ticks, text = member names joined by ", " */
  SpireClear: 5,
  /** Lanternmaw: runId, quantity = party size */
  LanternRunStart: 6,
  /** Lanternmaw: runId, quantity = party size, value = clear ticks, text = member names joined by ", " */
  LanternClear: 7,
  /** Lanternmaw opened by the owner (the launch moment); x, z = the Fen Gate */
  LanternOpened: 8,
  /** Owner announcement before opening: value = minutes until it opens; x, z = the Fen Gate */
  LanternSoon: 9,
} as const;
export type BossEventKind = (typeof BossEventKind)[keyof typeof BossEventKind];

/** `boss_notice.kind`: personal feedback, one row per recipient. */
export const BossNoticeKind = {
  /** amount = damage, total = your contribution this fight */
  YouHit: 0,
  /** amount, hp, half, quantity = HurtSource */
  Hurt: 1,
  /** amount 15, total = your stars */
  Star: 2,
  /** Reserved (downed and revive are not in this release). */
  Downed: 3,
  /** Reserved (downed and revive are not in this release). */
  Revived: 4,
  KnockedOut: 5,
  /** itemId, quantity */
  Reward: 6,
  /** quantity = cosmetic id */
  Keepsake: 7,
  /** quantity = SpireOutcome, total = clear ticks, amount = your stars (Spire) or damage dealt (Lanternmaw) */
  RunResult: 8,
} as const;
export type BossNoticeKind = (typeof BossNoticeKind)[keyof typeof BossNoticeKind];

/** `boss_notice.quantity` of a Hurt notice. */
export const HurtSource = { Charge: 1, Spin: 2, Runner: 3, Bullet: 4, Blow: 5, Pulse: 6, Drown: 7, Bite: 8 } as const;
export type HurtSource = (typeof HurtSource)[keyof typeof HurtSource];
