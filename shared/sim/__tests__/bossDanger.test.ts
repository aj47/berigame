import { describe, expect, it } from 'vitest';
import {
  DANGER_FEED_MAX_BYTES, DANGER_MAX_MOVES, atClatterhorn, buildDangerFeed, clatterBaitId, dangerFeedBytes, spireLiveStars,
  spireSafetyCached, type DangerFeed, type DangerInput, type DangerMemberInput, type DangerMove,
} from '../bossDanger';
import { BOSS_CONFIG_DEFAULTS } from '../bossConfig';
import { CLATTER_GLADE, CLATTER_STONES, SPIRE_FLOOR, inSpireFloor, spireStandable } from '../bossZones';
import { BULLET_STRIDE, movesWithin } from '../bullets';
import {
  CLATTER_REACH, ClatterAttack, ClatterEndKind, ClatterState, clatterHitsMove, clatterLane, clatterSwarmFreeLines, clatterTelegraph,
  clatterValidCentre, freshClatterhorn, identityKey32, type ClatterRowLike,
} from '../clatterhorn';
import { GRID_SIZE } from '../constants';
import { chebyshev, isLandTile, tileKey } from '../grid';
import { worldBlockedSet } from '../social';
import {
  SPIRE_MEALS, SPIRE_NONE, SPIRE_PATTERNS, SPIRE_RULES_VERSION, SPIRE_SPAWNS, SpireMemberState, SpireStage, inSpireCourt,
  spireDangerTiles, spireFightBullets, spireHitsMove, spireKnownUntil, spireMiddle, spireSafety, spireStars,
  type SpireFightLike, type SpireRunLike,
} from '../spire';
import type { Tile } from '../types';

const BLOCKED = worldBlockedSet([]);
const S = 1000; // run start tick
const ME = 'a'.repeat(56) + '0000000a';
const hex = (i: number) => i.toString(16).padStart(64, '0');
const key = (t: Tile) => tileKey(t);

function freshFight(over: Partial<SpireFightLike> = {}): SpireFightLike {
  return {
    hp: 2400, maxHp: 2400, phase: 1, seed: 987654, patternCount: 3,
    curKind: SPIRE_NONE, curStart: S, curSeed: 0, curAimX: 0, curAimZ: 0,
    prevKind: SPIRE_NONE, prevStart: 0, prevSeed: 0, prevAimX: 0, prevAimZ: 0,
    starWave: 0, starMask: 0,
    hitTick0: 0, hitTick1: 0, hitTick2: 0, hitTick3: 0, hits0: 0, hits1: 0, hits2: 0, hits3: 0,
    stars0: 0, stars1: 0, stars2: 0, stars3: 0, dmg0: 0, dmg1: 0, dmg2: 0, dmg3: 0,
    downs0: 0, downs1: 0, downs2: 0, downs3: 0,
    ...over,
  };
}
let nextRunId = 41n;
/** Every fight gets its own run id: the safety cache is keyed by run and rotation. */
const activeRun = (over: Partial<SpireRunLike> = {}): SpireRunLike => ({
  id: nextRunId++, stage: SpireStage.Active, outcome: 0, mode: 0, isPublic: true, rules: SPIRE_RULES_VERSION, partySize: 1,
  createdTick: S - 40, queuedTick: 0, startTick: S, endTick: S + 600, phase: 1, clearTicks: 0, ...over,
});
const memberIn = (slot: number, at: Tile | null, over: Partial<DangerMemberInput> = {}): DangerMemberInput => ({
  slot, state: SpireMemberState.In, awaySinceTick: 0, meals: 0, name: `member${slot}`,
  player: at ? { identity: slot === 0 ? ME : hex(slot + 1), x: at.x, z: at.z, hp: 30 } : null, ...over,
});

function spireInput(tick: number, me: Tile, fight: SpireFightLike, over: Partial<DangerInput> = {}, run = activeRun(), members?: DangerMemberInput[]): DangerInput {
  return {
    tick, tickMs: 600, ageMs: 140, rulesVersion: SPIRE_RULES_VERSION,
    me: { identity: ME, x: me.x, z: me.z, hp: 30, maxHp: 30, eatCooldownUntilTick: 0 },
    blocked: BLOCKED,
    spire: { run, fight, members: members ?? [memberIn(0, me)], mySlot: 0, safety: null },
    clatter: null,
    ...over,
  };
}

/** A fight whose prev pattern ran its full duration and whose cur pattern started at `start`. */
function twoPatternFight(prevKind: number, kind: number, start: number, aim: Tile, seed = 13): SpireFightLike {
  const prevStart = start - SPIRE_PATTERNS[prevKind].duration;
  return freshFight({
    prevKind, prevStart, prevSeed: (seed * 7) & 63, prevAimX: aim.x, prevAimZ: aim.z,
    curKind: kind, curStart: start, curSeed: seed & 63, curAimX: aim.x, curAimZ: aim.z,
    phase: SPIRE_PATTERNS[kind].phase,
  });
}

const spireOk = (t: Tile) => spireStandable(t) && !BLOCKED.has(key(t));

/** Brute force with the server rule: hit-free destinations in T+1 with their horizon. */
function bruteMoves(bullets: Int32Array, tick: number, from: Tile, standable: (t: Tile) => boolean,
  hit: (T: number, p0: Tile, p1: Tile, p2: Tile) => number): Map<number, number> {
  const memo = new Map<string, boolean>();
  const free = (k: number, t: Tile): boolean => {
    const id = `${k}:${key(t)}`;
    const hitMemo = memo.get(id);
    if (hitMemo !== undefined) return hitMemo;
    const v = movesWithin(t, standable).some((m) => !hit(tick + k, t, m.mid, m.end) && (k === 3 || free(k + 1, m.end)));
    memo.set(id, v);
    return v;
  };
  const out = new Map<number, number>();
  for (const m of movesWithin(from, standable)) {
    if (hit(tick + 1, from, m.mid, m.end)) continue;
    const anyTwo = movesWithin(m.end, standable).some((n) => !hit(tick + 2, m.end, n.mid, n.end));
    out.set(key(m.end), free(2, m.end) ? 3 : anyTwo ? 2 : 1);
  }
  void bullets;
  return out;
}

const rank = (m: DangerMove) => [+m.star, +m.winning, m.horizon, +m.court, -m.steps];
function cmpRank(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
  return 0;
}

function expectSorted(moves: DangerMove[]) {
  for (let i = 1; i < moves.length; i++) expect(cmpRank(rank(moves[i - 1]), rank(moves[i]))).toBeLessThanOrEqual(0);
}

describe('feed shape', () => {
  it('outside every boss: only tick, you and the rules', () => {
    const feed = buildDangerFeed({
      tick: 50, tickMs: 600, ageMs: 500, rulesVersion: SPIRE_RULES_VERSION,
      me: { identity: ME, x: 25, z: 25, hp: 20, maxHp: 30, eatCooldownUntilTick: 52 }, blocked: BLOCKED,
    });
    expect(feed).toEqual({
      v: 1, tick: 50, tickMs: 600, ageMs: 500, sendWithinMs: 0, rulesVersion: SPIRE_RULES_VERSION, rulesMismatch: false, where: null,
      you: { x: 25, z: 25, hp: 20, maxHp: 30, state: null, immuneTicks: 0, eatReadyInTicks: 2, mealsLeft: null },
      moves: [], best: null, path: [], knownUntilTick: null, telegraph: null,
    });
  });

  it('inside a run: every documented field', () => {
    const me = SPIRE_SPAWNS[0];
    const fight = twoPatternFight(0, 1, S + 16, me);
    const feed = buildDangerFeed(spireInput(S + 18, me, { ...fight, hitTick0: S + 17, starWave: 1 }, {}, activeRun({ partySize: 2 }),
      [memberIn(0, me, { meals: 2 }), memberIn(1, SPIRE_SPAWNS[1])]));
    expect(feed.where).toBe('spire');
    expect(feed.sendWithinMs).toBe(340);
    expect(feed.you).toEqual({ x: me.x, z: me.z, hp: 30, maxHp: 30, state: 'in', immuneTicks: 1, eatReadyInTicks: 0, mealsLeft: SPIRE_MEALS - 2 });
    expect(feed.grid).toEqual({ x0: 70, z0: 55, w: 15, h: 15 });
    expect(feed.map).toHaveLength(15);
    for (const line of feed.map!) expect(line).toMatch(/^[.1-7#*]{15}$/);
    expect(feed.knownUntilTick).toBe(spireKnownUntil(fight));
    expect(feed.boss).toEqual({ name: 'The Shardmother', hp: 2400, maxHp: 2400, phase: 1, phaseName: 'bloom', pattern: 'glint',
      enraged: false, enrageInTicks: 402, timeoutInTicks: 582 });
    expect(feed.party).toEqual([{ id: hex(2), name: 'member1', x: SPIRE_SPAWNS[1].x, z: SPIRE_SPAWNS[1].z, hp: 30, state: 'in', stars: 0, away: false }]);
    expect(feed.stars).toHaveLength(4);
    for (const s of feed.stars!) expect(s.ticksLeft).toBe(S + 23 - (S + 18));
    expect(feed.nextStars).toEqual({ inTicks: 6 });
    expect(feed.moves.length).toBeGreaterThan(0);
    expect(feed.best).toEqual({ to: feed.moves[0].to, via: feed.moves[0].via });
    expect(feed.path.length).toBeGreaterThan(0);
    expect(feed.telegraph).toBeNull();
    // No downed or practice fields (CORE_SCOPE).
    const json = JSON.stringify(feed);
    expect(json).not.toMatch(/downInTicks|practice|downed/);
  });

  it('a rules mismatch omits map, moves and path', () => {
    const me = SPIRE_SPAWNS[0];
    const feed = buildDangerFeed(spireInput(S + 2, me, twoPatternFight(0, 1, S, me), {}, activeRun({ rules: SPIRE_RULES_VERSION + 1 })));
    expect(feed.rulesMismatch).toBe(true);
    expect(feed.map).toBeUndefined();
    expect(feed.grid).toBeUndefined();
    expect(feed).toMatchObject({ moves: [], best: null, path: [] });
    expect(feed.boss).toBeDefined();
  });

  it('knocked out, away or Left members get no moves', () => {
    const me = SPIRE_SPAWNS[0];
    const fight = twoPatternFight(0, 1, S, me);
    const out = buildDangerFeed(spireInput(S + 2, { x: 61, z: 45 }, fight, {}, activeRun(), [memberIn(0, { x: 61, z: 45 }, { state: SpireMemberState.Out })]));
    expect(out.where).toBe('spire');
    expect(out.you.state).toBe('out');
    expect(out).toMatchObject({ moves: [], best: null, path: [] });
    const away = buildDangerFeed(spireInput(S + 2, me, fight, {}, activeRun(), [memberIn(0, me, { awaySinceTick: S + 1 })]));
    expect(away).toMatchObject({ moves: [], best: null, path: [] });
    const lobby = buildDangerFeed(spireInput(S + 2, { x: 62, z: 47 }, fight, {}, activeRun({ stage: SpireStage.Lobby })));
    expect(lobby.where).toBeNull();
  });

  it('works during the intro, before the first pattern starts', () => {
    const me = SPIRE_SPAWNS[2];
    const fight = freshFight({ curKind: 0, curStart: S, curSeed: 5, curAimX: me.x, curAimZ: me.z });
    const feed = buildDangerFeed(spireInput(S - 4, me, fight));
    expect(feed.moves.length).toBeGreaterThan(0);
    expect(feed.moves.every((m) => m.winning && m.horizon === 3)).toBe(true);
    expect(feed.stars).toEqual([]);
    expect(feed.nextStars).toEqual({ inTicks: 4 });
    expect(feed.path.length).toBe(16);
  });
});

describe('spire moves, horizon, winning and map against brute force', () => {
  const positions: Tile[] = [SPIRE_SPAWNS[0], { x: 74, z: 62 }, { x: 77, z: 58 }, { x: 81, z: 64 }, { x: 70, z: 55 }];
  const cases: [number, number][] = [];
  for (let kind = 0; kind < SPIRE_PATTERNS.length; kind++) {
    const prev = SPIRE_PATTERNS.findIndex((p, i) => i !== kind && p.phase === SPIRE_PATTERNS[kind].phase);
    cases.push([prev < 0 ? 0 : prev, kind]);
  }
  it.each(cases)('prev %i then kind %i', (prevKind, kind) => {
    let checked = 0;
    for (const me of positions) for (const dt of [0, 2, 4, 6, 9, 13]) {
      const start = S + 48;
      const fight = twoPatternFight(prevKind, kind, start, me, kind * 5 + dt);
      const tick = start + dt;
      const feed = buildDangerFeed(spireInput(tick, me, fight));
      const bullets = spireFightBullets(fight);
      // Map digits are the exact stationary danger of ticks +1..+3.
      const d = [1, 2, 3].map((k) => spireDangerTiles(bullets, tick + k));
      const stars = new Set(spireStars(fight.seed, Math.floor((tick + 1 - S) / 12), 3).map(key));
      for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
        const t = { x: SPIRE_FLOOR.x0 + c, z: SPIRE_FLOOR.z0 + r };
        const ch = feed.map![r][c];
        if (!spireOk(t)) { expect(ch).toBe('#'); continue; }
        const bits = (d[0].has(key(t)) ? 1 : 0) | (d[1].has(key(t)) ? 2 : 0) | (d[2].has(key(t)) ? 4 : 0);
        expect(ch).toBe(bits ? String(bits) : stars.has(key(t)) ? '*' : '.');
      }
      // Moves: hit-free under the server rule, canonical middle, horizon exact, nothing better left out.
      const brute = bruteMoves(bullets, tick, me, spireOk, (T, a, b, c) => spireHitsMove(bullets, T, a, b, c));
      const fresh = spireSafety(bullets, tick, BLOCKED);
      for (const m of feed.moves) {
        const to = { x: m.to[0], z: m.to[1] }, via = { x: m.via[0], z: m.via[1] };
        expect(via).toEqual(spireMiddle(me, to, BLOCKED));
        expect(spireHitsMove(bullets, tick + 1, me, via, to)).toBe(0);
        expect(m.horizon).toBe(brute.get(key(to)));
        expect(m.winning).toBe(fresh.winning(tick + 1, to));
        if (m.winning) expect(m.horizon).toBe(3);
        expect(m.court).toBe(inSpireCourt(to));
        expect(m.star).toBe(stars.has(key(to)) || stars.has(key(via)));
        expect(m.steps === 0).toBe(to.x === me.x && to.z === me.z);
      }
      expect(feed.moves.length).toBe(Math.min(DANGER_MAX_MOVES, brute.size));
      const listed = new Set(feed.moves.map((m) => m.to[1] * GRID_SIZE + m.to[0]));
      if (brute.size <= DANGER_MAX_MOVES) expect(listed).toEqual(new Set(brute.keys()));
      else {
        // Every destination left out ranks no higher than the last one listed.
        const last = rank(feed.moves[feed.moves.length - 1]);
        for (const mv of movesWithin(me, spireOk)) {
          const k = key(mv.end);
          if (!brute.has(k) || listed.has(k)) continue;
          const r = [+(stars.has(k) || stars.has(key(mv.mid))), +fresh.winning(tick + 1, mv.end), brute.get(k)!, +inSpireCourt(mv.end), -mv.steps];
          expect(cmpRank(last, r)).toBeLessThanOrEqual(0);
        }
      }
      expectSorted(feed.moves);
      // The plan replays hit-free through knownUntilTick when its first step is winning.
      if (feed.moves[0]?.winning) {
        let at = me;
        feed.path.forEach(([x, z], i) => {
          const to = { x, z };
          expect(chebyshev(at, to)).toBeLessThanOrEqual(2);
          expect(spireHitsMove(bullets, tick + 1 + i, at, spireMiddle(at, to, BLOCKED), to)).toBe(0);
          at = to;
        });
        expect(feed.path.length).toBe(Math.min(16, spireKnownUntil(fight) - tick));
      }
      checked += feed.moves.length;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('stars', () => {
  it('lists uncaught stars, flags star moves and sorts them first', () => {
    const run = activeRun({ partySize: 1 });
    const fight0 = freshFight({ starWave: 2, starMask: 0b001, curKind: 0, curStart: S + 16, curSeed: 1 });
    const T = S + 24; // wave 2
    const live = spireLiveStars(run, fight0, T + 1)!;
    const all = spireStars(fight0.seed, 2, 3);
    expect(live.stars.map((s) => s.j)).toEqual([1, 2]);
    expect(live.stars.map(({ x, z }) => ({ x, z }))).toEqual(all.slice(1));
    expect(live.lastTick).toBe(S + 35);
    // Stand one step from star 1.
    const star = all[1];
    const me = [{ x: star.x + 1, z: star.z }, { x: star.x - 1, z: star.z }, { x: star.x, z: star.z + 1 }].find(spireOk)!;
    const feed = buildDangerFeed(spireInput(T, me, fight0, {}, run));
    expect(feed.stars).toEqual(live.stars.map((s) => ({ x: s.x, z: s.z, ticksLeft: 11 })));
    expect(feed.moves[0].star).toBe(true);
    expect(feed.moves.filter((m) => m.star).every((m) => [m.to, m.via].some(([x, z]) => all.slice(1).some((s) => s.x === x && s.z === z)))).toBe(true);
    if (feed.moves.some((m) => m.to[0] === star.x && m.to[1] === star.z && m.winning)) expect(feed.path[0]).toEqual([star.x, star.z]);
    const r = star.z - SPIRE_FLOOR.z0, c = star.x - SPIRE_FLOOR.x0;
    expect(feed.map![r][c]).toBe('*');
    const caughtFirst = all[0];
    expect(feed.map![caughtFirst.z - SPIRE_FLOOR.z0][caughtFirst.x - SPIRE_FLOOR.x0]).not.toBe('*');
  });

  it('has no stars before the start or after the end', () => {
    const fight = freshFight();
    expect(spireLiveStars(activeRun(), fight, S - 1)).toBeNull();
    expect(spireLiveStars(activeRun(), fight, S + 601)).toBeNull();
    expect(spireLiveStars(activeRun({ stage: SpireStage.Cleared }), fight, S + 5)).toBeNull();
  });

  it('counts the timeout tick: the server still runs swings, stars and bullets on T = endTick', () => {
    const run = activeRun();
    const fight = freshFight();
    // Wave 50 lands on endTick (S + 600) and can be caught that tick only.
    const last = spireLiveStars(run, fight, S + 600)!;
    expect(last.wave).toBe(50);
    expect(last.lastTick).toBe(S + 600);
    expect(spireLiveStars(run, fight, S + 599)!.lastTick).toBe(S + 599);
    const me = SPIRE_SPAWNS[0];
    // One tick before: the wave still to come is announced.
    expect(buildDangerFeed(spireInput(S + 588, me, fight, {}, run)).nextStars).toEqual({ inTicks: 12 });
    // At endTick - 1 the feed covers tick endTick: its stars and hit-free moves, and no wave after it.
    const feed = buildDangerFeed(spireInput(S + 599, me, fight, {}, run));
    expect(feed.stars).toEqual(last.stars.map((t) => ({ x: t.x, z: t.z, ticksLeft: 1 })));
    expect(feed.nextStars).toBeUndefined();
    expect(feed.moves.length).toBeGreaterThan(0);
    expect(feed.best).not.toBeNull();
    // At endTick the run is over for the next tick: nothing to catch or dodge, and no stale "next wave in 1".
    const over = buildDangerFeed(spireInput(S + 600, me, fight, {}, run));
    expect([over.stars, over.nextStars, over.moves]).toEqual([[], undefined, []]);
  });
});

describe('size', () => {
  /** The densest shardstorm tick (most live bullets on the floor, prev Eclipse fading). */
  function densest(): { fight: SpireFightLike; tick: number } {
    let best = { fight: freshFight(), tick: 0, n: -1 };
    for (const seed of [0, 9, 21, 33, 47, 63]) {
      const fight = twoPatternFight(9, 10, S + 300, { x: 72, z: 66 }, seed);
      const b = spireFightBullets(fight);
      for (let tick = S + 300; tick < S + 330; tick++) {
        let n = 0;
        for (let i = 0; i < b.length / BULLET_STRIDE; i++) {
          const h = 2 * (tick - b[i * BULLET_STRIDE]);
          if (h >= 0 && h <= 36) n++;
        }
        if (n > best.n) best = { fight, tick, n };
      }
    }
    return best;
  }

  it('stays under 4 KB in the densest shardstorm tick for a 4-party', () => {
    const { fight, tick } = densest();
    const run = activeRun({ partySize: 4 });
    let biggest = 0;
    for (const me of [{ x: 73, z: 66 }, { x: 74, z: 59 }, { x: 80, z: 65 }, { x: 81, z: 58 }]) {
      const members = [0, 1, 2, 3].map((s) => memberIn(s, s === 0 ? me : SPIRE_SPAWNS[s], { name: 'W'.repeat(16), meals: 3 }));
      const feed = buildDangerFeed(spireInput(tick, me, { ...fight, phase: 4 }, {}, run, members));
      biggest = Math.max(biggest, dangerFeedBytes(feed));
      expect(dangerFeedBytes(feed)).toBeLessThanOrEqual(DANGER_FEED_MAX_BYTES);
      expect(feed.party).toHaveLength(3);
    }
    expect(biggest).toBeGreaterThan(1000);
  });

  it('truncates moves first, then the path, to stay within 4 KB', () => {
    const me = { x: 74, z: 66 };
    const fight = twoPatternFight(0, 2, S + 40, me);
    const run = activeRun({ partySize: 4 });
    const loose = buildDangerFeed(spireInput(S + 40, me, fight, {}, run, [0, 1, 2, 3].map((s) => memberIn(s, s === 0 ? me : SPIRE_SPAWNS[s]))));
    const pad = Math.ceil((DANGER_FEED_MAX_BYTES - dangerFeedBytes(loose)) / 3) + 20;
    const members = [0, 1, 2, 3].map((s) => memberIn(s, s === 0 ? me : SPIRE_SPAWNS[s], { name: 'é'.repeat(Math.ceil(pad / 2)) }));
    const feed = buildDangerFeed(spireInput(S + 40, me, fight, {}, run, members));
    expect(dangerFeedBytes(feed)).toBeLessThanOrEqual(DANGER_FEED_MAX_BYTES);
    expect(feed.moves.length).toBeLessThan(loose.moves.length);
    expect(feed.path).toEqual(loose.path);
  });
});

describe('spireSafetyCached', () => {
  it('builds once per rotation and evicts beyond 64 entries', () => {
    const f = twoPatternFight(0, 1, S + 16, { x: 72, z: 66 });
    const a = spireSafetyCached('7', f, 1, BLOCKED);
    expect(spireSafetyCached('7', { ...f, hp: 10, starMask: 3 }, 1, BLOCKED)).toBe(a);
    expect(spireSafetyCached('8', f, 1, BLOCKED)).not.toBe(a);
    expect(spireSafetyCached('7', f, 2, BLOCKED)).not.toBe(a);
    for (let i = 0; i < 64; i++) spireSafetyCached(`evict${i}`, f, 1, BLOCKED);
    expect(spireSafetyCached('7', f, 1, BLOCKED)).not.toBe(a);
    expect(a.from).toBe(S + 16 - 5);
  });
});

// ---- Clatterhorn -------------------------------------------------------------------------------------------------

const G = CLATTER_GLADE;
const STONES = new Set(CLATTER_STONES.map(key));
const gladeOk = (t: Tile) => t.x >= 0 && t.z >= 0 && t.x < GRID_SIZE && t.z < GRID_SIZE && !BLOCKED.has(key(t)) && !STONES.has(key(t))
  && ((t.x >= G.x0 && t.x <= G.x1 && t.z >= G.z0 && t.z <= G.z1) || (isLandTile(t) && !inSpireFloor(t)));
const cfg = { ...BOSS_CONFIG_DEFAULTS, clatterhornOpen: true };
const crow = (over: Partial<ClatterRowLike>): ClatterRowLike => ({
  ...freshClatterhorn(cfg), state: ClatterState.Idle, engagedTick: 900, lastHitTick: 900, fightCount: 3, ...over,
});
function clatterInput(tick: number, me: Tile, row: ClatterRowLike, identity = ME): DangerInput {
  return {
    tick, tickMs: 600, ageMs: 100, rulesVersion: SPIRE_RULES_VERSION,
    me: { identity, x: me.x, z: me.z, hp: 30, maxHp: 30, eatCooldownUntilTick: 0 }, blocked: BLOCKED, spire: null, clatter: row,
  };
}

function checkClatter(feed: DangerFeed, row: ClatterRowLike, tick: number, me: Tile) {
  expect(feed.where).toBe('clatterhorn');
  expect(feed.grid).toEqual({ x0: 76, z0: 98, w: 17, h: 17 });
  expect(feed.knownUntilTick).toBe(tick + 3);
  expect(feed.path).toEqual([]);
  for (let r = 0; r < 17; r++) for (let c = 0; c < 17; c++) {
    const t = { x: G.x0 + c, z: G.z0 + r };
    if (!gladeOk(t)) { expect(feed.map![r][c]).toBe('#'); continue; }
    const bits = [1, 2, 3].reduce((acc, k) => acc | (clatterHitsMove(row, tick + k, t, t, t) ? 1 << (k - 1) : 0), 0);
    expect(feed.map![r][c]).toBe(bits ? String(bits) : '.');
  }
  const brute = bruteMoves(new Int32Array(0), tick, me, gladeOk, (T, a, b, c) => clatterHitsMove(row, T, a, b, c));
  expect(feed.moves.length).toBe(Math.min(DANGER_MAX_MOVES, brute.size));
  if (brute.size <= DANGER_MAX_MOVES) expect(new Set(feed.moves.map((m) => m.to[1] * GRID_SIZE + m.to[0]))).toEqual(new Set(brute.keys()));
  for (const m of feed.moves) {
    const to = { x: m.to[0], z: m.to[1] }, via = { x: m.via[0], z: m.via[1] };
    expect(clatterHitsMove(row, tick + 1, me, via, to)).toBe(0);
    expect(m.horizon).toBe(brute.get(key(to)));
    expect(m.winning).toBe(m.horizon === 3);
    expect(m.star).toBe(false);
    expect(m.court).toBe(chebyshev(to, row) <= CLATTER_REACH);
  }
  expectSorted(feed.moves);
}

describe('clatterhorn feed', () => {
  it('only near an open beetle', () => {
    const row = crow({});
    expect(atClatterhorn({ x: 74, z: 98 })).toBe(true);
    expect(atClatterhorn({ x: 73, z: 98 })).toBe(false);
    expect(buildDangerFeed(clatterInput(1000, { x: 73, z: 100 }, row)).where).toBeNull();
    expect(buildDangerFeed(clatterInput(1000, { x: 84, z: 100 }, { ...row, state: ClatterState.Closed })).where).toBeNull();
    expect(buildDangerFeed(clatterInput(1000, { x: 84, z: 100 }, row)).where).toBe('clatterhorn');
  });

  it('charge windups: map, moves, telegraph and escape match brute force', () => {
    let cases = 0;
    for (const centre of [{ x: 84, z: 106 }, { x: 80, z: 101 }, { x: 88, z: 110 }, { x: 78, z: 106 }]) {
      if (!clatterValidCentre(centre)) continue;
      for (let dir = 0; dir < 8; dir++) {
        const lane = clatterLane(centre, dir);
        if (lane.len < 2) continue;
        for (const lead of [1, 2, 3]) {
          const tick = 1000;
          const row = crow({ ...centre, state: ClatterState.ChargeWindup, attack: ClatterAttack.Charge, dir, endX: lane.end.x, endZ: lane.end.z,
            endKind: lane.endKind, stateUntilTick: tick + lead, bait: identityKey32(ME) });
          const inLane = lane.tiles.map((k) => ({ x: k % GRID_SIZE, z: Math.floor(k / GRID_SIZE) }));
          for (const me of [inLane[0], inLane[Math.floor(inLane.length / 2)], { x: centre.x + 3, z: centre.z + 3 }]) {
            if (!gladeOk(me)) continue;
            const feed = buildDangerFeed(clatterInput(tick, me, row));
            checkClatter(feed, row, tick, me);
            const tel = clatterTelegraph(row)!;
            expect(feed.telegraph).toMatchObject({ attack: 'charge', landsInTicks: lead, damage: 14, bait: ME,
              end: ['skid', 'glance', 'flip'][lane.endKind - 1] });
            expect(feed.telegraph!.tiles).toEqual(tel.tiles.map((k) => [k % GRID_SIZE, Math.floor(k / GRID_SIZE)]));
            const inside = tel.tiles.includes(key(me));
            expect(feed.telegraph!.youAreInside).toBe(inside);
            if (inside) {
              expect(feed.telegraph!.escape.length).toBeGreaterThan(0);
              expect(feed.telegraph!.escape.length).toBeLessThanOrEqual(4);
              for (const [x, z] of feed.telegraph!.escape) {
                expect(tel.tiles.includes(z * GRID_SIZE + x)).toBe(false);
                expect(chebyshev(me, { x, z })).toBeLessThanOrEqual(2);
                expect(gladeOk({ x, z })).toBe(true);
              }
              // Nearest first (walking steps).
              const steps = new Map(movesWithin(me, gladeOk).map((m) => [key(m.end), m.steps]));
              const d = feed.telegraph!.escape.map(([x, z]) => steps.get(z * GRID_SIZE + x)!);
              expect([...d].sort()).toEqual(d);
            } else expect(feed.telegraph!.escape).toEqual([]);
            cases++;
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(40);
  });

  it('spin windup and the swarm', () => {
    const tick = 2000;
    const spin = crow({ x: 84, z: 106, state: ClatterState.SpinWindup, attack: ClatterAttack.Spin, stateUntilTick: tick + 2 });
    for (const me of [{ x: 86, z: 106 }, { x: 85, z: 107 }, { x: 87, z: 109 }]) {
      const feed = buildDangerFeed(clatterInput(tick, me, spin));
      checkClatter(feed, spin, tick, me);
      expect(feed.telegraph).toMatchObject({ attack: 'spin', end: null, bait: null, landsInTicks: 2, damage: 10 });
    }
    for (const side of [0, 1, 2, 3]) for (const free of [0, 1, 2]) {
      const windup = crow({ state: ClatterState.DrumWindup, attack: ClatterAttack.Drum, swarmSide: side, swarmFree: free, stateUntilTick: tick + 2 });
      const lines = clatterSwarmFreeLines(windup);
      const me = side % 2 === 0 ? { x: lines[0] + 1, z: 106 } : { x: 84, z: lines[0] + 1 };
      const feed = buildDangerFeed(clatterInput(tick, me, windup));
      checkClatter(feed, windup, tick, me);
      expect(feed.telegraph).toMatchObject({ attack: 'drum', landsInTicks: 3, damage: 5, youAreInside: true });
      for (const [x, z] of feed.telegraph!.escape) expect(lines).toContain(side % 2 === 0 ? x : z);
      for (const dt of [1, 3, 6]) {
        const drumming = { ...windup, state: ClatterState.Drumming, swarmTick: tick + 2, stateUntilTick: tick + 22 };
        checkClatter(buildDangerFeed(clatterInput(tick + 2 + dt, me, drumming)), drumming, tick + 2 + dt, me);
      }
    }
  });

  it('reports the bait as an id suffix for others', () => {
    expect(clatterBaitId(0, ME)).toBeNull();
    expect(clatterBaitId(identityKey32(ME), ME)).toBe(ME);
    expect(clatterBaitId(0xdeadbeef, ME)).toBe('deadbeef');
    expect(clatterBaitId(5, ME)).toBe('00000005');
  });

  it('the dead get the map but no moves', () => {
    const row = crow({ state: ClatterState.Flipped, endKind: ClatterEndKind.Flip, stateUntilTick: 1005 });
    const input = clatterInput(1000, { x: 84, z: 104 }, row);
    input.me.hp = 0;
    const feed = buildDangerFeed(input);
    expect(feed.map).toHaveLength(17);
    expect(feed).toMatchObject({ moves: [], best: null, telegraph: null });
  });
});

// ---- Lanternmaw ----------------------------------------------------------------------------------------------------

import {
  LANTERN_CELLS, LANTERN_DIVE_TICKS, LANTERN_MEALS, LANTERN_RULES_VERSION, LANTERN_SPAWNS, LANTERN_SPRINGS, LANTERN_STANDABLE,
  LANTERN_TIDE_TICKS, LanternStage, lanternAdvance, lanternEmptySlots, lanternFreshFight, lanternHazardMask, lanternInReach,
  lanternLocal, lanternMoves, lanternTile,
} from '../lanternmaw';
import { LANTERN_FLOOR } from '../bossZones';
import { lanternKnownUntil, lanternNextSwingTick, type LanternFightRowLike, type LanternRunLike } from '../bossDanger';

describe('lanternmaw feed', () => {
  const L = 2000; // fight start tick
  let lanternRunId = 7001n;
  const lanternRun = (over: Partial<LanternRunLike> = {}): LanternRunLike => ({
    id: lanternRunId++, stage: SpireStage.Active, outcome: 0, rules: LANTERN_RULES_VERSION, partySize: 1,
    createdTick: L - 40, startTick: L, endTick: L + 600, phase: 1, clearTicks: 0, ...over,
  });
  /** The row as the server holds it after tick `t`: the fresh fight advanced at the end of every tick L..t (memoized per seed). */
  const rowMemo = new Map<string, LanternFightRowLike[]>();
  function rowAfter(t: number, seed = 31337, party = 1): LanternFightRowLike {
    const targets = LANTERN_SPAWNS.slice(0, party);
    const k = `${seed}:${party}`;
    let rows = rowMemo.get(k);
    if (!rows) { rows = [{ ...lanternFreshFight(seed, party, L, targets), ...lanternEmptySlots() }]; rowMemo.set(k, rows); }
    // rows[n] = the row after tick L + n - 1 (rows[0]: before any advance).
    while (rows.length <= t - L + 1) {
      const T = L + rows.length - 1;
      rows.push({ ...lanternAdvance(rows[rows.length - 1], T, L, targets), ...lanternEmptySlots() });
    }
    return rows[Math.max(0, t - L + 1)];
  }
  const spawn = (slot: number) => lanternTile(LANTERN_SPAWNS[slot]);
  function lanternInput(tick: number, me: Tile, fight: LanternFightRowLike, run = lanternRun(), members?: DangerMemberInput[], over: Partial<DangerInput> = {}): DangerInput {
    return {
      tick, tickMs: 600, ageMs: 140, rulesVersion: SPIRE_RULES_VERSION,
      me: { identity: ME, x: me.x, z: me.z, hp: 30, maxHp: 30, eatCooldownUntilTick: 0 },
      blocked: BLOCKED, spire: null, clatter: null,
      lantern: { run, fight, members: members ?? [memberIn(0, me)], mySlot: 0 },
      ...over,
    };
  }
  /** Ticks where the row is in each stage, for a run long enough to hold two cycles. */
  function stageTicks(seed = 31337) {
    const found = new Map<number, number>();
    for (let t = L; t < L + 200; t++) { const s = rowAfter(t, seed).stage; if (!found.has(s)) found.set(s, t); }
    return found;
  }

  it('on the floor: every documented field', () => {
    const me = spawn(0);
    const fight = { ...rowAfter(L + 1), hitTick0: L + 1, dmg1: 24 };
    const run = lanternRun({ partySize: 2 });
    const feed = buildDangerFeed(lanternInput(L + 2, me, fight, run, [memberIn(0, me, { meals: 2 }), memberIn(1, spawn(1))]));
    expect(feed.where).toBe('lantern');
    expect(feed.rulesVersion).toBe(LANTERN_RULES_VERSION);
    expect(feed.rulesMismatch).toBe(false);
    expect(feed.you).toEqual({ x: me.x, z: me.z, hp: 30, maxHp: 30, state: 'in', immuneTicks: 1, eatReadyInTicks: 0, mealsLeft: LANTERN_MEALS - 2 });
    expect(feed.grid).toEqual({ x0: LANTERN_FLOOR.x0, z0: LANTERN_FLOOR.z0, w: 15, h: 15 });
    expect(feed.map).toHaveLength(15);
    for (const line of feed.map!) expect(line).toMatch(/^[.1-7#]{15}$/);
    expect(feed.map!.join('').split('#').length - 1).toBe(9);
    expect(feed.boss).toMatchObject({ name: 'Lanternmaw', hp: fight.hp, maxHp: fight.maxHp, phase: 1, phaseName: '', stage: 'den',
      enraged: false, enrageInTicks: 418, timeoutInTicks: 598 });
    expect(feed.boss!.pattern).toMatch(/^(lure_sweep|tail_lash|maw_bellow)$/);
    expect(feed.party).toEqual([{ id: hex(2), name: 'member1', x: spawn(1).x, z: spawn(1).z, hp: 30, state: 'in', dealt: 24, away: false }]);
    expect(feed.spring).toBeNull();
    expect(feed.swing).toEqual({ nextTick: L + 4, nextInTicks: 2, inReach: false, reach: { x: 63, z: 136, range: 2 } });
    expect(feed.knownUntilTick).toBe(lanternKnownUntil(fight, run.endTick));
    expect(feed.moves.length).toBeGreaterThan(0);
    expect(feed.best).toEqual({ to: feed.moves[0].to, via: feed.moves[0].via });
    expect(feed.path.length).toBeGreaterThan(0);
    expect(feed.telegraph).toBeNull();
    expect(JSON.stringify(feed)).not.toMatch(/stars|downed|practice/);
  });

  it('the map, moves, horizon and reach match lanternHazardMask and lanternMoves by brute force over two cycles', () => {
    const run = lanternRun({ startTick: L });
    let checked = 0, unsafeTiles = 0, flooded = 0;
    const tiles = [LANTERN_SPAWNS[0], LANTERN_SPAWNS[3], 2 * 15 + 7, 5 * 15 + 5, LANTERN_SPRINGS[0], LANTERN_SPRINGS[2], 7 * 15 + 1];
    for (let tick = L - 3; tick < L + 160; tick++) {
      const fight = rowAfter(Math.max(L - 1, tick));
      const masks = [1, 2, 3].map((k) => (tick + k >= L ? lanternHazardMask(fight, tick + k, L) : new Uint8Array(LANTERN_CELLS)));
      // The map: every standable tile's bits are exactly the three masks.
      const expected: string[] = [];
      for (let v = 0; v < 15; v++) {
        let line = '';
        for (let u = 0; u < 15; u++) {
          const i = v * 15 + u;
          if (!LANTERN_STANDABLE[i]) { line += '#'; continue; }
          const bits = (masks[0][i] ? 1 : 0) | (masks[1][i] ? 2 : 0) | (masks[2][i] ? 4 : 0);
          line += bits ? String(bits) : '.';
          if (bits) unsafeTiles++;
        }
        expected.push(line);
      }
      for (const local of tiles) {
        const me = lanternTile(local);
        const feed = buildDangerFeed(lanternInput(tick, me, fight, run));
        expect(feed.where).toBe('lantern');
        expect(feed.map).toEqual(expected);
        // Moves: exactly the unhurt end tiles of lanternMoves (truncated to 12), each with the brute-force horizon.
        const free = lanternMoves(local).filter((j) => !masks[0][j]);
        const listed = feed.moves.map((m) => lanternLocal({ x: m.to[0], z: m.to[1] }));
        expect(listed.length).toBe(Math.min(DANGER_MAX_MOVES, free.length));
        for (const m of feed.moves) {
          const j = lanternLocal({ x: m.to[0], z: m.to[1] });
          expect(free).toContain(j);
          const h3 = lanternMoves(j).some((a) => !masks[1][a] && lanternMoves(a).some((b) => !masks[2][b]));
          const h2 = lanternMoves(j).some((a) => !masks[1][a]);
          expect(m.horizon).toBe(h3 ? 3 : h2 ? 2 : 1);
          expect(m.court).toBe(lanternInReach(fight, tick + 1, j));
          expect(m.star).toBe(false);
          expect(Math.max(Math.abs(m.via[0] - me.x), Math.abs(m.via[1] - me.z))).toBeLessThanOrEqual(1);
          checked++;
        }
        if (fight.stage === LanternStage.Tide && tick + 1 >= fight.surfaceTick && tick + 1 < fight.surfaceTick + LANTERN_TIDE_TICKS) flooded++;
      }
    }
    expect(checked).toBeGreaterThan(5000);
    expect(unsafeTiles).toBeGreaterThan(300);
    expect(flooded).toBeGreaterThan(20);
  });

  it('the path is a chain of one-tick moves that stays unhurt from a winning start through the known window', () => {
    const run = lanternRun();
    let paths = 0;
    for (const seed of [1, 77, 4242, 90001]) for (let tick = L; tick < L + 120; tick += 3) {
      const fight = rowAfter(tick, seed);
      for (const local of [LANTERN_SPAWNS[0], 3 * 15 + 7, 7 * 15 + 3]) {
        const feed = buildDangerFeed(lanternInput(tick, lanternTile(local), fight, run));
        if (!feed.moves.some((m) => m.winning)) continue;
        let at = local;
        feed.path.forEach(([x, z], k) => {
          const j = lanternLocal({ x, z });
          expect(lanternMoves(at)).toContain(j);
          expect(lanternHazardMask(fight, tick + k + 1, L)[j]).toBe(0);
          at = j;
        });
        expect(feed.path.length).toBe(Math.min(16, feed.knownUntilTick! - tick));
        paths++;
      }
    }
    expect(paths).toBeGreaterThan(300);
  });

  it('from the dive: the spring tile and S; the capper walks onto it for S, the others keep off', () => {
    const dive = stageTicks().get(LanternStage.Dive)!;
    const fight = rowAfter(dive);
    expect(fight.stage).toBe(LanternStage.Dive);
    const S0 = fight.surfaceTick;
    expect(S0 - dive).toBe(LANTERN_DIVE_TICKS);
    const springTile = lanternTile(LANTERN_SPRINGS[fight.spring]);
    const run = lanternRun({ partySize: 2 });
    const me = spawn(0), mate = spawn(1);
    const asCapper = buildDangerFeed(lanternInput(dive, me, fight, run, [memberIn(0, me), memberIn(1, mate)]));
    expect(asCapper.spring).toEqual({ tile: { x: springTile.x, z: springTile.z }, x: springTile.x, z: springTile.z, surfaceTick: S0, surfacesInTicks: LANTERN_DIVE_TICKS, capped: false, chokedUntilTick: null, capper: true });
    expect(asCapper.boss!.stage).toBe('dive');
    expect(asCapper.boss!.pattern).toBeNull();
    expect(asCapper.swing!.reach).toBeNull();
    expect(asCapper.path[S0 - dive - 1]).toEqual([springTile.x, springTile.z]);
    // Slot 1 with slot 0 present is not the capper; alone it would be.
    const other = buildDangerFeed({ ...lanternInput(dive, mate, fight, run, [memberIn(0, me), memberIn(1, mate)]), lantern: { run, fight, members: [memberIn(0, me), memberIn(1, mate)], mySlot: 1 } });
    expect(other.spring!.capper).toBe(false);
    expect(other.path[S0 - dive - 1]).not.toEqual([springTile.x, springTile.z]);
    // Capped at S: choked through S + 8, and the tide reach is the spring.
    const tide = { ...rowAfter(S0), capped: true };
    const capped = buildDangerFeed(lanternInput(S0, springTile, tide, run));
    expect(capped.spring).toMatchObject({ capped: true, chokedUntilTick: S0 + 8, surfacesInTicks: 0 });
    expect(capped.swing!.reach).toEqual({ ...springTile, range: 2 });
    expect(capped.swing!.inReach).toBe(true);
    // The ebb hides the spring again.
    const ebb = rowAfter(S0 + LANTERN_TIDE_TICKS);
    expect(ebb.stage).toBe(LanternStage.Ebb);
    expect(buildDangerFeed(lanternInput(S0 + LANTERN_TIDE_TICKS, me, ebb, run)).spring).toBeNull();
  });

  it('swing cadence: slot s swings on (T - startTick) mod 4 == s', () => {
    for (let slot = 0; slot < 4; slot++) for (let from = L - 3; from < L + 12; from++) {
      const T = lanternNextSwingTick(L, from, slot);
      expect(T).toBeGreaterThanOrEqual(Math.max(from, L));
      expect((T - L) % 4).toBe(slot);
      expect(T - Math.max(from, L)).toBeLessThan(4);
    }
  });

  it('a rules mismatch omits map, moves and path; Out members and lobbies get no moves', () => {
    const me = spawn(0);
    const fight = rowAfter(L);
    const bad = buildDangerFeed(lanternInput(L + 1, me, fight, lanternRun({ rules: LANTERN_RULES_VERSION + 1 })));
    expect(bad).toMatchObject({ where: 'lantern', rulesMismatch: true, moves: [], best: null, path: [] });
    expect(bad.map).toBeUndefined();
    const exit = { x: 47, z: 153 };
    const out = buildDangerFeed(lanternInput(L + 1, exit, fight, lanternRun(), [memberIn(0, exit, { state: SpireMemberState.Out })]));
    expect(out).toMatchObject({ where: 'lantern', moves: [], best: null, path: [] });
    expect(out.you.state).toBe('out');
    const lobby = buildDangerFeed(lanternInput(L + 1, { x: 47, z: 150 }, fight, lanternRun({ stage: SpireStage.Lobby })));
    expect(lobby.where).toBeNull();
  });

  it('stays under 4 KB for a 4-party with long names in every stage', () => {
    const run = lanternRun({ partySize: 4 });
    let biggest = 0;
    for (let tick = L; tick < L + 120; tick++) {
      const fight = rowAfter(tick, 555, 4);
      const members = [0, 1, 2, 3].map((s) => memberIn(s, spawn(s), { name: 'W'.repeat(16), meals: 3 }));
      const feed = buildDangerFeed(lanternInput(tick, spawn(0), fight, run, members));
      biggest = Math.max(biggest, dangerFeedBytes(feed));
    }
    expect(biggest).toBeLessThanOrEqual(DANGER_FEED_MAX_BYTES);
    expect(biggest).toBeGreaterThan(1000);
  });
});
