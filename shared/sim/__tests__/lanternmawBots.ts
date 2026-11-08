/**
 * Scripted Lanternmaw players for the difficulty estimate (BOSSES.md 9.9):
 * pure, deterministic bots that drive `lanternResolveTick` with what a player
 * could know. A bot sees the fight `react` ticks late, plans by backward
 * induction over the published hazards (or only dodges what lands this tick
 * and the next), slips into a random
 * step with probability `slip`, caps springs with probability `cap`, and eats
 * a goldberry (+10, 3-tick swing delay, 6 per run) at or below `eatAt` HP.
 */
import { mix32 } from '../bullets';
import {
  LANTERN_CELLS, LANTERN_MEALS, LANTERN_MOVE_AT, LANTERN_MOVE_TO, LANTERN_PLANK, LANTERN_SPAWNS, LANTERN_SPRINGS,
  LANTERN_STANDABLE, LANTERN_TILES, LanternStage, lanternHazardMask, lanternInCourt, lanternNearSpring, lanternNewRun,
  lanternResolveTick, type LanternFightLike, type LanternRunSim,
} from '../lanternmaw';

export interface BotProfile {
  name: string;
  /** Ticks late the bot sees the fight (0 = acts on the tick a telegraph appears). */
  react: number;
  /** Plans every published hazard by backward induction; false = only avoids tiles hit this tick and the next. */
  full: boolean;
  /** Chance per tick of a random step instead of the planned one, in 1/1000. */
  slip: number;
  /** Chance per dive that it goes to cap the spring, in 1/1000 (only the lowest present slot caps). */
  cap: number;
  eatAt: number;
  weapon: number;
  /** In the den, step into reach only on its own swing tick and wait one ring out otherwise. */
  dance: boolean;
}

export const PERFECT: BotProfile = { name: 'perfect', react: 0, full: true, slip: 0, cap: 1000, eatAt: 14, weapon: 8, dance: false };
export const CAREFUL: BotProfile = { name: 'careful', react: 1, full: true, slip: 20, cap: 1000, eatAt: 14, weapon: 8, dance: true };
export const SLOPPY: BotProfile = { name: 'sloppy', react: 2, full: false, slip: 60, cap: 300, eatAt: 8, weapon: 8, dance: false };

const N = LANTERN_CELLS;
/** All-pairs walking steps on the floor (the maw blocks; diagonals need both corners). */
const DIST: Int16Array = (() => {
  const d = new Int16Array(N * N).fill(-1);
  for (const a of LANTERN_TILES) {
    const q = [a];
    d[a * N + a] = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], u = i % 15, v = (i - u) / 15;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = u + dx, z = v + dz, j = z * 15 + x;
        if (x < 0 || z < 0 || x > 14 || z > 14 || !LANTERN_STANDABLE[j] || d[a * N + j] >= 0) continue;
        if (dx && dz && (!LANTERN_STANDABLE[v * 15 + x] || !LANTERN_STANDABLE[z * 15 + u])) continue;
        d[a * N + j] = d[a * N + i] + 1;
        q.push(j);
      }
    }
  }
  return d;
})();
const distToSet = (j: number, set: (i: number) => boolean) => {
  let best = 99;
  for (const i of LANTERN_TILES) if (set(i)) best = Math.min(best, DIST[j * N + i]);
  return best;
};
const COURT_DIST = Int16Array.from({ length: N }, (_, j) => (LANTERN_STANDABLE[j] ? distToSet(j, lanternInCourt) : 99));
const SPRING_DIST = [0, 1, 2, 3].map((s) => Int16Array.from({ length: N }, (_, j) => (LANTERN_STANDABLE[j] ? distToSet(j, (i) => lanternNearSpring(i, s) && LANTERN_PLANK[i] === 1) : 99)));

/** Winning masks for absolute ticks base..base+H from what `view` publishes. */
interface Plan { base: number; win: Uint8Array[]; haz: Uint8Array[] }
const viewKey = (f: LanternFightLike) => `${f.stage},${f.curKind},${f.curStart},${f.curSeed},${f.curAim},${f.surfaceTick},${f.spring},${f.pulseSeed},${f.capped},${f.phase}`;

function plan(view: LanternFightLike, startTick: number, base: number, H: number): Plan {
  const haz: Uint8Array[] = [];
  for (let k = 0; k <= H; k++) haz.push(lanternHazardMask(view, base + k, startTick));
  const win: Uint8Array[] = new Array(H + 1);
  win[H] = Uint8Array.from(haz[H], (h, i) => (LANTERN_STANDABLE[i] && !h ? 1 : 0));
  for (let k = H - 1; k >= 0; k--) {
    const w = new Uint8Array(N), nx = win[k + 1];
    for (const i of LANTERN_TILES) {
      if (haz[k][i]) continue;
      for (let m = LANTERN_MOVE_AT[i]; m < LANTERN_MOVE_AT[i + 1]; m++) if (nx[LANTERN_MOVE_TO[m]]) { w[i] = 1; break; }
    }
    win[k] = w;
  }
  return { base, win, haz };
}

export interface BotResult { outcome: string; ticks: number; dealt: number; hits: number; drowned: number; caps: number; meals: number; hpLeft: number }

/** One run: `profiles[k]` plays slot k. `seed` fixes the fight and the bots' slips. */
export function runLanternBots(seed: number, profiles: readonly BotProfile[]): BotResult {
  const start = 100;
  let run: LanternRunSim = lanternNewRun(seed, profiles.map((p, k) => ({ tile: LANTERN_SPAWNS[k], weapon: p.weapon })), start);
  const hist = new Map<number, LanternFightLike>([[start - 1, run.fight]]);
  const plans = profiles.map(() => new Map<string, Plan>());
  const capThisDive = profiles.map(() => false);
  const decided = profiles.map(() => -1);
  const nextEat = profiles.map(() => 0);
  for (let T = start; !run.outcome; T++) {
    const members = run.members.map((m) => ({ ...m }));
    const live = members.filter((m) => m.present);
    const capper = live.length ? live[0].slot : -1;
    for (const m of live) {
      const p = profiles[m.slot];
      const vt = Math.max(start - 1, T - 1 - p.react);
      const view = hist.get(vt)!;
      if (view.stage === LanternStage.Dive && decided[m.slot] !== view.surfaceTick) {
        decided[m.slot] = view.surfaceTick;
        capThisDive[m.slot] = mix32(seed ^ 0xca9, view.surfaceTick * 4 + m.slot) % 1000 < p.cap;
      }
      // Eat.
      if (m.hp <= p.eatAt && m.meals < LANTERN_MEALS && T >= nextEat[m.slot]) {
        m.hp = Math.min(m.maxHp, m.hp + 10); m.meals++; m.nextSwingTick = T + 3; nextEat[m.slot] = T + 3;
      }
      // Plan from the view (memoized per published state).
      const key = viewKey(view);
      let pl = plans[m.slot].get(key);
      if (!pl || T > pl.base + 6) { pl = plan(view, start, T, 30); plans[m.slot].set(key, pl); }
      const k = T - pl.base;
      const moves = Array.from(LANTERN_MOVE_TO.subarray(LANTERN_MOVE_AT[m.tile], LANTERN_MOVE_AT[m.tile + 1]));
      let choice = moves[0];
      if (mix32(seed, T * 8 + m.slot) % 1000 < p.slip) {
        choice = moves[mix32(seed ^ 0x51, T * 8 + m.slot) % moves.length];
      } else {
        const w = p.full ? pl.win[k] : null;
        const capping = capThisDive[m.slot] && m.slot === capper && view.stage === LanternStage.Dive;
        const spring = LANTERN_SPRINGS[view.spring];
        let best = -1e9;
        for (const j of moves) {
          const tier = w ? (w[j] ? 2 : pl.haz[k][j] ? 0 : 1) : (pl.haz[k][j] ? 0 : pl.haz[k + 1][j] ? 1 : 2);
          let goal: number;
          if (capping) goal = -DIST[j * N + spring];
          else if (view.stage === LanternStage.Den || view.stage === LanternStage.Ebb) {
            const swingNow = (T - start) % 4 === m.slot && T >= m.nextSwingTick;
            goal = p.dance && !swingNow ? -Math.abs(COURT_DIST[j] - 1) : -COURT_DIST[j];
          }
          else goal = -SPRING_DIST[view.spring][j];
          const score = tier * 1000 + goal * 10 + (j === m.tile ? 1 : 0);
          if (score > best) { best = score; choice = j; }
        }
      }
      m.tile = choice;
    }
    run = lanternResolveTick({ ...run, members }, T);
    hist.set(T, run.fight);
  }
  const ms = run.members;
  return {
    outcome: run.outcome, ticks: (run.outcome === 'cleared' ? run.clearTick : run.endTick) - start,
    dealt: ms.reduce((a, m) => a + m.dealt, 0), hits: ms.reduce((a, m) => a + m.hits, 0), drowned: ms.reduce((a, m) => a + m.drowned, 0),
    caps: ms.reduce((a, m) => a + m.caps, 0), meals: ms.reduce((a, m) => a + m.meals, 0), hpLeft: run.fight.hp,
  };
}

/** Linear blend from sloppy (t = 0) to careful (t = 1000), in integer thousandths. */
export function blendProfile(t: number): BotProfile {
  const mix = (a: number, b: number) => Math.round(a + ((b - a) * t) / 1000);
  return {
    name: `learner-${t}`, react: mix(SLOPPY.react, CAREFUL.react), full: t >= 500,
    slip: mix(SLOPPY.slip, CAREFUL.slip), cap: mix(SLOPPY.cap, CAREFUL.cap), eatAt: mix(SLOPPY.eatAt, CAREFUL.eatAt), weapon: 8,
    dance: t >= 500,
  };
}
