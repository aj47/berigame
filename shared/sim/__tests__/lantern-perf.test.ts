import { describe, expect, it, vi } from 'vitest';
import { R, id, spireHarness } from './spireHarness';
import { PlayerState } from '../types';
import { worldBlockedSet } from '../social';
import {
  LANTERN_RULES_VERSION, LANTERN_SPAWNS, LANTERN_TILES, LanternKind, LanternStage, SpireMemberState, SpireOutcome, SpireStage,
  lanternEmptySlots, lanternMoves, lanternSeed, lanternTile,
} from '../index';

vi.mock('../../../spacetimedb/node_modules/spacetimedb/dist/server/index.mjs', () => ({
  t: new Proxy({}, { get: () => () => ({}) }),
  SenderError: class SenderError extends Error {},
}));
vi.mock('../../../spacetimedb/src/schema', () => ({
  default: {
    reducer: (...args: unknown[]) => args[args.length - 1],
    init: (fn: unknown) => fn, clientConnected: (fn: unknown) => fn, clientDisconnected: (fn: unknown) => fn,
  },
}));
vi.mock('../../../spacetimedb/src/tables', () => ({ tickSchedule: { rowType: {} } }));

import { tick } from '../../../spacetimedb/src/reducers/tick';
import { phaseLantern } from '../../../spacetimedb/src/lib/lantern';
import type { BossTick } from '../../../spacetimedb/src/lib/bossTick';

/**
 * The tick cost of the Drowned Hollow, as spire-perf.test.ts measures the Spire: 12 Active runs (the default
 * lanternMaxRuns) x 4 members x 120 ticks through `phaseLantern` alone, starting in phase 3 on Lantern Storm
 * (the most blows per tick) so dens, dives, tides and ebbs all pass; and the closed/idle cost with 250 loaded
 * players (the stranded sweep). Asserts CI-safe ceilings and logs the medians.
 */

const RUNS = 12, PARTY = 4, TICKS = 120;
const BLOCKED = worldBlockedSet([]);

function bench(players: Map<string, any>, order: string[], ctx: any, T: number, before: Map<string, any>): number {
  const t: BossTick = {
    ctx, T, players, order, before, blocked: BLOCKED,
    mark: () => {}, interrupt: () => {}, combatDamage: () => 0, enterRule: (() => () => true) as any,
  };
  const t0 = performance.now();
  phaseLantern(t);
  return performance.now() - t0;
}

describe('phaseLantern cost', () => {
  it(`${RUNS} active runs x ${PARTY} members x ${TICKS} ticks`, () => {
    const h = spireHarness(R(tick), []);
    const { db, ctx } = h;
    db.lanternConfig.insert({ id: 0, lanternOpen: true, lanternMaxRuns: 32, lanternHpBase: 810, lanternHpPerMember: 970 });
    const T0 = 1000;
    const ids: ReturnType<typeof id>[] = [];
    const tiles = new Map<string, number>();
    for (let r = 0; r < RUNS; r++) {
      const run = db.lanternRun.insert({
        id: 0n, leader: id(100 + r * PARTY), stage: SpireStage.Active, outcome: SpireOutcome.None, rules: LANTERN_RULES_VERSION,
        partySize: PARTY, createdTick: T0 - 10, startTick: T0 - 300, endTick: T0 + 10_000, phase: 3, clearTicks: 0,
      });
      db.lanternFight.insert({
        runId: run.id, seed: lanternSeed(run.id, T0), hp: 10_000_000, maxHp: 10_000_000, phase: 3, partySize: PARTY,
        stage: LanternStage.Den, cycle: 5, denCount: 1, patternCount: 20, curKind: LanternKind.Storm, curStart: T0 - (r % 3),
        curSeed: (r * 11) & 63, curAim: LANTERN_SPAWNS[0], surfaceTick: 0, spring: 0, pulseSeed: 0, capped: false, ...lanternEmptySlots(),
      });
      for (let s = 0; s < PARTY; s++) {
        const who = id(100 + r * PARTY + s);
        ids.push(who);
        const at = lanternTile(LANTERN_SPAWNS[s]);
        tiles.set(who.toHexString(), LANTERN_SPAWNS[s]);
        db.player.insert({
          identity: who, name: `P${r}.${s}`, online: true, connections: 1, region: 'bramblewild', x: at.x, z: at.z,
          facing: 0, targetX: undefined, targetZ: undefined, hp: 30, maxHp: 30, state: PlayerState.Alive, respawnTick: 0, stance: 0,
          fightState: 0, combatTarget: undefined, hostile: false, nextSwingTick: 0, harvestTreeId: 0, harvestEndTick: 0, pending: 0,
          pendingId: 0n, lastInputTick: 0, inputsThisTick: 0, eatCooldownUntilTick: 0, weapon: '',
        });
        db.lanternMember.insert({ identity: who, runId: run.id, slot: s, state: SpireMemberState.In, joinedTick: T0 - 10, awaySinceTick: 0, awayCount: 0, meals: 0 });
      }
    }
    const order = ids.map((i) => i.toHexString()).sort();
    const times: number[] = [];
    let hurt = 0;
    const stages = new Set<number>();
    for (let k = 0; k < TICKS; k++) {
      const T = T0 + 1 + k;
      const before = new Map<string, any>(), players = new Map<string, any>();
      ids.forEach((who, n) => {
        const h = who.toHexString();
        const row = db.player.identity.find(who);
        before.set(h, row);
        // A deterministic walk of 0-2 steps, HP topped up so nobody is knocked out.
        const moves = lanternMoves(tiles.get(h)!);
        const to = moves[(n * 7 + k * 3) % moves.length];
        tiles.set(h, to);
        players.set(h, { ...row, ...lanternTile(to), hp: 30 });
      });
      times.push(bench(players, order, ctx, T, before));
      for (const p of players.values()) { hurt += 30 - p.hp; db.player.identity.update(p); }
      for (const f of db.lanternFight.iter()) stages.add(f.stage);
    }
    times.sort((a, b) => a - b);
    const median = times[times.length >> 1];
    console.log(`phaseLantern: median ${median.toFixed(3)} ms, p95 ${times[Math.floor(times.length * 0.95)].toFixed(3)} ms over ${TICKS} ticks (${RUNS} runs, ${RUNS * PARTY} members, ${hurt} HP of hits, stages ${[...stages].sort().join(',')})`);
    for (const run of db.lanternRun.iter()) expect(run.stage).toBe(SpireStage.Active);
    expect(hurt).toBeGreaterThan(0);
    expect(stages.has(LanternStage.Tide)).toBe(true);
    expect(median).toBeLessThan(8);
  });

  it('closed: no runs and 250 loaded overworld players cost a count and one pass', () => {
    const h = spireHarness(R(tick), []);
    const { db, ctx } = h;
    const players = new Map<string, any>();
    for (let n = 0; n < 250; n++) {
      const who = id(1000 + n);
      const t = LANTERN_TILES[n % LANTERN_TILES.length];
      players.set(who.toHexString(), {
        identity: who, name: `Q${n}`, online: true, region: 'bramblewild', x: 20 + (t % 30), z: 20 + (n % 30), hp: 30, maxHp: 30,
        state: PlayerState.Alive, weapon: '',
      });
    }
    const order = [...players.keys()].sort();
    const times: number[] = [];
    for (let k = 0; k < 200; k++) times.push(bench(players, order, ctx, 2000 + k, players));
    times.sort((a, b) => a - b);
    const median = times[times.length >> 1];
    console.log(`phaseLantern idle (250 players): median ${(median * 1000).toFixed(1)} us, p95 ${(times[Math.floor(times.length * 0.95)] * 1000).toFixed(1)} us`);
    expect(h.log.insert.lanternRun ?? 0).toBe(0);
    expect(median).toBeLessThan(1);
  });
});
