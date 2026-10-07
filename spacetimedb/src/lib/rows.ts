import type { Identity } from 'spacetimedb';
import { BOSS_CONFIG_ID, bossConfigOr, type BossConfigLike } from '../../../shared/sim';
import type { Ctx } from './types';

/**
 * Field-by-field equality of a row and its working copy (identities by
 * value). A copy of the tick's `sameRow`, so boss phases write a row only when
 * it changed.
 */
export function sameRowShallow<T extends object>(a: T | undefined | null, b: T): boolean {
  if (!a) return false;
  for (const key of Object.keys(b) as (keyof T)[]) {
    const x = a[key] as any, y = b[key] as any;
    if (x === y) continue;
    if (x && y && typeof x === 'object' && typeof y === 'object' && '__identity__' in x && '__identity__' in y && x.__identity__ === y.__identity__) continue;
    return false;
  }
  return true;
}

/** The boss switches and knobs: the `boss_config` row, or the defaults (both bosses closed). One PK read. */
export function readBossConfig(ctx: Ctx): BossConfigLike {
  return bossConfigOr(ctx.db.bossConfig?.id.find(BOSS_CONFIG_ID));
}

/** Clamp to a u8 column: the SDK's setUint8 wraps silently. */
export const u8 = (n: number): number => Math.max(0, Math.min(255, Math.floor(n)));
/** Clamp to a u32 column. */
export const u32 = (n: number): number => Math.max(0, Math.min(0xffffffff, Math.floor(n)));

export interface BossNoticeInput {
  tick: number; boss: number; kind: number; player: Identity;
  runId?: bigint; amount?: number; total?: number; hp?: number; half?: number; quantity?: number;
  itemId?: string; x?: number; z?: number;
}

/** One personal `boss_notice` row (RLS: only `player` receives it). u8 fields saturate at 255. */
export function emitBossNotice(ctx: Ctx, n: BossNoticeInput): void {
  ctx.db.bossNotice.insert({
    tick: n.tick, boss: n.boss, kind: n.kind, player: n.player, runId: n.runId ?? 0n,
    amount: u32(n.amount ?? 0), total: u32(n.total ?? 0), hp: u8(n.hp ?? 0), half: u8(n.half ?? 0), quantity: u8(n.quantity ?? 0),
    itemId: n.itemId ?? '', x: n.x ?? 0, z: n.z ?? 0,
  });
}

export interface BossEventInput {
  tick: number; boss: number; kind: number;
  runId?: bigint; player?: Identity; x?: number; z?: number; quantity?: number; value?: number; text?: string;
}

/** One world-visible `boss_event` row; `player` defaults to the module identity. */
export function emitBossEvent(ctx: Ctx, e: BossEventInput): void {
  ctx.db.bossEvent.insert({
    tick: e.tick, boss: e.boss, kind: e.kind, runId: e.runId ?? 0n, player: e.player ?? ctx.identity,
    x: e.x ?? 0, z: e.z ?? 0, quantity: u32(e.quantity ?? 0), value: u32(e.value ?? 0), text: e.text ?? '',
  });
}
