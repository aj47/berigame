/**
 * F2 "XP skills": Foraging (berry trees), Beachcombing (Coast nodes) and
 * Crafting (making things). Levels are persistent per identity (F1) and only
 * ever unlock recipes, cosmetics and at most -2 harvest ticks (never below 3).
 * They never touch damage, HP, area access or the gold tree.
 */
import { NodeKind } from './nodes';
import { TIER_NODES, tierNode } from './season';

export const Skill = { Foraging: 0, Beachcombing: 1, Crafting: 2 } as const;
export type Skill = (typeof Skill)[keyof typeof Skill];

export interface SkillDef { id: Skill; key: 'foraging' | 'beachcombing' | 'crafting'; name: string; verb: string }
export const SKILLS: readonly SkillDef[] = [
  { id: Skill.Foraging, key: 'foraging', name: 'Foraging', verb: 'Pick berries in the Grove' },
  { id: Skill.Beachcombing, key: 'beachcombing', name: 'Beachcombing', verb: 'Gather driftwood and flint on the Coast' },
  { id: Skill.Crafting, key: 'crafting', name: 'Crafting', verb: 'Make things from your bag' },
];

/** The Long Season raised the cap from 30 to 99; the curve to 30 is unchanged. */
export const SKILL_MAX_LEVEL = 99;
/** Below this level the original curve 25·(L−1)² applies. */
export const SKILL_CURVE_KNEE = 30;
/** Total XP at the cap: 3M, about 45 full 8-hour days at the fastest uncontended pace. */
export const SKILL_CAP_XP = 3_000_000;
/** Past the knee every level costs at least this much more than the last full-curve level (1425). */
const KNEE_STEP = 1450;
/** The tail's exponent: late levels cost more without any single level taking days. */
const TAIL_POWER = 2.5;

/**
 * Total XP to reach each level, index = level. Integers, so the server and
 * every client agree. L10 = 2025 and L30 = 21 025 as before; past 30,
 * xp(L) = 21 025 + 1450·(L−30) + A·(L−30)^2.5 with A set so L99 = 3M.
 * L60 ≈ 423k, L80 ≈ 1.38M, L90 ≈ 2.14M. A full day of play still levels every day.
 */
const XP_TABLE: readonly number[] = (() => {
  const t = [0, 0];
  for (let l = 2; l <= SKILL_CURVE_KNEE; l++) t[l] = 25 * (l - 1) * (l - 1);
  const span = SKILL_MAX_LEVEL - SKILL_CURVE_KNEE;
  const a = (SKILL_CAP_XP - t[SKILL_CURVE_KNEE] - KNEE_STEP * span) / span ** TAIL_POWER;
  for (let l = SKILL_CURVE_KNEE + 1; l <= SKILL_MAX_LEVEL; l++) {
    const n = l - SKILL_CURVE_KNEE;
    t[l] = t[SKILL_CURVE_KNEE] + KNEE_STEP * n + Math.round(a * n ** TAIL_POWER);
  }
  return t;
})();

/** Total XP needed to reach level L (1..99). L1 = 0, L2 = 25, L10 = 2025, L30 = 21 025. */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.min(SKILL_MAX_LEVEL, Math.floor(level)));
  return XP_TABLE[l];
}

/** XP stops counting at the level cap. */
export const SKILL_MAX_XP = xpForLevel(SKILL_MAX_LEVEL);

/** The level `xp` total XP has reached, 1..99. */
export function levelForXp(xp: number): number {
  if (!(xp > 0)) return 1;
  let lo = 1, hi = SKILL_MAX_LEVEL;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (XP_TABLE[mid] <= xp) lo = mid; else hi = mid - 1;
  }
  return lo;
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
  const tier = tierNode(kind);
  if (tier) return tier.skill as Skill;
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
  // The Long Season's tiers: 4 to 9 XP per second of harvest (season.ts).
  ...Object.fromEntries(TIER_NODES.map((d) => [d.kind, d.xp])),
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
  /** Unlocked on reaching this level in every skill. */
  allSkills?: number;
}

export const Cosmetic = {
  StrawHat: 0, CoastScarf: 1, FlowerCrown: 2, ShellNecklace: 3, DriftwoodCrown: 4, WovenSash: 5,
  WelcomedRibbon: 6, MentorPin: 7, MentorPinSilver: 8, MentorPinGold: 9, GiantsTooth: 10, BerryHeart: 11,
  ClatterhornHorn: 12, PrismCrown: 13, ShardPendant: 14, ShardCirclet: 15,
  // The Long Season. Bits 30 and 31 stay free.
  GlowcapCap: 16, CoralCirclet: 17, ArtisansKerchief: 18, StarpetalGarland: 19, MoonstoneTorc: 20, ArtisansGoggles: 21,
  DreamvineCrown: 22, StarfallDiadem: 23, MastersLaurel: 24, PearlStrand: 25, AmberAmulet: 26, StarIronHelm: 27,
  TidewrightsMedallion: 28, ParagonSash: 29,
} as const;

export const COSMETICS: readonly CosmeticDef[] = [
  { id: Cosmetic.StrawHat, key: 'straw_hat', name: 'Straw Hat', slot: CosmeticSlot.Head, how: 'Find your first sturdy stick' },
  { id: Cosmetic.CoastScarf, key: 'coast_scarf', name: 'Coast Scarf', slot: CosmeticSlot.Neck, how: 'Reach the Coast' },
  { id: Cosmetic.FlowerCrown, key: 'flower_crown', name: 'Flower Crown', slot: CosmeticSlot.Head, how: 'Foraging level 10', skill: { skill: Skill.Foraging, level: 10 } },
  { id: Cosmetic.ShellNecklace, key: 'shell_necklace', name: 'Shell Necklace', slot: CosmeticSlot.Neck, how: 'Beachcombing level 10', skill: { skill: Skill.Beachcombing, level: 10 } },
  { id: Cosmetic.DriftwoodCrown, key: 'driftwood_crown', name: 'Driftwood Crown', slot: CosmeticSlot.Head, how: 'Make it (Crafting level 5)' },
  { id: Cosmetic.WovenSash, key: 'woven_sash', name: 'Woven Sash', slot: CosmeticSlot.Neck, how: 'Crafting level 10', skill: { skill: Skill.Crafting, level: 10 } },
  { id: Cosmetic.WelcomedRibbon, key: 'welcomed_ribbon', name: 'Welcomed Ribbon', slot: CosmeticSlot.Head, how: 'Reach the Coast or make a club with a mentor' },
  { id: Cosmetic.MentorPin, key: 'mentor_pin', name: "Mentor's Pin", slot: CosmeticSlot.Neck, how: 'Help a newer player reach the Coast or make a club' },
  { id: Cosmetic.MentorPinSilver, key: 'mentor_pin_silver', name: "Mentor's Pin (Silver)", slot: CosmeticSlot.Neck, how: 'Mentor 3 newer players' },
  { id: Cosmetic.MentorPinGold, key: 'mentor_pin_gold', name: "Mentor's Pin (Gold)", slot: CosmeticSlot.Neck, how: 'Mentor 10 newer players' },
  { id: Cosmetic.GiantsTooth, key: 'giants_tooth', name: "Giant's Tooth", slot: CosmeticSlot.Neck, how: 'Help defeat the Giant in a raid' },
  { id: Cosmetic.BerryHeart, key: 'berry_heart', name: 'Berry Heart', slot: CosmeticSlot.Neck, how: 'Share your first feast with the Berry Giant' },
  { id: Cosmetic.ClatterhornHorn, key: 'clatterhorn_horn', name: 'Clatterhorn Horn', slot: CosmeticSlot.Head, how: 'Help defeat Clatterhorn' },
  { id: Cosmetic.PrismCrown, key: 'prism_crown', name: 'Prism Crown', slot: CosmeticSlot.Head, how: 'Clear the Sunken Spire' },
  { id: Cosmetic.ShardPendant, key: 'shard_pendant', name: 'Shard Pendant', slot: CosmeticSlot.Neck, how: 'Clear the Sunken Spire without being hit' },
  { id: Cosmetic.ShardCirclet, key: 'shard_circlet', name: 'Shard Circlet', slot: CosmeticSlot.Head, how: 'Make it (Crafting level 10)' },
  { id: Cosmetic.GlowcapCap, key: 'glowcap_cap', name: 'Glowcap Cap', slot: CosmeticSlot.Head, how: 'Foraging level 30', skill: { skill: Skill.Foraging, level: 30 } },
  { id: Cosmetic.CoralCirclet, key: 'coral_circlet', name: 'Coral Circlet', slot: CosmeticSlot.Head, how: 'Beachcombing level 30', skill: { skill: Skill.Beachcombing, level: 30 } },
  { id: Cosmetic.ArtisansKerchief, key: 'artisans_kerchief', name: "Artisan's Kerchief", slot: CosmeticSlot.Neck, how: 'Crafting level 30', skill: { skill: Skill.Crafting, level: 30 } },
  { id: Cosmetic.StarpetalGarland, key: 'starpetal_garland', name: 'Starpetal Garland', slot: CosmeticSlot.Neck, how: 'Foraging level 60', skill: { skill: Skill.Foraging, level: 60 } },
  { id: Cosmetic.MoonstoneTorc, key: 'moonstone_torc', name: 'Moonstone Torc', slot: CosmeticSlot.Neck, how: 'Beachcombing level 60', skill: { skill: Skill.Beachcombing, level: 60 } },
  { id: Cosmetic.ArtisansGoggles, key: 'artisans_goggles', name: "Artisan's Goggles", slot: CosmeticSlot.Head, how: 'Crafting level 60', skill: { skill: Skill.Crafting, level: 60 } },
  { id: Cosmetic.DreamvineCrown, key: 'dreamvine_crown', name: 'Dreamvine Crown', slot: CosmeticSlot.Head, how: 'Foraging level 99', skill: { skill: Skill.Foraging, level: 99 } },
  { id: Cosmetic.StarfallDiadem, key: 'starfall_diadem', name: 'Starfall Diadem', slot: CosmeticSlot.Head, how: 'Beachcombing level 99', skill: { skill: Skill.Beachcombing, level: 99 } },
  { id: Cosmetic.MastersLaurel, key: 'masters_laurel', name: "Master's Laurel", slot: CosmeticSlot.Head, how: 'Crafting level 99', skill: { skill: Skill.Crafting, level: 99 } },
  { id: Cosmetic.PearlStrand, key: 'pearl_strand', name: 'Pearl Strand', slot: CosmeticSlot.Neck, how: 'Make it (Crafting level 20)' },
  { id: Cosmetic.AmberAmulet, key: 'amber_amulet', name: 'Amber Amulet', slot: CosmeticSlot.Neck, how: 'Make it (Crafting level 50)' },
  { id: Cosmetic.StarIronHelm, key: 'star_iron_helm', name: 'Star Iron Helm', slot: CosmeticSlot.Head, how: 'Make it with ledger seals (Crafting level 85)' },
  { id: Cosmetic.TidewrightsMedallion, key: 'tidewrights_medallion', name: "Tidewright's Medallion", slot: CosmeticSlot.Neck, how: 'Make it with ledger seals (Crafting level 95)' },
  { id: Cosmetic.ParagonSash, key: 'paragon_sash', name: 'Paragon Sash', slot: CosmeticSlot.Neck, how: 'Level 99 in every skill', allSkills: 99 },
];

/** Mentor's Pin variants by tier (shared/sim/mentor.ts MENTOR_PIN_TIERS). */
export const MENTOR_PIN_COSMETICS = [Cosmetic.MentorPin, Cosmetic.MentorPinSilver, Cosmetic.MentorPinGold] as const;

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

/** All-skill cosmetics earned when the lowest skill level goes from `fromMin` to `toMin`. */
export function cosmeticsForAllSkills(fromMin: number, toMin: number): number[] {
  return COSMETICS.filter((c) => c.allSkills !== undefined && fromMin < c.allSkills && toMin >= c.allSkills).map((c) => c.id);
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
