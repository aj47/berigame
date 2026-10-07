/**
 * Energy: one meter per character that sets how much gathering pays. It
 * applies to every character the same way, so it needs no bot detection.
 *
 * - The meter is measured in seconds of gathering. A finished harvest or
 *   gather spends its own length (a 3 s berry harvest spends 3 points).
 * - Points come back with real time, one every ENERGY_REGEN_MS. While you are
 *   online they refill only up to the rested line; while you are logged out
 *   they refill up to the top. So the rested band (above the line, where an
 *   event pays double) is earned only by time away, the classic rested bonus:
 *   a character that never logs off never gets it.
 * - Every meter starts at the rested line, paying normally.
 * - Tired (fewer points left than the action costs): only every fourth event pays.
 *
 * A seasoned meter holds two hours of nonstop gathering, and a person who also
 * walks, fights, crafts and chats gathers about half the time, so a normal
 * session ends long before the tired band. A new character starts with a
 * smaller meter that grows to full over its first three days.
 *
 * Times are Unix milliseconds. The state is plain data so the SpacetimeDB
 * module, the frontier engine, the client HUD and the agent API agree.
 */

/** Seconds of gathering a seasoned meter holds (2 hours). */
export const ENERGY_MAX = 7200;
/** The meter of a brand-new character (90 minutes). */
export const ENERGY_START_MAX = 5400;
/** Character age at which the meter reaches ENERGY_MAX. */
export const ENERGY_SEASON_MS = 3 * 24 * 60 * 60 * 1000;
/** One point (one second of gathering) back every 6 s: an empty seasoned meter refills to the top in 12 hours away. */
export const ENERGY_REGEN_MS = 6000;
/** Above this fraction of the meter, events pay double. Every meter starts exactly here. */
export const ENERGY_RESTED_FRACTION = 2 / 3;
/** While tired, one event in this many pays (25%). */
export const ENERGY_TIRED_EVERY = 4;

export type EnergyBand = 'rested' | 'normal' | 'tired';

export interface EnergyState {
  /** Owner identity (hex). */
  id: string;
  points: number;
  /** Refill accounting time: the next point arrives at `at + ENERGY_REGEN_MS`. */
  at: number;
  /** When the character first played, for the meter size. */
  born: number;
  /** Tired events since the last tired payout, 0..ENERGY_TIRED_EVERY-1. */
  tired: number;
}

/** The meter size for a character born at `born`, at time `now`. */
export function energyMax(born: number, now: number): number {
  const age = Math.max(0, now - born);
  if (age >= ENERGY_SEASON_MS) return ENERGY_MAX;
  return ENERGY_START_MAX + Math.floor(((ENERGY_MAX - ENERGY_START_MAX) * age) / ENERGY_SEASON_MS);
}

/** Points at and below which events pay normally. */
export function energyRestedLine(max: number): number {
  return Math.floor(max * ENERGY_RESTED_FRACTION);
}

/** A new meter, at the rested line, for a character first seen at `born`. */
export function newEnergy(id: string, now: number, born = now): EnergyState {
  const first = Math.min(born, now);
  return { id, points: energyRestedLine(energyMax(first, now)), at: now, born: first, tired: 0 };
}

/**
 * The state at `now` after refilling since `s.at`. `online` (the default: a
 * character spending or looking at its meter is online) refills only to the
 * rested line; pass false to settle a logged-out stretch, which refills to the
 * top. Points already above the ceiling stay. Never mutates `s`.
 */
export function energyAt(s: EnergyState, now: number, online = true): EnergyState {
  const max = energyMax(s.born, now);
  const ceiling = online ? energyRestedLine(max) : max;
  if (s.points >= ceiling) return { ...s, at: Math.max(s.at, now) };
  const elapsed = Math.max(0, now - s.at);
  const gained = Math.floor(elapsed / ENERGY_REGEN_MS);
  const points = Math.min(ceiling, s.points + gained);
  // A meter that reaches its ceiling restarts the refill clock; otherwise keep the partial point.
  const at = points >= ceiling ? now : s.at + gained * ENERGY_REGEN_MS;
  return { ...s, points, at };
}

/**
 * Close the stretch since `s.at`: `wasOnline` true at a disconnect (refilled
 * to the line), false at a reconnect (the time away refills to the top).
 */
export function settleEnergy(s: EnergyState, now: number, wasOnline: boolean): EnergyState {
  return energyAt(s, now, wasOnline);
}

export function energyBand(points: number, max: number): EnergyBand {
  if (points <= 0) return 'tired';
  return points > energyRestedLine(max) ? 'rested' : 'normal';
}

export interface EnergySpend {
  state: EnergyState;
  /** The band the event was paid in. */
  band: EnergyBand;
  /** 2 = double, 1 = normal, 0 = nothing this time. */
  payout: 0 | 1 | 2;
}

/** Seconds of gathering an action of `ms` spends (at least 1). */
export function energyCost(ms: number): number {
  return Math.max(1, Math.round(ms / 1000));
}

/** One finished gathering action of `cost` points at `now`. */
export function spendEnergy(s: EnergyState, now: number, cost = 1): EnergySpend {
  const cur = energyAt(s, now);
  const need = Math.max(1, cost);
  // An action costing more than what is left is paid as tired, so trickling points never buy full actions.
  const band = cur.points < need ? 'tired' : energyBand(cur.points, energyMax(cur.born, now));
  if (band === 'tired') {
    const tired = (cur.tired + 1) % ENERGY_TIRED_EVERY;
    return { state: { ...cur, tired }, band, payout: tired === 0 ? 1 : 0 };
  }
  return { state: { ...cur, points: cur.points - need, tired: 0 }, band, payout: band === 'rested' ? 2 : 1 };
}

/** Scale an item quantity or an XP amount by a payout. */
export function energyScaled(amount: number, payout: 0 | 1 | 2): number {
  return amount * payout;
}

export interface EnergyView {
  points: number;
  max: number;
  /** Points at and below which events pay normally. */
  restedLine: number;
  band: EnergyBand;
  /** Points left before the band drops (rested: to normal; normal: to tired; tired: 0). */
  untilNextBand: number;
  /** Milliseconds until the next point, or 0 at or above the rested line (online refills stop there). */
  nextPointInMs: number;
  /** Milliseconds of online time until the meter is back at the rested line. */
  refillInMs: number;
}

/** What the HUD and the agent API show. */
export function energyView(s: EnergyState | undefined, now: number, id = ''): EnergyView {
  const cur = energyAt(s ?? newEnergy(id, now), now);
  const max = energyMax(cur.born, now);
  const band = energyBand(cur.points, max);
  const restedLine = energyRestedLine(max);
  // Online the meter refills to the rested line; the rest comes from time away.
  const missing = Math.max(0, restedLine - cur.points);
  const nextPointInMs = missing === 0 ? 0 : Math.max(0, cur.at + ENERGY_REGEN_MS - now);
  return {
    points: cur.points,
    max,
    restedLine,
    band,
    untilNextBand: band === 'rested' ? cur.points - restedLine : band === 'normal' ? cur.points : 0,
    nextPointInMs,
    refillInMs: missing === 0 ? 0 : nextPointInMs + (missing - 1) * ENERGY_REGEN_MS,
  };
}
