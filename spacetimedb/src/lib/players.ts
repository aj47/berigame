import { SenderError } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';
import { MAX_INPUTS_PER_TICK, Pending, PlayerState } from '../../../shared/sim';
import type { Ctx, PlayerRow } from './types';

export function hex(id: Identity): string {
  return id.toHexString();
}

export function sameId(a: Identity | undefined, b: Identity | undefined): boolean {
  if (!a || !b) return false;
  return a.toHexString() === b.toHexString();
}

export function currentTick(ctx: Ctx): number {
  return ctx.db.world.id.find(0)?.tick ?? 0;
}

export function findPlayer(ctx: Ctx, id: Identity): PlayerRow | undefined {
  return ctx.db.player.identity.find(id) ?? undefined;
}

export function requirePlayer(ctx: Ctx): PlayerRow {
  const p = findPlayer(ctx, ctx.sender);
  if (!p) throw new SenderError('no player for this identity; connect first');
  return { ...p };
}

export function requireAlivePlayer(ctx: Ctx): PlayerRow {
  const p = requirePlayer(ctx);
  if (p.state !== PlayerState.Alive) throw new SenderError('you are dead');
  return p;
}

/** Per-tick input rate limit. Mutates `p`; caller saves it. */
export function touchInput(p: PlayerRow, tick: number): void {
  if (p.lastInputTick === tick) {
    if (p.inputsThisTick >= MAX_INPUTS_PER_TICK) throw new SenderError('slow down');
    p.inputsThisTick += 1;
  } else {
    p.lastInputTick = tick;
    p.inputsThisTick = 1;
  }
}

export function savePlayer(ctx: Ctx, p: PlayerRow): void {
  ctx.db.player.identity.update(p);
}

/** Give a claimed tree back if `p` is harvesting it. Mutates `p`. */
export function releaseTree(ctx: Ctx, p: PlayerRow): void {
  if (p.harvestTreeId !== 0) {
    const tree = ctx.db.tree.id.find(p.harvestTreeId);
    if (tree && sameId(tree.harvester, p.identity)) {
      ctx.db.tree.id.update({ ...tree, harvester: undefined });
    }
  }
  p.harvestTreeId = 0;
  p.harvestEndTick = 0;
}

/** Stop walking, fighting, following, harvesting and any queued interaction. Mutates `p`. */
export function clearInteractions(ctx: Ctx, p: PlayerRow): void {
  p.targetX = undefined;
  p.targetZ = undefined;
  p.combatTarget = undefined;
  p.hostile = false;
  p.pending = Pending.None;
  p.pendingId = 0n;
  releaseTree(ctx, p);
}

export function clearMovement(p: PlayerRow): void {
  p.targetX = undefined;
  p.targetZ = undefined;
}
