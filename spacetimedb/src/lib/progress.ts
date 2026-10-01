import { progress } from './adventure';
import { Feat } from '../../../shared/sim';
import type { Identity } from 'spacetimedb';
import {
  CosmeticSlot, Skill, addXp, getCosmetic, cosmeticsForLevelUp, harvestTicksAtLevel, harvestTicksFor, hasCosmetic, levelForXp, skillForNode, withCosmetic,
} from '../../../shared/sim';
import type { Ctx, PlayerCosmeticRow, PlayerSkillRow } from './types';

/**
 * F2 skills and milestone cosmetics. Rows are created lazily on the first XP
 * or unlock and written only when something is earned, never per tick.
 */

const XP_FIELD = ['foragingXp', 'beachcombingXp', 'craftingXp'] as const;

export function skillRow(ctx: Ctx, id: Identity): PlayerSkillRow {
  return ctx.db.playerSkill.identity.find(id) ?? { identity: id, foragingXp: 0, beachcombingXp: 0, craftingXp: 0 };
}

export function skillLevel(ctx: Ctx, id: Identity, skill: Skill): number {
  const row = ctx.db.playerSkill.identity.find(id);
  return row ? levelForXp(row[XP_FIELD[skill]]) : 1;
}

/** Harvest length for this player at this node: -1 tick at L10, -2 at L20, never below 3, never the gold tree. */
export function harvestTicksForPlayer(ctx: Ctx, id: Identity, node: { kind: number; itemId: string }): number {
  return harvestTicksAtLevel(harvestTicksFor(node.kind), skillLevel(ctx, id, skillForNode(node.kind)), node.itemId);
}

/** Grants XP (capped at L30) and any skill-level cosmetics it earns. Returns the new level. */
export function grantXp(ctx: Ctx, id: Identity, skill: Skill, amount: number): number {
  progress(ctx, id, skill === Skill.Crafting ? 1 : skill === Skill.Beachcombing ? 2 : 0, amount, skill === Skill.Crafting ? Feat.Build : skill === Skill.Beachcombing ? Feat.Explore : Feat.Grow);
  const existing = ctx.db.playerSkill.identity.find(id);
  const row = existing ?? { identity: id, foragingXp: 0, beachcombingXp: 0, craftingXp: 0 };
  const field = XP_FIELD[skill];
  const before = row[field];
  const after = addXp(before, amount);
  const from = levelForXp(before), to = levelForXp(after);
  if (after !== before) {
    const next = { ...row, [field]: after };
    if (existing) ctx.db.playerSkill.identity.update(next);
    else ctx.db.playerSkill.insert(next);
  }
  for (const cosmetic of cosmeticsForLevelUp(skill, from, to)) unlockCosmetic(ctx, id, cosmetic);
  return to;
}

export function cosmeticRow(ctx: Ctx, id: Identity): PlayerCosmeticRow {
  return ctx.db.playerCosmetic.identity.find(id) ?? { identity: id, unlocked: 0, head: 0, neck: 0 };
}

/** Records a cosmetic as earned (idempotent). A new unlock is worn right away if that slot is empty. */
export function unlockCosmetic(ctx: Ctx, id: Identity, cosmetic: number): boolean {
  const def = getCosmetic(cosmetic);
  if (!def) return false;
  const existing = ctx.db.playerCosmetic.identity.find(id);
  const row = existing ?? { identity: id, unlocked: 0, head: 0, neck: 0 };
  if (hasCosmetic(row.unlocked, cosmetic)) return false;
  const next = { ...row, unlocked: withCosmetic(row.unlocked, cosmetic) };
  if (def.slot === CosmeticSlot.Head && next.head === 0) next.head = cosmetic + 1;
  if (def.slot === CosmeticSlot.Neck && next.neck === 0) next.neck = cosmetic + 1;
  if (existing) ctx.db.playerCosmetic.identity.update(next);
  else ctx.db.playerCosmetic.insert(next);
  return true;
}
