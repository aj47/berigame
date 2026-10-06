import { describe, expect, it, vi } from 'vitest';
import { R, id, spireHarness } from './spireHarness';
import { PlayerState, type Tile } from '../types';
import { worldBlockedSet } from '../social';
import { SPIRE_FLOOR, spireStandable } from '../bossZones';
import {
  SPIRE_NONE, SPIRE_RULES_VERSION, SPIRE_SPAWNS, SpireMemberState, SpireMode, SpireOutcome, SpirePatternKind, SpireStage,
  spireSeed,
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
import { phaseSpire } from '../../../spacetimedb/src/lib/spire';
import type { BossTick } from '../../../spacetimedb/src/lib/bossTick';

/**
 * FINAL_SPEC 10.2 `spire-perf.test.ts`: 12 Active runs x 4 members x 120 ticks of the densest phase-4 patterns
 * (eclipse and shardstorm) through `phaseSpire` alone. The spec's budget is a median of 1 ms on a dev machine;
 * CORE_SCOPE cut the opt-in BOSS_BENCH switch, so this always runs and asserts a CI-safe ceiling while logging
 * the measured median.
 */

const RUNS = 12, PARTY = 4, TICKS = 120;
const BLOCKED = worldBlockedSet([]);
const standable = (t: Tile) => spireStandable(t);

describe('phaseSpire cost', () => {
  it(`${RUNS} active runs x ${PARTY} members x ${TICKS} ticks of eclipse/shardstorm`, () => {
    const h = spireHarness(R(tick), []);
    const { db, ctx } = h;
    h.config({ spireMaxRuns: 32 });
    const T0 = 1000;
    const ids: ReturnType<typeof id>[] = [];
    for (let r = 0; r < RUNS; r++) {
      const run = db.spireRun.insert({
        id: 0n, leader: id(100 + r * PARTY), stage: SpireStage.Active, outcome: SpireOutcome.None, mode: SpireMode.Normal,
        isPublic: true, rules: SPIRE_RULES_VERSION, partySize: PARTY, createdTick: T0 - 10, queuedTick: 0, startTick: T0 - 400,
        endTick: T0 + 10_000, phase: 4, clearTicks: 0,
      });
      db.spireFight.insert({
        runId: run.id, hp: 10_000_000, maxHp: 10_000_000, phase: 4, seed: spireSeed(run.id, T0), patternCount: 40 + r,
        curKind: r % 2 ? SpirePatternKind.Eclipse : SpirePatternKind.Shardstorm, curStart: T0 - (r % 5), curSeed: (r * 11) & 63,
        curAimX: SPIRE_SPAWNS[0].x, curAimZ: SPIRE_SPAWNS[0].z,
        prevKind: SPIRE_NONE, prevStart: 0, prevSeed: 0, prevAimX: 0, prevAimZ: 0, starWave: 0, starMask: 0,
        hitTick0: 0, hitTick1: 0, hitTick2: 0, hitTick3: 0, hits0: 0, hits1: 0, hits2: 0, hits3: 0,
        stars0: 0, stars1: 0, stars2: 0, stars3: 0, dmg0: 0, dmg1: 0, dmg2: 0, dmg3: 0, downs0: 0, downs1: 0, downs2: 0, downs3: 0,
      });
      for (let s = 0; s < PARTY; s++) {
        const who = id(100 + r * PARTY + s);
        ids.push(who);
        db.player.insert({
          identity: who, name: `P${r}.${s}`, online: true, connections: 1, region: 'bramblewild', x: SPIRE_SPAWNS[s].x, z: SPIRE_SPAWNS[s].z,
          facing: 0, targetX: undefined, targetZ: undefined, hp: 30, maxHp: 30, state: PlayerState.Alive, respawnTick: 0, stance: 0,
          fightState: 0, combatTarget: undefined, hostile: false, nextSwingTick: 0, harvestTreeId: 0, harvestEndTick: 0, pending: 0,
          pendingId: 0n, lastInputTick: 0, inputsThisTick: 0, eatCooldownUntilTick: 0, weapon: '',
        });
        db.spireMember.insert({
          identity: who, runId: run.id, slot: s, state: SpireMemberState.In, joinedTick: T0 - 10, awaySinceTick: 0, awayCount: 0,
          downUntilTick: 0, reviveSinceTick: 0, meals: 0,
        });
      }
    }
    const FLOOR: Tile[] = [];
    for (let z = SPIRE_FLOOR.z0; z <= SPIRE_FLOOR.z1; z++) for (let x = SPIRE_FLOOR.x0; x <= SPIRE_FLOOR.x1; x++) if (standable({ x, z })) FLOOR.push({ x, z });
    const order = ids.map((i) => i.toHexString()).sort();
    const times: number[] = [];
    let hits = 0;
    for (let k = 0; k < TICKS; k++) {
      const T = T0 + 1 + k;
      const before = new Map<string, any>(), players = new Map<string, any>();
      ids.forEach((who, n) => {
        const row = db.player.identity.find(who);
        before.set(who.toHexString(), row);
        // Everyone dodges: a deterministic walk of 0-2 steps over the floor, HP topped up so nobody is knocked out.
        const to = FLOOR[(n * 37 + k * 13) % FLOOR.length];
        const dx = Math.sign(to.x - row.x), dz = Math.sign(to.z - row.z);
        let p = { x: row.x, z: row.z };
        for (let step = 0; step < (k + n) % 3; step++) {
          const next = { x: p.x + dx, z: p.z + dz };
          if (standable(next)) p = next;
        }
        players.set(who.toHexString(), { ...row, x: p.x, z: p.z, hp: 30 });
      });
      const t: BossTick = {
        ctx, T, players, order, before, blocked: BLOCKED,
        mark: () => {}, interrupt: () => {}, combatDamage: () => 0, enterRule: (() => () => true) as any,
      };
      const t0 = performance.now();
      phaseSpire(t);
      times.push(performance.now() - t0);
      for (const p of players.values()) { hits += 30 - p.hp; db.player.identity.update(p); }
    }
    times.sort((a, b) => a - b);
    const median = times[times.length >> 1];
    console.log(`phaseSpire: median ${median.toFixed(3)} ms, p95 ${times[Math.floor(times.length * 0.95)].toFixed(3)} ms over ${TICKS} ticks (${RUNS} runs, ${RUNS * PARTY} members, ${hits} HP of hits)`);
    // Every run is still fighting (nobody knocked out, no timeout) and the patterns kept rotating in phase 4.
    for (const run of db.spireRun.iter()) expect(run.stage).toBe(SpireStage.Active);
    for (const f of db.spireFight.iter()) expect([SpirePatternKind.Eclipse, SpirePatternKind.Shardstorm]).toContain(f.curKind);
    expect(hits).toBeGreaterThan(0);
    expect(median).toBeLessThan(8);
  });
});
