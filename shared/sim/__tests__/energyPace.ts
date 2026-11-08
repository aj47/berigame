/**
 * Value per online hour under the energy meter (docs/design/ECONOMY.md section 1),
 * for a human, a 24/7 AI seat and a literal nonstop gatherer.
 *
 * `MeterRules` is a parametric copy of shared/sim/energy.ts so candidate rules
 * can be compared without shipping them; energyPace.test.ts checks that the
 * copy, given the live constants, pays exactly what energy.ts pays.
 *
 * Deterministic: every profile is a fixed schedule of logins, logouts and
 * finished 3 s harvests. "Value" is the sum of payouts (2 rested, 1 normal,
 * 0 or 1 tired), i.e. items and XP in units of one normal harvest.
 */
import {
  ENERGY_MAX, ENERGY_ONLINE_REFILL_SHARE, ENERGY_REGEN_MS, ENERGY_RESTED_FRACTION, ENERGY_SEASON_MS, ENERGY_START_MAX,
  ENERGY_TIRED_EVERY, newEnergy, settleEnergy, spendEnergy, type EnergyState,
} from '../energy';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
/** A Grove berry harvest: 5 ticks of 600 ms, 3 points. */
export const HARVEST_MS = 3000;

export interface MeterRules {
  name: string;
  /** Share of the logged-out refill rate earned while online (up to the rested line). */
  onlineShare: number;
  /** Online refill stops this long after a login (candidate taper). */
  taperAfterMs?: number;
  /** Points per second of gathering. */
  costScale: number;
  tiredEvery: number;
}

/** The rules before this change: online refill at the full rate, up to the rested line. */
export const OLD_RULES: MeterRules = { name: 'today (6 s online)', onlineShare: 1, costScale: 1, tiredEvery: 4 };
/** Whatever energy.ts ships now. */
export const LIVE_RULES: MeterRules = { name: 'live', onlineShare: ENERGY_ONLINE_REFILL_SHARE, costScale: 1, tiredEvery: ENERGY_TIRED_EVERY };
export const CANDIDATES: MeterRules[] = [
  { name: 'A: online refill 12 s', onlineShare: 0.5, costScale: 1, tiredEvery: 4 },
  { name: 'B: taper to 0 after 3 h online', onlineShare: 1, taperAfterMs: 3 * HOUR, costScale: 1, tiredEvery: 4 },
  { name: 'C: refill only logged out', onlineShare: 0, costScale: 1, tiredEvery: 4 },
  { name: 'D: C + 2 points per second', onlineShare: 0, costScale: 2, tiredEvery: 4 },
];

/** One meter driven through a schedule. */
export interface Meter {
  login(now: number): void;
  logout(now: number): void;
  /** One finished gathering action of `ms` at `now`: its payout, and whether it was tired. */
  spend(now: number, ms: number): { payout: number; tired: boolean };
  /** Points and meter size at the last event. */
  read(): { points: number; max: number };
}

const sizeAt = (born: number, now: number) => {
  const age = Math.max(0, now - born);
  return age >= ENERGY_SEASON_MS ? ENERGY_MAX : ENERGY_START_MAX + Math.floor(((ENERGY_MAX - ENERGY_START_MAX) * age) / ENERGY_SEASON_MS);
};
const lineOf = (max: number) => Math.floor(max * ENERGY_RESTED_FRACTION);

/** The parametric meter: energy.ts with `rules`. */
export function modelMeter(rules: MeterRules, born: number, start: number): Meter {
  const s = { ...newEnergy('m', start, born), onlineSince: start, max: sizeAt(born, start) };
  const refill = (now: number, online: boolean) => {
    const max = (s.max = sizeAt(s.born, now));
    const ceiling = online ? lineOf(max) : max;
    if (s.points >= ceiling) { s.at = Math.max(s.at, now); return; }
    let period = ENERGY_REGEN_MS, until = now;
    if (online) {
      if (rules.onlineShare <= 0) { s.at = Math.max(s.at, now); return; }
      period = ENERGY_REGEN_MS / rules.onlineShare;
      if (rules.taperAfterMs !== undefined) until = Math.min(now, Math.max(s.at, s.onlineSince + rules.taperAfterMs));
    }
    const gained = Math.floor(Math.max(0, until - s.at) / period);
    s.points = Math.min(ceiling, s.points + gained);
    s.at = s.points >= ceiling || until < now ? now : s.at + gained * period;
  };
  return {
    login(now) { refill(now, false); s.onlineSince = now; },
    logout(now) { refill(now, true); },
    spend(now, ms) {
      refill(now, true);
      const need = Math.max(1, Math.round((ms / 1000) * rules.costScale));
      if (s.points < need) {
        s.tired = (s.tired + 1) % rules.tiredEvery;
        return { payout: s.tired === 0 ? 1 : 0, tired: true };
      }
      const payout = s.points > lineOf(s.max) ? 2 : 1;
      s.points -= need;
      s.tired = 0;
      return { payout, tired: false };
    },
    read: () => ({ points: s.points, max: s.max }),
  };
}

/** The shipped meter, through the same calls the server makes (lib/energy.ts, lifecycle.ts). */
export function liveMeter(born: number, start: number): Meter {
  let s: EnergyState = newEnergy('m', start, born), max = sizeAt(born, start);
  return {
    login(now) { s = settleEnergy(s, now, false); max = sizeAt(born, now); },
    logout(now) { s = settleEnergy(s, now, true); max = sizeAt(born, now); },
    spend(now, ms) {
      const spent = spendEnergy(s, now, Math.max(1, Math.round(ms / 1000)));
      s = spent.state; max = sizeAt(born, now);
      return { payout: spent.payout, tired: spent.band === 'tired' };
    },
    read: () => ({ points: s.points, max }),
  };
}

export type Event = { t: number; kind: 'login' | 'logout' } | { t: number; kind: 'harvest' };

/** Harvests every `everyMs` from `from` while `t < to`. */
function* harvests(from: number, to: number, everyMs: number): Generator<Event> {
  for (let t = from; t < to; t += everyMs) yield { t, kind: 'harvest' };
}

/**
 * Online from `from` to `to`, alternating `gatherMs` of gathering (one finished
 * harvest every `everyMs`) with `otherMs` of walking, banking, crafting and chat.
 */
function* activity(from: number, to: number, gatherMs: number, otherMs: number, everyMs: number): Generator<Event> {
  for (let t = from; t < to; t += gatherMs + otherMs) yield* harvests(t, Math.min(to, t + gatherMs), everyMs);
}

export interface Profile {
  name: string;
  /** Character birth time; < -ENERGY_SEASON_MS is a seasoned meter. */
  born: number;
  events(days: number): Generator<Event>;
}

/** The AI seat's pace while gathering: one finished harvest per 10.2 s (walks between trees and loses some claims). */
export const AGENT_EVERY_MS = 3_600_000 / 352;
/**
 * A human's pace while gathering, chosen so the old rules reproduce the
 * measured 1.8x (agent value per online hour over a human's). Slow because
 * humans on the beta share trees with the seats, lose claim draws and dawdle.
 */
export const HUMAN_EVERY_MS = 54_000;

/** 2-hour sessions at 08:00 and 19:00, gathering 14 of every 20 minutes (70%). */
export function human(name: string, everyMs: number, born = -2 * ENERGY_SEASON_MS): Profile {
  return {
    name, born,
    *events(days) {
      for (let d = 0; d < days; d++) for (const start of [8 * HOUR, 19 * HOUR]) {
        const from = d * DAY + start, to = from + 2 * HOUR;
        yield { t: from, kind: 'login' };
        yield* activity(from, to, 14 * MIN, 6 * MIN, everyMs);
        yield { t: to, kind: 'logout' };
      }
    },
  };
}

/**
 * A 24/7 AI seat: online the whole time, gathering half of it in 78-minute
 * stretches between as long walking, banking and crafting. 176 harvests an hour.
 */
export function agent(name = 'AI seat 24/7', born = -2 * ENERGY_SEASON_MS): Profile {
  return {
    name, born,
    *events(days) {
      yield { t: 0, kind: 'login' };
      yield* activity(0, days * DAY, 78 * MIN, 78 * MIN, AGENT_EVERY_MS);
    },
  };
}

/** The 24/7 seat, reconnecting every 3 hours (a gateway reset, or on purpose): a logout and a login at the same instant. */
export function reconnecting(): Profile {
  const seat = agent('AI seat 24/7, reconnecting every 3 h');
  return {
    ...seat,
    *events(days) {
      let next = 3 * HOUR;
      for (const e of seat.events(days)) {
        for (; next <= e.t; next += 3 * HOUR) { yield { t: next, kind: 'logout' }; yield { t: next, kind: 'login' }; }
        yield e;
      }
    },
  };
}

/** The same seat, but logged out 20:00-08:00 every night (a seat that learned to rest). */
export function sleeper(): Profile {
  return {
    name: 'AI seat, 12 h/night logged out', born: -2 * ENERGY_SEASON_MS,
    *events(days) {
      for (let d = 0; d < days; d++) {
        const from = d * DAY + 8 * HOUR, to = from + 12 * HOUR;
        yield { t: from, kind: 'login' };
        yield* activity(from, to, 78 * MIN, 78 * MIN, AGENT_EVERY_MS);
        yield { t: to, kind: 'logout' };
      }
    },
  };
}

/** Back-to-back 3 s harvests, online forever. */
export function nonstop(): Profile {
  return {
    name: 'literal nonstop', born: -2 * ENERGY_SEASON_MS,
    *events(days) { yield { t: 0, kind: 'login' }; yield* harvests(0, days * DAY, HARVEST_MS); },
  };
}

/** A brand-new character that stays online at `everyMs` pace, 70% gathering. */
export function newcomer(everyMs: number): Profile {
  return {
    name: 'newcomer, one long login', born: 0,
    *events(days) { yield { t: 0, kind: 'login' }; yield* activity(0, days * DAY, 14 * MIN, 6 * MIN, everyMs); },
  };
}

export interface Run {
  value: number;
  harvests: number;
  onlineMs: number;
  /** Lowest points / max seen after a spend. */
  minFraction: number;
  /** Hours from the start to the first tired harvest, or Infinity. */
  tiredAfterH: number;
  tiredCount: number;
}

/** Drive `meter` through `profile` and total what happened in [fromMs, toMs). */
export function run(profile: Profile, meter: Meter, days: number, fromMs = 0, toMs = days * DAY): Run {
  const out: Run = { value: 0, harvests: 0, onlineMs: 0, minFraction: 1, tiredAfterH: Infinity, tiredCount: 0 };
  let onlineAt: number | undefined;
  const clip = (a: number, b: number) => Math.max(0, Math.min(b, toMs) - Math.max(a, fromMs));
  for (const e of profile.events(days)) {
    if (e.kind === 'login') { meter.login(e.t); onlineAt = e.t; continue; }
    if (e.kind === 'logout') { meter.logout(e.t); if (onlineAt !== undefined) out.onlineMs += clip(onlineAt, e.t); onlineAt = undefined; continue; }
    const spent = meter.spend(e.t, HARVEST_MS);
    if (spent.tired && out.tiredAfterH === Infinity) out.tiredAfterH = e.t / HOUR;
    if (e.t < fromMs || e.t >= toMs) continue;
    out.value += spent.payout;
    out.harvests += 1;
    if (spent.tired) out.tiredCount += 1;
    const { points, max } = meter.read();
    out.minFraction = Math.min(out.minFraction, points / max);
  }
  if (onlineAt !== undefined) out.onlineMs += clip(onlineAt, days * DAY);
  return out;
}

export const perHour = (r: Run) => r.value / (r.onlineMs / HOUR);

export interface Row {
  rules: string;
  humanPerH: number;
  keenHumanPerH: number;
  agentDay1PerH: number;
  agentPerH: number;
  nonstopPerH: number;
  agentVsHuman: number;
  agentWeekVsHuman: number;
  agentTiredAfterH: number;
  reconnectingVsHuman: number;
  sleeperPerOnlineH: number;
  sleeperPerDay: number;
  newcomerMinFraction: number;
  newcomerTiredAfterH: number;
  newcomerHumanTiredAfterH: number;
}

const DAYS = 7;
/** One candidate's numbers: steady state is days 2..7, after the meter has settled. */
export function evaluate(rules: MeterRules, meterFor: (p: Profile) => Meter = (p) => modelMeter(rules, p.born, 0)): Row {
  const steady = (p: Profile) => run(p, meterFor(p), DAYS, DAY);
  const people = human('human', HUMAN_EVERY_MS), keen = human('keen human', AGENT_EVERY_MS);
  const humanPerH = perHour(steady(people));
  const seat = agent();
  const agentPerH = perHour(steady(seat));
  const week = run(seat, meterFor(seat), DAYS);
  const sleepy = steady(sleeper());
  // A newcomer's first 2-hour session at the seat's pace, then a long first login at it.
  const fresh = newcomer(AGENT_EVERY_MS);
  const first = run(fresh, meterFor(fresh), 1, 0, 2 * HOUR);
  const long = run(fresh, meterFor(fresh), 3);
  const slow = newcomer(HUMAN_EVERY_MS);
  const slowLong = run(slow, meterFor(slow), 3);
  return {
    rules: rules.name,
    humanPerH,
    keenHumanPerH: perHour(steady(keen)),
    agentDay1PerH: perHour(run(seat, meterFor(seat), 1)),
    agentPerH,
    nonstopPerH: perHour(steady(nonstop())),
    agentVsHuman: agentPerH / humanPerH,
    agentWeekVsHuman: perHour(week) / humanPerH,
    agentTiredAfterH: week.tiredAfterH,
    reconnectingVsHuman: perHour(steady(reconnecting())) / humanPerH,
    sleeperPerOnlineH: perHour(sleepy),
    sleeperPerDay: sleepy.value / (DAYS - 1),
    newcomerMinFraction: first.minFraction,
    newcomerTiredAfterH: long.tiredAfterH,
    newcomerHumanTiredAfterH: slowLong.tiredAfterH,
  };
}

/** The candidate table as text, for the PR and ECONOMY.md. */
export function table(rows: Row[]): string {
  const f = (n: number, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : 'never');
  const h = (n: number) => (Number.isFinite(n) ? `${n.toFixed(1)} h` : 'never');
  const head = '| rules | human /h | keen human /h | agent /h (day 1 / steady) | agent vs human (steady / first week) | agent tired after | reconnecting every 3 h vs human | nonstop /h | resting seat /online h | newcomer: 2 h low, tired after (seat pace / human pace) |';
  const lines = rows.map((r) =>
    `| ${r.rules} | ${f(r.humanPerH)} | ${f(r.keenHumanPerH)} | ${f(r.agentDay1PerH)} / ${f(r.agentPerH)} | ${f(r.agentVsHuman, 2)}x / ${f(r.agentWeekVsHuman, 2)}x | ${h(r.agentTiredAfterH)} | ${f(r.reconnectingVsHuman, 2)}x | ${f(r.nonstopPerH)} | ${f(r.sleeperPerOnlineH)} | ${f(r.newcomerMinFraction * 100)}%, ${h(r.newcomerTiredAfterH)} / ${h(r.newcomerHumanTiredAfterH)} |`);
  return [head, '|' + '---|'.repeat(10), ...lines].join('\n');
}
