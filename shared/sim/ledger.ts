/**
 * The Island Ledger: three commissions a day per character, handed in at the
 * Sunberry Market clerk or one of the mainland town clerks (LEDGER_CLERKS). Each asks for goods the character can already gather
 * or make at its levels and pays a lump of XP plus a ledger seal; finishing all
 * three adds two more seals. Seals only come from here and are spent on the
 * season's finest keepsakes (nodes.ts SEASON_RECIPES).
 *
 * The draw is a pure function of the identity, the UTC day and the skill
 * levels, so the server, the HUD and the agent API show the same list without
 * storing it. Only the day and which slots are done are stored.
 */
import { LANDMARKS } from './terrain';
import { EXPANSE_LANDMARKS } from './expanse';
import { chebyshev } from './grid';
import type { Tile } from './types';

export const LEDGER_DAY_MS = 86_400_000;
export const LEDGER_SLOTS = 3;
/** Seals per finished commission, and the bonus for finishing all three in a day. */
export const LEDGER_SEALS = 1;
export const LEDGER_FULL_BONUS_SEALS = 2;
export const LEDGER_SEAL_ITEM_ID = 'ledger_seal';
/** Hand-ins happen within this Chebyshev distance of a clerk. */
export const LEDGER_RANGE = 3;
const market = LANDMARKS.find((l) => l.id === 'market')!;
/** The Sunberry Market clerk, the original one (kept for older callers and copy). */
export const LEDGER_CLERK: Tile = { x: market.x, z: market.z };

export interface LedgerClerk extends Tile { id: string; name: string }
const townClerk = (id: 'crossroads' | 'kingsgate' | 'fenhold'): LedgerClerk => {
  const l = EXPANSE_LANDMARKS.find((t) => t.id === id)!;
  return { id, name: `${l.name} clerk`, x: l.x, z: l.z };
};
/**
 * Every ledger clerk: the market first, then the mainland towns. All of them
 * take the same commissions; the daily draw does not depend on where you are.
 */
export const LEDGER_CLERKS: readonly LedgerClerk[] = [
  { id: 'market', name: 'Sunberry Market clerk', ...LEDGER_CLERK },
  townClerk('crossroads'),
  townClerk('kingsgate'),
  townClerk('fenhold'),
];

/** The clerk nearest to `t` (Euclidean; ties go to the earlier clerk in LEDGER_CLERKS). */
export function nearestLedgerClerk(t: Tile): LedgerClerk {
  let best = LEDGER_CLERKS[0], bestD = Infinity;
  for (const c of LEDGER_CLERKS) {
    const d = (c.x - t.x) ** 2 + (c.z - t.z) ** 2;
    if (d < bestD) { best = c; bestD = d; }
  }
  return best;
}

/** Skill ids as in skills.ts (a literal here avoids an import cycle). */
const F = 0, B = 1, C = 2;

export interface LedgerTemplate {
  id: string;
  itemId: string;
  quantity: number;
  /** The skill whose level unlocks this commission, and which the XP goes to. */
  skill: number;
  level: number;
  xp: number;
}

/**
 * About twice the gathering XP the goods are worth (crafted goods count the
 * raw materials inside them), so a day's ledger is a real boost, but only once
 * a day. Quantities are 10-25 minutes of work at the tier.
 */
export const LEDGER_TEMPLATES: readonly LedgerTemplate[] = [
  { id: 'berries', itemId: 'berry_blueberry', quantity: 10, skill: F, level: 1, xp: 160 },
  { id: 'greens', itemId: 'berry_greenberry', quantity: 15, skill: F, level: 1, xp: 240 },
  { id: 'driftwood', itemId: 'driftwood', quantity: 15, skill: B, level: 1, xp: 180 },
  { id: 'flint', itemId: 'flint', quantity: 12, skill: B, level: 1, xp: 240 },
  { id: 'clubs', itemId: 'stone_club', quantity: 2, skill: C, level: 1, xp: 160 },
  { id: 'mash', itemId: 'berry_mash', quantity: 5, skill: C, level: 1, xp: 150 },
  { id: 'honeycomb', itemId: 'honeycomb', quantity: 20, skill: F, level: 15, xp: 560 },
  { id: 'pearls', itemId: 'pearl', quantity: 20, skill: B, level: 15, xp: 560 },
  { id: 'candles', itemId: 'beeswax_candle', quantity: 6, skill: C, level: 12, xp: 400 },
  { id: 'charms', itemId: 'pearl_charm', quantity: 6, skill: C, level: 15, xp: 450 },
  { id: 'glowcaps', itemId: 'glowcap', quantity: 20, skill: F, level: 30, xp: 840 },
  { id: 'coral', itemId: 'coral', quantity: 20, skill: B, level: 30, xp: 840 },
  { id: 'lanterns', itemId: 'glow_lantern', quantity: 4, skill: C, level: 28, xp: 620 },
  { id: 'totems', itemId: 'coral_totem', quantity: 4, skill: C, level: 32, xp: 800 },
  { id: 'sunpeaches', itemId: 'sunpeach', quantity: 20, skill: F, level: 45, xp: 1160 },
  { id: 'amber', itemId: 'amber', quantity: 20, skill: B, level: 45, xp: 1160 },
  { id: 'preserves', itemId: 'sunpeach_preserves', quantity: 4, skill: C, level: 42, xp: 800 },
  { id: 'inlays', itemId: 'amber_inlay', quantity: 3, skill: C, level: 46, xp: 900 },
  { id: 'starpetals', itemId: 'starpetal', quantity: 18, skill: F, level: 60, xp: 1440 },
  { id: 'moonstone', itemId: 'moonstone', quantity: 18, skill: B, level: 60, xp: 1440 },
  { id: 'incense', itemId: 'starpetal_incense', quantity: 3, skill: C, level: 58, xp: 1200 },
  { id: 'lenses', itemId: 'moonstone_lens', quantity: 3, skill: C, level: 62, xp: 1300 },
  { id: 'dreamplums', itemId: 'dreamplum', quantity: 15, skill: F, level: 80, xp: 1620 },
  { id: 'star_iron', itemId: 'star_iron', quantity: 15, skill: B, level: 80, xp: 1620 },
  { id: 'tonics', itemId: 'dream_tonic', quantity: 2, skill: C, level: 78, xp: 1500 },
  { id: 'ingots', itemId: 'star_iron_ingot', quantity: 2, skill: C, level: 82, xp: 1600 },
];

export interface LedgerCommission extends LedgerTemplate { slot: number; done: boolean }

/** The stored part: the UTC day it belongs to and a bit per finished slot. */
export interface LedgerState { day: number; done: number }

export function ledgerDay(nowMs: number): number {
  return Math.floor(nowMs / LEDGER_DAY_MS);
}

/** Milliseconds until the next day's commissions. */
export function ledgerResetInMs(nowMs: number): number {
  return (ledgerDay(nowMs) + 1) * LEDGER_DAY_MS - nowMs;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return (h ^ (h >>> 13)) >>> 0;
}

/** Today's done bits (a stored state from an earlier day counts as nothing done). */
export function ledgerDoneBits(state: LedgerState | undefined, day: number): number {
  return state && state.day === day ? state.done : 0;
}

/**
 * The day's three commissions for `idHex` at levels [foraging, beachcombing,
 * crafting]. Each slot leans to the highest tier unlocked (so a veteran is not
 * asked for berries), drawn from different skills where it can. Stable for the
 * day unless a level crosses an unlock, which only ever offers better work;
 * finished slots never change.
 */
export function ledgerFor(idHex: string, day: number, levels: readonly number[], state?: LedgerState): LedgerCommission[] {
  const done = ledgerDoneBits(state, day);
  const eligible = LEDGER_TEMPLATES.filter((t) => (levels[t.skill] ?? 1) >= t.level);
  const out: LedgerCommission[] = [];
  const used = new Set<string>();
  for (let slot = 0; slot < LEDGER_SLOTS; slot++) {
    const skill = (hash(`${idHex}:${day}:skill`) + slot) % 3;
    const ofSkill = eligible.filter((t) => t.skill === skill && !used.has(t.id));
    const pool = ofSkill.length ? ofSkill : eligible.filter((t) => !used.has(t.id));
    // Prefer the top two unlocked tiers of that skill.
    const top = pool.slice().sort((a, b) => b.level - a.level || a.id.localeCompare(b.id));
    const best = top.filter((t) => t.level >= (top[Math.min(top.length - 1, 3)]?.level ?? 1));
    const pick = best[hash(`${idHex}:${day}:${slot}`) % best.length];
    used.add(pick.id);
    out.push({ ...pick, slot, done: ((done >>> slot) & 1) === 1 });
  }
  return out;
}

export interface LedgerReward { xp: number; skill: number; seals: number; state: LedgerState }

/**
 * Finishing `slot` today: its XP, a seal, and the full-ledger bonus when it is
 * the last of the three. Null if that slot is already done.
 */
export function ledgerComplete(commission: LedgerCommission, state: LedgerState | undefined, day: number): LedgerReward | null {
  const done = ledgerDoneBits(state, day);
  if ((done >>> commission.slot) & 1) return null;
  const next = done | (1 << commission.slot);
  const full = next === (1 << LEDGER_SLOTS) - 1;
  return { xp: commission.xp, skill: commission.skill, seals: LEDGER_SEALS + (full ? LEDGER_FULL_BONUS_SEALS : 0), state: { day, done: next } };
}

export function nearLedgerClerk(t: Tile): boolean {
  return LEDGER_CLERKS.some((c) => chebyshev(t, c) <= LEDGER_RANGE);
}

/** Seals a full month of ledgers pays: enough for both seal keepsakes with a week to spare. */
export const LEDGER_SEALS_PER_DAY = LEDGER_SLOTS * LEDGER_SEALS + LEDGER_FULL_BONUS_SEALS;
