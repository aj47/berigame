import { fxDebug } from './hitFlash';

/**
 * Hit reactions layered on the victim's rendered body (never its group, whose
 * position useTileMotion owns): a short directional knockback away from the
 * attacker that eases back to rest, and a brief hitstop that freezes the
 * attacker's and victim's mixers on heavy blows. Purely visual: server and
 * interpolated tile positions are untouched. No per-frame allocation.
 */

/** Knockback distance (world units, 1 = one tile) by weapon weight: fist, stick, club. */
export const KNOCKBACK = [0.18, 0.4, 0.55] as const;
/** Hitstop length (ms) by weapon weight; fists get none. */
export const HITSTOP_MS = [0, 65, 90] as const;
/** Knockback: fast push out, slower ease back. */
export const PUSH_MS = 70;
export const RETURN_MS = 260;

interface Knock { at: number; dx: number; dz: number; }
interface Stop { from: number; to: number; }
const knocks = new Map<string, Knock>();
const stops = new Map<string, Stop>();
/** Settings > Reduce motion: no knockback or hitstop. Kept in sync by settingsStore. */
export const hitReactionPrefs = { reduced: false };

function stopFor(id: string, from: number, ms: number): void {
  const s = stops.get(id) ?? { from: 0, to: 0 };
  s.from = from; s.to = from + ms;
  stops.set(id, s);
}

/**
 * A blow lands on `victim` at `at` (performance.now() time). `dirX/dirZ` point
 * from attacker to victim (any length; zero means no knockback).
 */
export function reactAt(victim: string, attacker: string, at: number, weight: number, dirX: number, dirZ: number): void {
  if (hitReactionPrefs.reduced) return;
  const w = Math.max(0, Math.min(2, weight | 0));
  const len = Math.hypot(dirX, dirZ);
  if (len > 1e-4 && victim !== attacker) {
    const k = knocks.get(victim) ?? { at: 0, dx: 0, dz: 0 };
    k.at = at; k.dx = (dirX / len) * KNOCKBACK[w]; k.dz = (dirZ / len) * KNOCKBACK[w];
    knocks.set(victim, k);
  }
  const ms = HITSTOP_MS[w];
  if (ms > 0) { stopFor(victim, at, ms); stopFor(attacker, at, ms); }
}

/** 0..1 knockback envelope `t` ms after impact: quick ease-out push, cosine ease back. */
export function knockEnvelope(t: number): number {
  if (t < 0) return 0;
  if (t < PUSH_MS) { const p = 1 - t / PUSH_MS; return 1 - p * p; }
  const r = (t - PUSH_MS) / RETURN_MS;
  return r >= 1 ? 0 : 0.5 + 0.5 * Math.cos(r * Math.PI);
}

/** World-space knockback of `identity` at `now`, written into `out`. False when at rest. */
export function knockOffset(identity: string, now: number, out: { x: number; z: number }): boolean {
  out.x = 0; out.z = 0;
  const k = knocks.get(identity);
  if (!k) return false;
  const t = (now - k.at) / fxDebug.timeScale;
  if (t >= PUSH_MS + RETURN_MS) { knocks.delete(identity); return false; }
  const e = knockEnvelope(t);
  out.x = k.dx * e; out.z = k.dz * e;
  return true;
}

/** Whether `identity`'s animation is frozen by a hitstop at `now`. */
export function inHitstop(identity: string, now: number): boolean {
  const s = stops.get(identity);
  if (!s) return false;
  if (now >= s.from + (s.to - s.from) * fxDebug.timeScale) { stops.delete(identity); return false; }
  return now >= s.from;
}

export function clearHitReactions(): void { knocks.clear(); stops.clear(); }
