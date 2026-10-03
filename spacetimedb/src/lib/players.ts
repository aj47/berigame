import { SenderError } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';
import { MAX_INPUTS_PER_TICK, Pending, PlayerState } from '../../../shared/sim';
import type { Ctx, PlayerRow } from './types';
import { requireAdmission } from './access';
import { maxHealth } from '../../../shared/sim/frontier/engine';

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
  requireAdmission(ctx);
  const p = findPlayer(ctx, ctx.sender);
  if (!p) throw new SenderError('no player for this identity; connect first');
  if (!p.online) throw new SenderError('player is offline');
  return { ...p };
}

export function requireAlivePlayer(ctx: Ctx, allowFrontier = false): PlayerRow {
  const p = requirePlayer(ctx);
  if (p.state !== PlayerState.Alive) throw new SenderError('you are dead');
  if (!allowFrontier && p.region && p.region !== 'bramblewild') throw new SenderError('Use the region actions here; this action belongs to Bramblewild');
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
  const profile = ctx.db.frontierPrivate?.key.find(`profile:${hex(p.identity)}`);
  if (profile) {
    const bag = Array.from(ctx.db.inventorySlot.owner.filter(p.identity));
    p.maxHp = maxHealth(JSON.parse(profile.data), { bag });
    p.hp = Math.min(p.hp, p.maxHp);
  }
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
export function clearInteractions(ctx: Ctx, p: PlayerRow, preserveFrontierGather = false): void {
  p.targetX = undefined;
  p.targetZ = undefined;
  p.combatTarget = undefined;
  p.hostile = false;
  p.pending = Pending.None;
  p.pendingId = 0n;
  releaseTree(ctx, p);
  // Frontier resource reservations live in generic public rows, with no player schema change.
  // Keep this alongside the original tree release so movement, death and disconnect cancel both.
  if (!preserveFrontierGather && ctx.db.frontierObject) {
    for (const row of ctx.db.frontierObject.kind.filter('resource')) {
      const resource = JSON.parse(row.data);
      if (resource.harvest?.by !== hex(p.identity)) continue;
      delete resource.harvest;
      ctx.db.frontierObject.key.update({ ...row, data: JSON.stringify(resource) });
    }
  }
}

export function clearMovement(p: PlayerRow): void {
  p.targetX = undefined;
  p.targetZ = undefined;
}
