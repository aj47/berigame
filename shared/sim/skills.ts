/**
 * F2 "XP skills": Foraging (berry trees), Beachcombing (Coast nodes) and
 * Crafting (making things). Levels are persistent per identity (F1) and only
 * ever unlock recipes, cosmetics and at most -2 harvest ticks (never below 3).
 * They never touch damage, HP, area access or the gold tree.
 */
import { NodeKind } from './nodes';

export const Skill = { Foraging: 0, Beachcombing: 1, Crafting: 2 } as const;
export type Skill = (typeof Skill)[keyof typeof Skill];

export interface SkillDef { id: Skill; key: 'foraging' | 'beachcombing' | 'crafting'; name: string; verb: string }
export const SKILLS: readonly SkillDef[] = [
  { id: Skill.Foraging, key: 'foraging', name: 'Foraging', verb: 'Pick berries in the Grove' },
  { id: Skill.Beachcombing, key: 'beachcombing', name: 'Beachcombing', verb: 'Gather driftwood and flint on the Coast' },
  { id: Skill.Crafting, key: 'crafting', name: 'Crafting', verb: 'Make things from your bag' },
];

export const SKILL_MAX_LEVEL = 30;

/** Total XP needed to reach level L (1..30): 25·(L−1)². L1 = 0, L2 = 25, L10 = 2025, L30 = 21 025. */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.min(SKILL_MAX_LEVEL, Math.floor(level)));
  return 25 * (l - 1) * (l - 1);
}

/** XP stops counting at the level cap. */
export const SKILL_MAX_XP = xpForLevel(SKILL_MAX_LEVEL);

/** The level `xp` total XP has reached, 1..30. */
export function levelForXp(xp: number): number {
  if (!(xp > 0)) return 1;
  let level = Math.min(SKILL_MAX_LEVEL, Math.floor(Math.sqrt(xp / 25)) + 1);
  // Guard float rounding at exact thresholds.
  while (level < SKILL_MAX_LEVEL && xpForLevel(level + 1) <= xp) level++;
  while (level > 1 && xpForLevel(level) > xp) level--;
  return level;
}

/** Progress through the current level, for the skills panel. */
export function levelProgress(xp: number): { level: number; into: number; span: number; toNext: number; max: boolean } {
  const level = levelForXp(xp);
  if (level >= SKILL_MAX_LEVEL) return { level, into: 0, span: 0, toNext: 0, max: true };
  const base = xpForLevel(level), next = xpForLevel(level + 1);
  return { level, into: xp - base, span: next - base, toNext: next - xp, max: false };
}

/** Adds XP, capped at SKILL_MAX_XP. */
export function addXp(xp: number, amount: number): number {
  return Math.min(SKILL_MAX_XP, Math.max(0, xp) + Math.max(0, Math.floor(amount)));
}

// ---- Harvest XP and speed ----------------------------------------------------

/** The skill a node trains. */
export function skillForNode(kind: number | undefined): Skill {
  return (kind ?? NodeKind.Berry) === NodeKind.Berry ? Skill.Foraging : Skill.Beachcombing;
}

/**
 * XP per finished harvest. Paced so L30 takes about 5 hours of steady play
 * (a berry every ~6.6 s at 8 XP is ~1.2 XP/s; 21 025 XP / 1.2 ≈ 4.9 h).
 */
export const HARVEST_XP: Record<number, number> = {
  [NodeKind.Berry]: 8,
  [NodeKind.Driftwood]: 6,
  [NodeKind.TideRock]: 10,
  /** M3 obsidian outcrops (Beachcombing: shoreline stone). Scarce (2 nodes, 150-tick regrow), so worth more. */
  [NodeKind.Obsidian]: 14,
};
export function harvestXp(kind: number | undefined): number {
  return HARVEST_XP[kind ?? NodeKind.Berry] ?? 0;
}

/** Levels that shave one harvest tick each: -1 at L10, -2 at L20 (the maximum). */
export const HARVEST_SPEED_LEVELS = [10, 20] as const;
export const MIN_HARVEST_TICKS = 3;
/** The one node skills never speed up: the goldberry tree stays the hill to hold. */
export const UNHASTENED_ITEM = 'berry_goldberry';

export function harvestTickBonus(level: number): number {
  let bonus = 0;
  for (const l of HARVEST_SPEED_LEVELS) if (level >= l) bonus++;
  return bonus;
}

/**
 * Harvest length for a node given the harvester's level in its skill. Never
 * below 3 ticks (a base already at or under 3 stays as it is), and the gold
 * tree is never faster.
 */
export function harvestTicksAtLevel(baseTicks: number, level: number, itemId = ''): number {
  if (itemId === UNHASTENED_ITEM) return baseTicks;
  return Math.max(Math.min(baseTicks, MIN_HARVEST_TICKS), baseTicks - harvestTickBonus(level));
}

// ---- Cosmetics -----------------------------------------------------------------

export const CosmeticSlot = { Head: 0, Neck: 1 } as const;
export type CosmeticSlot = (typeof CosmeticSlot)[keyof typeof CosmeticSlot];

export interface CosmeticDef {
  /** Bit index in player_cosmetic.unlocked; permanent, never reused. */
  id: number;
  key: string;
  name: string;
  slot: CosmeticSlot;
  /** How it is earned, shown on locked entries. */
  how: string;
  /** Unlocked on reaching this level in this skill. */
  skill?: { skill: Skill; level: number };
}

export const Cosmetic = {
  StrawHat: 0, CoastScarf: 1, FlowerCrown: 2, ShellNecklace: 3, DriftwoodCrown: 4, WovenSash: 5,
} as const;

export const COSMETICS: readonly CosmeticDef[] = [
  { id: Cosmetic.StrawHat, key: 'straw_hat', name: 'Straw Hat', slot: CosmeticSlot.Head, how: 'Find your first sturdy stick' },
  { id: Cosmetic.CoastScarf, key: 'coast_scarf', name: 'Coast Scarf', slot: CosmeticSlot.Neck, how: 'Reach the Coast' },
  { id: Cosmetic.FlowerCrown, key: 'flower_crown', name: 'Flower Crown', slot: CosmeticSlot.Head, how: 'Foraging level 10', skill: { skill: Skill.Foraging, level: 10 } },
  { id: Cosmetic.ShellNecklace, key: 'shell_necklace', name: 'Shell Necklace', slot: CosmeticSlot.Neck, how: 'Beachcombing level 10', skill: { skill: Skill.Beachcombing, level: 10 } },
  { id: Cosmetic.DriftwoodCrown, key: 'driftwood_crown', name: 'Driftwood Crown', slot: CosmeticSlot.Head, how: 'Make it (Crafting level 5)' },
  { id: Cosmetic.WovenSash, key: 'woven_sash', name: 'Woven Sash', slot: CosmeticSlot.Neck, how: 'Crafting level 10', skill: { skill: Skill.Crafting, level: 10 } },
];

export function getCosmetic(id: number): CosmeticDef | undefined {
  return COSMETICS[id]?.id === id ? COSMETICS[id] : COSMETICS.find((c) => c.id === id);
}

export function hasCosmetic(mask: number, id: number): boolean {
  return id >= 0 && id < 32 && ((mask >>> id) & 1) === 1;
}

export function withCosmetic(mask: number, id: number): number {
  return (mask | (1 << id)) >>> 0;
}

/** Skill-level cosmetics earned by going from `fromLevel` to `toLevel` in `skill`. */
export function cosmeticsForLevelUp(skill: Skill, fromLevel: number, toLevel: number): number[] {
  return COSMETICS.filter((c) => c.skill && c.skill.skill === skill && fromLevel < c.skill.level && toLevel >= c.skill.level).map((c) => c.id);
}

/**
 * Equipped cosmetics travel as `cosmetic id + 1` (0 = nothing worn).
 * Valid when nothing is worn, or the cosmetic exists, is unlocked and fits `slot`.
 */
export function canWear(mask: number, slot: number, worn: number): boolean {
  if (worn === 0) return slot === CosmeticSlot.Head || slot === CosmeticSlot.Neck;
  const def = getCosmetic(worn - 1);
  return !!def && def.slot === slot && hasCosmetic(mask, def.id);
}
