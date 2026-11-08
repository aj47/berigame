import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homePoint, homeTarget, MEADOW_OFFSET } from '../../shared/sim/frontier/homeMap';
import { frontierSnapshot } from '../../shared/sim/frontier/snapshot';
import { newProfile } from '../../shared/sim/frontier/model';
import { describeDestination, describeGathering, describeObjective } from './statePresentation';

const identity = 'a'.repeat(64);
const now = 100_000;
const publicRow = (kind: string, value: unknown) => ({ kind, data: JSON.stringify(value) });
const config = publicRow('config', { enabled: true });
const state = () => frontierSnapshot([config], [], identity, now);

test('cross-district destinations decode into reusable region-local coordinates in both directions', () => {
  const outward = homeTarget(homePoint({ x: 31, z: 64 }, 'settlement'));
  // The tagged internal coordinate (1024 + joined-frame x; the tag sits above every home-frame x on the 256 map).
  assert.equal(outward.x, 1024 + MEADOW_OFFSET.x + 31);
  assert.deepEqual(describeDestination({ region: 'bramblewild', targetX: outward.x, targetZ: outward.z }),
    { region: 'settlement', x: 31, z: 64 });
  const inward = homeTarget(homePoint({ x: 46, z: 25 }, 'bramblewild'));
  assert.deepEqual(describeDestination({ region: 'settlement', targetX: inward.x, targetZ: inward.z }),
    { region: 'bramblewild', x: 46, z: 25 });
  assert.deepEqual(describeDestination({ region: 'reedwake', targetX: 20, targetZ: 40 }),
    { region: 'reedwake', x: 20, z: 40 });
  assert.equal(describeDestination({ region: 'settlement' }), null);
  assert.equal(describeDestination({ targetX: 2 }), null);
  assert.deepEqual(describeDestination({ targetX: 0, targetZ: 0 }), { region: 'bramblewild', x: 0, z: 0 });
});

test('a reserved resource remains visible through its deadline until server completion or cancellation', () => {
  const resource = { id: 'settlement-stone', region: 'settlement', x: 32, z: 56, item: 'stone',
    harvest: { by: identity, startedAt: now, completesAt: now + 3000, origin: { x: 31, z: 56 }, hp: 20, tool: 'hands', quantity: 1 } };
  const frontier = frontierSnapshot([config, publicRow('resource', resource)], [], identity, now);
  assert.deepEqual(describeGathering(frontier, identity, now + 1000), {
    resourceId: 'settlement-stone', itemId: 'stone', region: 'settlement', tile: { x: 32, z: 56 },
    tool: 'hands', quantity: 1, startedAt: now, completesAt: now + 3000, remainingMs: 2000,
  });
  assert.equal(describeGathering(frontier, identity, now + 4000)?.remainingMs, 0);
  assert.equal(describeGathering(frontier, 'another-player', now), null);
  assert.equal(describeGathering(state(), identity, now), null);
  assert.equal(describeGathering({ ...frontier, enabled: false }, identity, now), null);
});

test('the next objective follows the active region and advances after the steward reward', () => {
  const frontier = state();
  const goal = { id: 'find-stick' as const, text: 'Gather for a sturdy stick', hint: 'Pick berries', action: null };
  assert.deepEqual(describeObjective('bramblewild', goal, frontier), { source: 'first_day', region: 'bramblewild', ...goal });
  assert.equal(describeObjective('bramblewild', null, frontier), null);
  assert.equal(describeObjective('settlement', null, frontier)?.id, 'steward');
  const profile = newProfile(identity);
  profile.quests = ['steward'];
  profile.events['gather:timber'] = 2;
  const progress = frontierSnapshot([config], [publicRow('profile', profile)], identity, now);
  const next = describeObjective('settlement', null, progress);
  assert.ok(next?.source === 'frontier_quest');
  assert.equal(next.id, 'supplies');
  assert.equal(next.progress, 2);
  assert.equal(next.required, 6);
  assert.equal(next.coins, 15);
  assert.equal(describeObjective('settlement', null, { ...frontier, enabled: false }), null);
  assert.equal(describeObjective('cinder', null, { ...frontier, quests: [] }), null);
});

// ---- Bosses (FINAL_SPEC 8.2-8.5, CORE_SCOPE) ----------------------------------------------------------------------
import {
  BOSS_CONFIG_DEFAULTS, BossId, BossNoticeKind, BossEventKind, ClatterState, SPIRE_NONE, SPIRE_PATTERNS, SPIRE_RULES_VERSION, SpireMemberState, SpireStage,
  ClatterAttack, NODE_SEEDS, TREE_SEEDS, canonicalMiddle, clatterLane, freshClatterhorn, spireFightBullets, spireHitsMove,
  worldBlockedSet, type SpireFightLike,
} from '../../shared/sim';
import {
  ClatterContribution, bossError, crossesSpireFloor, dangerFeed, describeBossEvent, describeBossNotice, describeBosses, dodgeCheck,
  moveStepsOf, visiblePlayers, type BossFight, type BossMember, type BossPlayer, type BossRows, type BossRun,
} from './statePresentation';

const BLOCKED = worldBlockedSet([]);
/** The live world's blocked set: every seeded tree and node (what the gateway's tree table holds). */
const WORLD = worldBlockedSet([...TREE_SEEDS, ...NODE_SEEDS]);
const hexId = (i: number) => ({ toHexString: () => i.toString(16).padStart(64, '0') });
const person = (i: number, x: number, z: number, over: Partial<BossPlayer> = {}): BossPlayer =>
  ({ identity: hexId(i), name: `p${i}`, x, z, hp: 30, maxHp: 30, region: 'bramblewild', online: true, eatCooldownUntilTick: 0, ...over });
const run = (id: bigint, over: Partial<BossRun> = {}): BossRun => ({ id, leader: hexId(1), stage: SpireStage.Active, outcome: 0, mode: 0, isPublic: true,
  rules: SPIRE_RULES_VERSION, partySize: 2, createdTick: 900, queuedTick: 0, startTick: 1000, endTick: 1600, phase: 1, clearTicks: 0, ...over });
const member = (i: number, runId: bigint, slot: number, state: number = SpireMemberState.In): BossMember => ({ identity: hexId(i), runId, slot, state,
  joinedTick: 900, awaySinceTick: 0, awayCount: 0, downUntilTick: 0, reviveSinceTick: 0, meals: 1 });
function fightOf(runId: bigint, over: Partial<SpireFightLike> = {}): BossFight {
  return { runId, hp: 1700, maxHp: 1700, phase: 1, seed: 4242, patternCount: 1, curKind: SPIRE_NONE, curStart: 1005, curSeed: 0, curAimX: 0, curAimZ: 0,
    prevKind: SPIRE_NONE, prevStart: 0, prevSeed: 0, prevAimX: 0, prevAimZ: 0, starWave: 0, starMask: 0,
    hitTick0: 0, hitTick1: 0, hitTick2: 0, hitTick3: 0, hits0: 0, hits1: 0, hits2: 0, hits3: 0, stars0: 0, stars1: 0, stars2: 0, stars3: 0,
    dmg0: 0, dmg1: 0, dmg2: 0, dmg3: 0, downs0: 0, downs1: 0, downs2: 0, downs3: 0, ...over } as BossFight;
}
const rowsOf = (over: Partial<BossRows> = {}): BossRows => ({ config: { ...BOSS_CONFIG_DEFAULTS, clatterhornOpen: true, spireOpen: true },
  clatter: null, runs: [], members: [], fights: [], ...over });

test('boss refusals map to their error codes, first match wins, everything else stays generic', () => {
  const cases: [string, string | null][] = [
    ['This party is waiting for Ada: walk to the gate', 'party_not_ready'],
    ['This party is waiting for Rin: is on an expedition', 'party_not_ready'],
    ['The Sunken Spire is sealed', 'boss_closed'], ['SenderError: The glade is quiet: Clatterhorn is away', 'boss_closed'],
    ['This client is out of date; reload the page to enter the Spire', 'client_outdated'],
    ['This party is from an older Spire; open a new one', 'client_outdated'],
    ['Walk to the Sunken Spire gate (62,45) first', 'spire_gate'],
    ['You need a spire key (3 obsidian and 1 gleamshell)', 'spire_key'],
    ['You are already in a Spire party', 'spire_member'],
    ['You still belong to a party that is fighting (40 s left); leave it to give up its reward', 'spire_member'],
    ['You are waiting in a Spire party; leave it first', 'spire_member'],
    ['You are not in a Spire party', 'not_in_party'], ['You are not leading a Spire party', 'not_leader'],
    ['This party is full', 'party_full'], ['This party is gone', 'party_gone'], ['This party has already gone down', 'party_gone'],
    ['No open Spire party is waiting; open one instead', 'no_open_party'],
    ['The Spire gate is crowded; join an open party instead', 'spire_busy'],
    ['The Sunken Spire is full right now. Try again in a minute', 'spire_full'],
    ['No fighting inside the Sunken Spire', 'no_pvp_zone'], ["No fighting in Clatterhorn's Glade", 'no_pvp_zone'],
    ['No fighting at the Spire gate', 'no_pvp_zone'],
    ['You cannot trade inside the Sunken Spire', 'spire_inside'], ['You cannot follow players into or out of the Sunken Spire', 'spire_inside'],
    ['You have eaten your fill in the Spire (6/6)', 'meal_limit'],
    ['The beetle has burrowed away. Clatterhorn returns in 12 s', 'clatterhorn_burrowed'],
    ['You are on an expedition; finish or leave it first', 'on_expedition'],
    ['You cannot enter the Spire during a duel', 'in_duel'],
    ['Put down the giant berry first; it needs both hands', null], ['No fighting in the safe ring', null], ['target out of bounds', null],
  ];
  for (const [message, code] of cases) assert.equal(bossError(new Error(message))?.code ?? null, code, message);
  assert.deepEqual(bossError(new Error('SenderError: The Sunken Spire is sealed')), { status: 422, code: 'boss_closed', message: 'The Sunken Spire is sealed' });
});

test('dodge: at most 2 tiles, only on the floor or at the glade, to a standable tile, never into other rules', () => {
  const floorMe = person(1, 74, 60);
  const err = (r: ReturnType<typeof dodgeCheck>) => ('problem' in r ? r.problem.code : null);
  assert.equal(err(dodgeCheck(rowsOf(), floorMe, { x: 77, z: 60 }, 1010, BLOCKED)), 'dodge_too_far');
  assert.equal(err(dodgeCheck(rowsOf(), person(1, 30, 30), { x: 31, z: 30 }, 1010, BLOCKED)), 'dodge_unavailable');
  assert.equal(err(dodgeCheck(rowsOf(), person(1, 74, 60, { region: 'settlement' }), { x: 75, z: 60 }, 1010, BLOCKED)), 'dodge_unavailable');
  assert.equal(err(dodgeCheck(rowsOf(), floorMe, { x: 76, z: 61 }, 1010, BLOCKED)), 'dodge_target'); // the dais
  assert.equal(err(dodgeCheck(rowsOf(), person(1, 70, 60), { x: 69, z: 60 }, 1010, BLOCKED)), 'dodge_target'); // off the floor
  assert.equal(err(dodgeCheck(rowsOf(), person(1, 80, 101), { x: 81, z: 100 }, 1010, BLOCKED)), 'dodge_target'); // a standing stone
  const outdated = rowsOf({ runs: [run(7n, { rules: SPIRE_RULES_VERSION + 1 })], members: [member(1, 7n, 0)] });
  const mismatch = dodgeCheck(outdated, floorMe, { x: 75, z: 60 }, 1010, BLOCKED);
  assert.ok('problem' in mismatch && mismatch.problem.status === 409 && mismatch.problem.code === 'rules_mismatch');
  // No hazard source: safe is null; via is the canonical middle tile.
  assert.deepEqual(dodgeCheck(rowsOf(), floorMe, { x: 76, z: 58 }, 1010, BLOCKED),
    { resolvesAtTick: 1011, via: [canonicalMiddle(floorMe, { x: 76, z: 58 }, BLOCKED).x, canonicalMiddle(floorMe, { x: 76, z: 58 }, BLOCKED).z], to: [76, 58], safe: null });
  const glade = dodgeCheck(rowsOf({ clatter: { ...freshClatterhorn(BOSS_CONFIG_DEFAULTS), state: ClatterState.Idle } }), person(1, 84, 102), { x: 85, z: 101 }, 50, BLOCKED);
  assert.ok(!('problem' in glade) && glade.safe === true);
});

test('dodge refuses a 2-tile target that takes more than one tick around a stone or the dais', () => {
  const clatter = { ...freshClatterhorn(BOSS_CONFIG_DEFAULTS), state: ClatterState.Idle };
  const err = (r: ReturnType<typeof dodgeCheck>) => ('problem' in r ? r.problem.code : null);
  // (78,103) is a standing stone: (79,103) is 4 steps from (77,103) without cutting its corners.
  assert.equal(err(dodgeCheck(rowsOf({ clatter }), person(1, 77, 103), { x: 79, z: 103 }, 50, WORLD)), 'dodge_target');
  // The dais (76..78, 61..63): (77,60) is 4 steps from (75,62).
  assert.equal(err(dodgeCheck(rowsOf(), person(1, 75, 62), { x: 77, z: 60 }, 1010, WORLD)), 'dodge_target');
  // Every accepted dodge is one tick's move: its via is a free tile next to both ends.
  let accepted = 0;
  for (const [me, rows] of [[person(1, 77, 103), rowsOf({ clatter })], [person(1, 75, 62), rowsOf()]] as const) {
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const to = { x: me.x + dx, z: me.z + dz };
      const r = dodgeCheck(rows, me, to, 50, WORLD);
      if ('problem' in r) continue;
      const via = { x: r.via[0], z: r.via[1] };
      assert.ok(Math.max(Math.abs(via.x - me.x), Math.abs(via.z - me.z)) <= 1 && Math.max(Math.abs(via.x - to.x), Math.abs(via.z - to.z)) <= 1, `${to.x},${to.z}`);
      assert.ok(!WORLD.has(via.z * 128 + via.x));
      accepted++;
    }
  }
  assert.ok(accepted > 20);
});

test('carrying the giant berry: one tile per tick for dodge, /danger moves and escapes', () => {
  const me = hexId(1).toHexString();
  assert.equal(moveStepsOf(me, []), 2);
  assert.equal(moveStepsOf(me, [{ stage: 'hauling', carrier: hexId(1) }]), 1);
  assert.equal(moveStepsOf(me, [{ stage: 'hauling', carrier: hexId(2) }, { stage: 'gathering', carrier: hexId(1) }]), 2);
  const idle = rowsOf({ clatter: { ...freshClatterhorn(BOSS_CONFIG_DEFAULTS), state: ClatterState.Idle } });
  const at = person(1, 84, 102);
  const two = dodgeCheck(idle, at, { x: 86, z: 102 }, 50, WORLD, 1);
  assert.ok('problem' in two && two.problem.code === 'dodge_too_far' && /1 tile/.test(two.problem.message));
  assert.ok(!('problem' in dodgeCheck(idle, at, { x: 85, z: 102 }, 50, WORLD, 1)));
  assert.ok(!('problem' in dodgeCheck(idle, at, { x: 86, z: 102 }, 50, WORLD)));
  // A charge telegraphed through the carrier: every move, best and escape is at most one step.
  const lane = clatterLane({ x: 84, z: 106 }, 4);
  const charge = rowsOf({ clatter: { ...freshClatterhorn(BOSS_CONFIG_DEFAULTS), x: 84, z: 106, state: ClatterState.ChargeWindup, attack: ClatterAttack.Charge,
    dir: 4, endX: lane.end.x, endZ: lane.end.z, endKind: lane.endKind, stateUntilTick: 51, engagedTick: 40, lastHitTick: 40 } });
  const carrier = { players: [at], blocked: WORLD, ageMs: 0, tickMs: 600, maxSteps: 1 as const };
  // On the lane's centre line only 2-step moves clear it: a walker gets them, a carrier is told nothing is safe.
  const free = dangerFeed(charge, at, 50, { ...carrier, maxSteps: 2 });
  assert.ok(free.moves.length > 0 && free.moves.every((m) => m.steps === 2) && free.telegraph!.escape.length > 0);
  const feed = dangerFeed(charge, at, 50, carrier);
  assert.equal(feed.where, 'clatterhorn');
  assert.deepEqual([feed.moves, feed.best, feed.telegraph!.escape], [[], null, []]);
  // On its edge a carrier steps out with one tile.
  const edge = dangerFeed(charge, person(1, 85, 102), 50, carrier);
  assert.ok(edge.moves.length > 0 && edge.moves.every((m) => m.steps <= 1) && edge.telegraph!.escape.length > 0);
  for (let x = 80; x <= 88; x++) for (let z = 98; z <= 112; z++) {
    const f = dangerFeed(charge, person(1, x, z), 50, carrier);
    for (const [ex, ez] of f.telegraph?.escape ?? []) assert.ok(Math.max(Math.abs(ex - x), Math.abs(ez - z)) <= 1, `${x},${z} -> ${ex},${ez}`);
    const s = describeBosses(charge, person(1, x, z), 50, { players: [], keysHeld: 0, contribution: null, blocked: WORLD, maxSteps: 1 }) as any;
    assert.deepEqual(s.clatterhorn.telegraph?.escape ?? [], f.telegraph?.escape ?? []);
  }
});

test('state.clatterhorn telegraph.escape matches /danger and never lists a tree or node tile', () => {
  let compared = 0;
  for (const [patch, players] of [
    [{ state: ClatterState.DrumWindup, stateUntilTick: 53, swarmSide: 0, swarmFree: 0 }, [[92, 110], [83, 114], [86, 114], [76, 101], [76, 111]]],
    [{ state: ClatterState.SpinWindup, stateUntilTick: 52, x: 84, z: 112, attack: ClatterAttack.Spin }, [[82, 114], [86, 114], [83, 110]]],
  ] as const) {
    const rows = rowsOf({ clatter: { ...freshClatterhorn(BOSS_CONFIG_DEFAULTS), engagedTick: 40, lastHitTick: 40, ...patch } });
    for (const [x, z] of players) {
      const me = person(1, x, z);
      const state = (describeBosses(rows, me, 50, { players: [me], keysHeld: 0, contribution: null, blocked: WORLD }) as any).clatterhorn;
      const feed = dangerFeed(rows, me, 50, { players: [me], blocked: WORLD, ageMs: 0, tickMs: 600 });
      assert.ok(state.telegraph, `${x},${z}`);
      assert.deepEqual(state.telegraph.escape, feed.telegraph?.escape);
      for (const [ex, ez] of state.telegraph.escape) assert.ok(!WORLD.has(ez * 128 + ex), `escape ${ex},${ez} is blocked`);
      compared++;
    }
  }
  assert.equal(compared, 8);
});

test('dodge safety equals the server rule in tick + 1 inside an active run', () => {
  const runId = 9101n;
  const fight = fightOf(runId, { curKind: 0, curStart: 1005, curSeed: 3, phase: SPIRE_PATTERNS[0].phase });
  const bullets = spireFightBullets(fight);
  const rows = rowsOf({ runs: [run(runId)], members: [member(1, runId, 0)], fights: [fight] });
  let unsafe = 0, checked = 0;
  for (let tick = 1004; tick < 1020; tick++) for (const me of [person(1, 74, 60), person(1, 77, 66), person(1, 80, 58)]) {
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const to = { x: me.x + dx, z: me.z + dz };
      const r = dodgeCheck(rows, me, to, tick, BLOCKED);
      if ('problem' in r) continue;
      const via = { x: r.via[0], z: r.via[1] };
      assert.equal(r.safe, spireHitsMove(bullets, tick + 1, me, via, to) === 0);
      checked++; if (!r.safe) unsafe++;
    }
  }
  assert.ok(checked > 500 && unsafe > 0);
});

test('floor players are invisible from outside; inside you see only your own run', () => {
  const runId = 77n, other = 78n;
  const rows = rowsOf({ runs: [run(runId), run(other)], members: [member(1, runId, 0), member(2, runId, 1), member(3, other, 0)] });
  const players = [person(1, 74, 60), person(2, 75, 61), person(3, 80, 66), person(4, 30, 30), person(5, 74, 60, { region: 'settlement' })];
  const ids = (list: BossPlayer[]) => list.map((p) => p.name);
  assert.deepEqual(ids(visiblePlayers(person(4, 30, 30), players, rows)), ['p4', 'p5']);
  assert.deepEqual(ids(visiblePlayers(players[0], players, rows)), ['p1', 'p2', 'p5']);
  assert.deepEqual(ids(visiblePlayers(players[2], players, rows)), ['p3', 'p5']);
  assert.equal(crossesSpireFloor(person(4, 30, 30), { x: 74, z: 60 }), true);
  assert.equal(crossesSpireFloor(players[0], { x: 30, z: 30 }), true);
  assert.equal(crossesSpireFloor(players[0], { x: 75, z: 66 }), false);
  assert.equal(crossesSpireFloor(person(5, 30, 30, { region: 'settlement' }), { x: 74, z: 60 }), false);
});

test('state.clatterhorn and state.spire come from the shared presenters, null outside Bramblewild', () => {
  const runId = 88n;
  const fight = fightOf(runId);
  const rows = rowsOf({ clatter: { ...freshClatterhorn(BOSS_CONFIG_DEFAULTS), state: ClatterState.Dormant },
    runs: [run(runId), run(89n, { stage: SpireStage.Lobby, endTick: 1100 })], members: [member(1, runId, 0), member(2, runId, 1), member(3, 89n, 0, SpireMemberState.Lobby)], fights: [fight] });
  const me = person(1, 74, 60);
  const players = [me, person(2, 75, 61, { region: 'settlement' }), person(3, 62, 46)];
  const blocks = describeBosses(rows, me, 1010, { players, keysHeld: 2, contribution: 20, blocked: WORLD }) as any;
  // Run ids are u64 BigInts in the rows: a leak would blank /state or /danger for the whole party.
  assert.doesNotThrow(() => JSON.stringify(blocks));
  assert.doesNotThrow(() => JSON.stringify(dangerFeed(rows, me, 1010, { players, blocked: WORLD, ageMs: 0, tickMs: 600 })));
  assert.equal(blocks.clatterhorn.state, 'dormant');
  assert.deepEqual(blocks.clatterhorn.you.contribution, 20);
  assert.equal(blocks.spire.key.held, 2);
  assert.deepEqual(blocks.spire.capacity, { active: 1, max: BOSS_CONFIG_DEFAULTS.spireMaxRuns, lobbies: 1, inside: 1 });
  assert.equal(blocks.spire.lobbies[0].runId, '89');
  assert.equal(blocks.spire.run.runId, '88');
  assert.equal(blocks.spire.run.members[1].tile, null);
  assert.deepEqual(describeBosses(rows, person(1, 74, 60, { region: 'settlement' }), 1010, { players, keysHeld: 0, contribution: null, blocked: WORLD }), { clatterhorn: null, spire: null, lantern: null });
});

test('the danger feed: where follows the reader, other regions read null', () => {
  const runId = 9201n;
  const fight = fightOf(runId, { curKind: 0, curStart: 1005, curSeed: 3, phase: 1 });
  const rows = rowsOf({ clatter: { ...freshClatterhorn(BOSS_CONFIG_DEFAULTS), state: ClatterState.Idle }, runs: [run(runId)], members: [member(1, runId, 0), member(2, runId, 1)], fights: [fight] });
  const opts = (players: BossPlayer[]) => ({ players, blocked: BLOCKED, ageMs: 140.4, tickMs: 600 });
  const me = person(1, 74, 60);
  const feed = dangerFeed(rows, me, 1008, opts([me, person(2, 80, 66)]));
  assert.equal(feed.where, 'spire');
  assert.equal(feed.ageMs, 140);
  assert.equal(feed.sendWithinMs, 340);
  assert.equal(feed.party?.[0].name, 'p2');
  assert.ok(feed.moves.length > 0 && feed.map?.length === 15);
  assert.equal(dangerFeed(rows, person(1, 74, 60, { region: 'settlement' }), 1008, opts([])).where, null);
  const glade = dangerFeed(rowsOf({ clatter: rows.clatter }), person(5, 84, 102), 1008, opts([]));
  assert.equal(glade.where, 'clatterhorn');
  assert.equal(dangerFeed(rowsOf({ clatter: rows.clatter }), person(5, 30, 30), 1008, opts([])).where, null);
});

test('boss notices, world news and the Clatterhorn contribution', () => {
  const note = { tick: 5, boss: BossId.Clatterhorn, kind: BossNoticeKind.YouHit, runId: 0n, amount: 6, total: 18, hp: 0, half: 0, quantity: 0, itemId: '' };
  assert.deepEqual(describeBossNotice(note), { source: 'boss', tick: 5, boss: 'clatterhorn', kind: 'you_hit', runId: null, amount: 6, total: 18, hp: 0, quantity: 0,
    text: 'You hit Clatterhorn for 6 (total 18)' });
  assert.equal(describeBossNotice({ ...note, kind: BossNoticeKind.Reward, itemId: 'gleamshell', quantity: 2 }).text, 'Reward: 2 Gleamshell');
  assert.deepEqual(describeBossEvent({ tick: 9, boss: BossId.Spire, kind: BossEventKind.SpireClear, runId: 41n, x: 0, z: 0, quantity: 2, value: 300, text: 'Ada, Rin' }),
    { tick: 9, boss: 'spire', kind: 'spire_clear', runId: '41', x: 0, z: 0, quantity: 2, value: 300, text: 'Ada, Rin' });
  const c = new ClatterContribution();
  const row = { ...freshClatterhorn(BOSS_CONFIG_DEFAULTS), engagedTick: 5 };
  assert.equal(c.read(row), null);
  c.record(note);
  c.record({ ...note, boss: BossId.Spire, total: 99 });
  assert.equal(c.read(row), 18);
  assert.equal(c.read({ ...row, engagedTick: 6 }), null); // the beetle woke again: a new fight
  assert.equal(c.read(null), null);
});

// ---- Lanternmaw (BOSSES.md section 9) ------------------------------------------------------------------------------
import {
  HurtSource, LANTERN_CONFIG_DEFAULTS, LANTERN_RULES_VERSION, LANTERN_SPAWNS, LANTERN_SPRINGS, LanternStage, lanternAdvance, lanternEmptySlots,
  lanternFreshFight, lanternHazardMask, lanternLocal, lanternTile, emptySlots,
} from '../../shared/sim';
import { crossesLanternFloor, type LanternBossFight, type LanternBossMember, type LanternBossRun } from './statePresentation';

const LS = 3000;
const lrun = (id: bigint, over: Partial<LanternBossRun> = {}): LanternBossRun => ({ id, leader: hexId(1), stage: SpireStage.Active, outcome: 0,
  rules: LANTERN_RULES_VERSION, partySize: 2, createdTick: LS - 40, startTick: LS, endTick: LS + 600, phase: 1, clearTicks: 0, ...over });
const lmember = (i: number, runId: bigint, slot: number, state: number = SpireMemberState.In): LanternBossMember => ({ identity: hexId(i), runId, slot, state,
  joinedTick: LS - 40, awaySinceTick: 0, awayCount: 0, meals: 1 });
function lfight(runId: bigint, after: number): LanternBossFight {
  let f = lanternFreshFight(4242, 2, LS, LANTERN_SPAWNS.slice(0, 2));
  for (let T = LS; T <= after; T++) f = lanternAdvance(f, T, LS, LANTERN_SPAWNS.slice(0, 2));
  return { runId, ...f, ...lanternEmptySlots() };
}
const lrows = (over: Partial<BossRows> = {}) => rowsOf({ lanternConfig: { ...LANTERN_CONFIG_DEFAULTS, lanternOpen: true }, ...over });
const onFloor = (i: number, local: number, over: Partial<BossPlayer> = {}) => { const t = lanternTile(local); return person(i, t.x, t.z, over); };

test('Lanternmaw refusals map to their codes; the lantern action reads its own entry and membership refusals', () => {
  const cases: [string, string | null][] = [
    ['The Drowned Hollow is sealed', 'boss_closed'],
    ['This client is out of date; reload the page to enter the Drowned Hollow', 'client_outdated'],
    ['This party is from an older Drowned Hollow; open a new one', 'client_outdated'],
    ['Walk to the Fen Gate (47,152) first', 'lantern_gate'],
    ['You are already in a Lanternmaw party', 'lantern_member'], ['You are waiting in a Lanternmaw party; leave it first', 'lantern_member'],
    ['You are in a Lanternmaw party; leave it first', 'lantern_member'], ['You are in a Spire party; leave it first', 'spire_member'],
    ['You are not in a Lanternmaw party', 'not_in_party'], ['You are not leading a Lanternmaw party', 'not_leader'],
    ['No open Lanternmaw party is waiting; open one instead', 'no_open_party'],
    ['The Fen Gate is crowded; join an open party instead', 'lantern_busy'],
    ['The Drowned Hollow is full right now. Try again in a minute', 'lantern_full'],
    ['No fighting inside the Drowned Hollow', 'no_pvp_zone'],
    ['You cannot trade inside the Drowned Hollow', 'lantern_inside'], ['You cannot follow players into or out of the Drowned Hollow', 'lantern_inside'],
    ['You have eaten your fill in the Drowned Hollow (6/6)', 'meal_limit'],
    ['You cannot enter the Drowned Hollow during a duel', 'in_duel'],
    // Entry problems are Lanternmaw's only: other actions keep them generic.
    ['You need 5 coins', null], ['You need a Fen Bait', null],
  ];
  for (const [message, code] of cases) assert.equal(bossError(new Error(message))?.code ?? null, code, message);
  const lantern: [string, string][] = [
    ['Bring a weapon to the Drowned Hollow: a stone club or better', 'lantern_weapon'], ['You need a Fen Bait', 'lantern_bait'],
    ['You need 5 coins', 'lantern_fee'], ['This party is waiting for Ada: You need a Fen Bait', 'party_not_ready'],
    ['You still belong to a party that is fighting (40 s left); leave it to give up its reward', 'lantern_member'],
    ['The Drowned Hollow is sealed', 'boss_closed'],
  ];
  for (const [message, code] of lantern) assert.equal(bossError(new Error(message), 'lantern')?.code, code, message);
  assert.equal(bossError(new Error('You still belong to a party that is fighting (40 s left); leave it to give up its reward'), 'spire')?.code, 'spire_member');
});

test('state.lantern comes from the shared presenter: entry, lobbies and your run; null outside Bramblewild', () => {
  const runId = 61n;
  const rows = lrows({ lanternRuns: [lrun(runId), lrun(62n, { stage: SpireStage.Lobby, endTick: LS + 100, partySize: 1, leader: hexId(3) })],
    lanternMembers: [lmember(1, runId, 0), lmember(2, runId, 1), lmember(3, 62n, 0, SpireMemberState.Lobby)], lanternFights: [lfight(runId, LS + 1)] });
  const me = onFloor(1, LANTERN_SPAWNS[0]);
  const players = [me, onFloor(2, LANTERN_SPAWNS[1]), person(3, 47, 151)];
  const slots = emptySlots();
  slots[0] = { itemId: 'stone_club', quantity: 1 };
  const blocks = describeBosses(rows, me, LS + 2, { players, keysHeld: 0, contribution: null, blocked: WORLD, entry: { slots, coins: 3, wielded: '' } }) as any;
  assert.doesNotThrow(() => JSON.stringify(blocks));
  assert.equal(blocks.lantern.open, true);
  assert.deepEqual(blocks.lantern.gate, { x: 47, z: 152 });
  assert.equal(blocks.lantern.entry.problem, 'You need a Fen Bait');
  assert.deepEqual(blocks.lantern.capacity, { active: 1, max: 12, lobbies: 1, inside: 2 });
  assert.deepEqual(blocks.lantern.lobbies, []); // inside a started run
  assert.equal(blocks.lantern.run.runId, '61');
  assert.equal(blocks.lantern.run.fightStage, 'den');
  assert.equal(blocks.lantern.run.you.mealsLeft, 3);
  assert.equal(blocks.lantern.run.members[1].name, 'p2');
  const atGate = describeBosses(rows, players[2], LS + 2, { players, keysHeld: 0, contribution: null, blocked: WORLD }) as any;
  assert.equal(atGate.lantern.atGate, true);
  assert.equal(atGate.lantern.lobbies[0].runId, '62');
  assert.equal(atGate.lantern.you.stage, 'lobby');
  assert.equal(atGate.lantern.entry.ready, null);
  // No lantern rows at all (an older module): closed, empty.
  assert.equal((describeBosses(rowsOf(), players[2], LS, { players, keysHeld: 0, contribution: null, blocked: WORLD }) as any).lantern.open, false);
  assert.deepEqual(describeBosses(rows, onFloor(1, LANTERN_SPAWNS[0], { region: 'settlement' }), LS, { players, keysHeld: 0, contribution: null, blocked: WORLD }),
    { clatterhorn: null, spire: null, lantern: null });
});

test('the danger feed reads lantern in the Drowned Hollow, with the spring from the dive on', () => {
  const runId = 63n;
  let dive = LS;
  while (lfight(runId, dive).stage !== LanternStage.Dive) dive++;
  const fight = lfight(runId, dive);
  const rows = lrows({ lanternRuns: [lrun(runId)], lanternMembers: [lmember(1, runId, 0), lmember(2, runId, 1)], lanternFights: [fight] });
  const me = onFloor(1, LANTERN_SPAWNS[0]);
  const feed = dangerFeed(rows, me, dive, { players: [me, onFloor(2, LANTERN_SPAWNS[1])], blocked: WORLD, ageMs: 0, tickMs: 600 });
  assert.equal(feed.where, 'lantern');
  assert.equal(feed.rulesVersion, LANTERN_RULES_VERSION);
  assert.equal(feed.map?.length, 15);
  assert.equal(feed.boss?.stage, 'dive');
  const spring = lanternTile(LANTERN_SPRINGS[fight.spring]);
  assert.deepEqual([feed.spring?.x, feed.spring?.z, feed.spring?.surfaceTick, feed.spring?.capper], [spring.x, spring.z, fight.surfaceTick, true]);
  assert.equal(feed.party?.[0].name, 'p2');
  assert.ok(feed.moves.length > 0 && feed.path.length > 0);
  assert.doesNotThrow(() => JSON.stringify(feed));
  // Elsewhere in a started run the feed still reads lantern (no moves off the floor).
  const away = dangerFeed(rows, person(1, 47, 153), dive, { players: [], blocked: WORLD, ageMs: 0, tickMs: 600 });
  assert.equal(away.where, 'lantern');
  assert.deepEqual(away.moves, []);
  assert.equal(dangerFeed(rows, person(1, 47, 153, { region: 'settlement' }), dive, { players: [], blocked: WORLD, ageMs: 0, tickMs: 600 }).where, null);
});

test('dodge in the Drowned Hollow: standable floor tiles only, never into other rules, safe is the server rule in tick + 1', () => {
  const runId = 64n;
  const err = (r: ReturnType<typeof dodgeCheck>) => ('problem' in r ? r.problem.code : null);
  const me = onFloor(1, LANTERN_SPAWNS[0]);
  assert.equal(err(dodgeCheck(lrows(), onFloor(1, 7 * 15 + 5), { x: 62, z: 136 }, LS, WORLD)), 'dodge_target'); // the maw
  assert.equal(err(dodgeCheck(lrows(), onFloor(1, 7 * 15), { x: 55, z: 136 }, LS, WORLD)), 'dodge_target'); // off the floor
  assert.equal(err(dodgeCheck(lrows(), me, { x: me.x + 3, z: me.z }, LS, WORLD)), 'dodge_too_far');
  const outdated = lrows({ lanternRuns: [lrun(runId, { rules: LANTERN_RULES_VERSION + 1 })], lanternMembers: [lmember(1, runId, 0)] });
  const mismatch = dodgeCheck(outdated, me, { x: me.x + 1, z: me.z }, LS, WORLD);
  assert.ok('problem' in mismatch && mismatch.problem.status === 409 && mismatch.problem.code === 'rules_mismatch');
  assert.deepEqual((dodgeCheck(lrows(), me, { x: me.x, z: me.z - 1 }, LS, WORLD) as any).safe, null); // no run: nothing threatens
  let checked = 0, unsafe = 0;
  for (let tick = LS; tick < LS + 80; tick++) {
    const fight = lfight(runId, tick);
    const rows = lrows({ lanternRuns: [lrun(runId)], lanternMembers: [lmember(1, runId, 0)], lanternFights: [fight] });
    for (const local of [LANTERN_SPAWNS[0], 2 * 15 + 7, 5 * 15 + 5]) {
      const from = onFloor(1, local);
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        const to = { x: from.x + dx, z: from.z + dz };
        const r = dodgeCheck(rows, from, to, tick, WORLD);
        if ('problem' in r) continue;
        assert.equal(r.safe, lanternHazardMask(fight, tick + 1, LS)[lanternLocal(to)] === 0);
        checked++; if (!r.safe) unsafe++;
      }
    }
  }
  assert.ok(checked > 3000 && unsafe > 100, `${checked} ${unsafe}`);
});

test('Drowned Hollow players are invisible from outside and from the Spire; inside you see only your own run', () => {
  const rows = lrows({ lanternRuns: [lrun(71n), lrun(72n)], lanternMembers: [lmember(1, 71n, 0), lmember(2, 71n, 1), lmember(3, 72n, 0)],
    runs: [run(73n)], members: [member(4, 73n, 0)] });
  const players = [onFloor(1, LANTERN_SPAWNS[0]), onFloor(2, LANTERN_SPAWNS[1]), onFloor(3, LANTERN_SPAWNS[2]), person(4, 74, 60), person(5, 30, 30)];
  const ids = (list: BossPlayer[]) => list.map((p) => p.name);
  assert.deepEqual(ids(visiblePlayers(players[0], players, rows)), ['p1', 'p2']);
  assert.deepEqual(ids(visiblePlayers(players[2], players, rows)), ['p3']);
  assert.deepEqual(ids(visiblePlayers(players[3], players, rows)), ['p4']);
  assert.deepEqual(ids(visiblePlayers(players[4], players, rows)), ['p5']);
  assert.equal(crossesLanternFloor(person(5, 47, 150), { x: 60, z: 140 }), true);
  assert.equal(crossesLanternFloor(players[0], { x: 47, z: 150 }), true);
  assert.equal(crossesLanternFloor(players[0], { x: 60, z: 140 }), false);
  assert.equal(crossesLanternFloor(person(5, 47, 150, { region: 'settlement' }), { x: 60, z: 140 }), false);
});

test('Lanternmaw notices and news', () => {
  const note = { tick: 5, boss: BossId.Lanternmaw, kind: BossNoticeKind.Hurt, runId: 61n, amount: 4, total: 0, hp: 20, half: 0, quantity: HurtSource.Drown, itemId: '' };
  assert.equal(describeBossNotice(note).boss, 'lanternmaw');
  assert.match(describeBossNotice(note).text, /flood cost you 4 HP/);
  assert.match(describeBossNotice({ ...note, quantity: HurtSource.Bite, amount: 6 }).text, /bit you for 6/);
  assert.equal(describeBossNotice({ ...note, quantity: HurtSource.Blow, amount: 13 }).text, 'A blow hit you for 13 (20 HP left)');
  assert.equal(describeBossNotice({ ...note, quantity: HurtSource.Pulse, amount: 7 }).text, 'A lure pulse hit you for 7 (20 HP left)');
  assert.match(describeBossNotice({ ...note, kind: BossNoticeKind.KnockedOut }).text, /Drowned Hollow/);
  assert.equal(describeBossNotice({ ...note, kind: BossNoticeKind.RunResult, quantity: 1, amount: 140 }).text, 'Lanternmaw run cleared (140 damage)');
  assert.equal(describeBossNotice({ ...note, kind: BossNoticeKind.Reward, itemId: 'fenlight', quantity: 2 }).text, 'Reward: 2 Fenlight');
  for (const [kind, name] of [[BossEventKind.LanternRunStart, 'lantern_run_start'], [BossEventKind.LanternClear, 'lantern_clear'],
    [BossEventKind.LanternOpened, 'lantern_opened'], [BossEventKind.LanternSoon, 'lantern_soon']] as const) {
    assert.deepEqual(describeBossEvent({ tick: 9, boss: BossId.Lanternmaw, kind, runId: 0n, x: 47, z: 152, quantity: 0, value: 10, text: '' }),
      { tick: 9, boss: 'lanternmaw', kind: name, runId: null, x: 47, z: 152, quantity: 0, value: 10, text: '' });
  }
});

test('lantern rows with real identities and u64 ids serialize: /state blocks, /danger and dodge receipts', async () => {
  const { Identity } = await import('spacetimedb');
  const idOf = (i: number) => Identity.fromString(i.toString(16).padStart(64, '0'));
  const runId = 71n;
  const real = (i: number, local: number) => ({ ...onFloor(i, local), identity: idOf(i), pendingId: 9n } as any);
  const rows = lrows({
    lanternRuns: [{ ...lrun(runId), leader: idOf(1) } as any, { ...lrun(72n, { stage: SpireStage.Lobby, endTick: LS + 100, partySize: 1 }), leader: idOf(3) } as any],
    lanternMembers: [{ ...lmember(1, runId, 0), identity: idOf(1) } as any, { ...lmember(2, runId, 1), identity: idOf(2) } as any, { ...lmember(3, 72n, 0, SpireMemberState.Lobby), identity: idOf(3) } as any],
    lanternFights: [lfight(runId, LS + 30)],
  });
  const me = real(1, LANTERN_SPAWNS[0]);
  const players = [me, real(2, LANTERN_SPAWNS[1]), { ...person(3, 47, 151), identity: idOf(3), pendingId: 4n } as any];
  const blocks = describeBosses(rows, me, LS + 31, { players, keysHeld: 0, contribution: null, blocked: WORLD, entry: { slots: emptySlots(), coins: 5, wielded: 'stone_club' } });
  assert.doesNotThrow(() => JSON.stringify(blocks));
  assert.equal((blocks as any).lantern.run.runId, '71');
  const feed = dangerFeed(rows, me, LS + 31, { players, blocked: WORLD, ageMs: 10, tickMs: 600 });
  assert.equal(feed.where, 'lantern');
  assert.doesNotThrow(() => JSON.stringify(feed));
  const step = feed.moves[0] as any;
  const target = step ? { x: step.x ?? step.to?.[0] ?? me.x, z: step.z ?? step.to?.[1] ?? me.z } : { x: me.x, z: me.z };
  assert.doesNotThrow(() => JSON.stringify(dodgeCheck(rows, me, target, LS + 31, WORLD)));
  // At the gate, a lobby member's view.
  const gate = { ...person(3, 47, 151), identity: idOf(3), pendingId: 4n } as any;
  assert.doesNotThrow(() => JSON.stringify(describeBosses(rows, gate, LS + 31, { players, keysHeld: 0, contribution: null, blocked: WORLD })));
});

test('every documented Lanternmaw /danger and state.lantern.run field exists in the real payload', async () => {
  const { readFileSync } = await import('node:fs');
  const { openapi } = await import('./contract');
  const runId = 81n;
  // A run in its dive: the spring is published, so spring and swing are both present.
  let fight = lfight(runId, LS);
  for (let T = LS + 1; fight.stage !== LanternStage.Dive && T < LS + 200; T++) fight = { ...fight, ...lanternAdvance(fight, T, LS, LANTERN_SPAWNS.slice(0, 2)) };
  const rows = lrows({ lanternRuns: [lrun(runId)], lanternMembers: [lmember(1, runId, 0), lmember(2, runId, 1)], lanternFights: [fight] });
  const tick = fight.surfaceTick - 4;
  const me = onFloor(1, LANTERN_SPAWNS[0]);
  const players = [me, onFloor(2, LANTERN_SPAWNS[1])];
  const feed = dangerFeed(rows, me, tick, { players, blocked: WORLD, ageMs: 10, tickMs: 600 }) as any;
  const run = (describeBosses(rows, me, tick, { players, keysHeld: 0, contribution: null, blocked: WORLD }) as any).lantern.run;
  assert.ok(feed.spring && run.spring, 'the dive publishes the spring');
  const fields = (list: string) => list.split(',').map((s) => s.trim().split(/[\s:]/)[0]).filter((s) => /^[a-zA-Z]+$/.test(s));
  const lists = (text: string, key: string) => [...text.matchAll(new RegExp('`?' + key + ' \\{([^}]*)\\}', 'g'))].map((m) => fields(m[1]));
  const dangerDoc = (openapi as any).paths['/danger'].get.summary as string;
  const md = readFileSync(new URL('../../docs/AGENT_API.md', import.meta.url), 'utf8');
  const agentMd = readFileSync(new URL('../public/agent.md', import.meta.url), 'utf8');
  const dangerSection = md.slice(md.indexOf('**`GET /danger` in the Hollow.**'), md.indexOf('**Notices and news.**'));
  const runSection = md.slice(md.indexOf('**`state.lantern.run`**'), md.indexOf('**`GET /danger` in the Hollow.**'));
  const agentDanger = agentMd.slice(agentMd.indexOf('Read GET `/api/agent/v1/danger` every tick inside'));
  const check = (where: string, doc: string, key: string, payload: Record<string, unknown>) => {
    const found = lists(doc, key);
    assert.ok(found.length > 0, `${where} documents ${key}`);
    for (const list of found) for (const f of list) assert.ok(f in payload, `${where}: ${key}.${f} is missing from the payload`);
  };
  check('openapi /danger', dangerDoc, 'spring', feed.spring);
  check('openapi /danger', dangerDoc, 'swing', feed.swing);
  check('AGENT_API /danger', dangerSection, 'spring', feed.spring);
  check('AGENT_API /danger', dangerSection, 'swing', feed.swing);
  check('agent.md /danger', agentDanger, 'spring', feed.spring);
  check('AGENT_API state.lantern.run', runSection, 'spring', run.spring);
  assert.deepEqual(feed.spring.tile, { x: feed.spring.x, z: feed.spring.z });
  assert.deepEqual(feed.spring.tile, run.spring.tile);
});

test('the start grace reads "still" in /danger and state.lantern.run; the Wielded notice names the weapon', () => {
  const runId = 91n;
  const rows = lrows({ lanternRuns: [lrun(runId)], lanternMembers: [lmember(1, runId, 0), lmember(2, runId, 1)], lanternFights: [lfight(runId, LS - 1)] });
  const me = onFloor(1, LANTERN_SPAWNS[0]);
  const players = [me, onFloor(2, LANTERN_SPAWNS[1])];
  const feed = dangerFeed(rows, me, LS - 3, { players, blocked: WORLD, ageMs: 10, tickMs: 600 }) as any;
  assert.equal(feed.boss.stage, 'still');
  const run = (describeBosses(rows, me, LS - 3, { players, keysHeld: 0, contribution: null, blocked: WORLD }) as any).lantern.run;
  assert.equal(run.fightStage, 'still');
  assert.equal(run.still.untilTick, LS);
  assert.equal((describeBosses(rows, me, LS + 1, { players, keysHeld: 0, contribution: null, blocked: WORLD }) as any).lantern.run.fightStage, 'den');
  const n = describeBossNotice({ tick: LS - 15, boss: 3, kind: 9, runId, amount: 8, total: 0, hp: 0, half: 0, quantity: 0, itemId: 'stone_club' });
  assert.equal(n.kind, 'wielded');
  assert.match(n.text, /You drew your Stone Club \(8 damage\)/);
});

test('state.lantern.you shows the lobby ready check from lantern_readiness rows', () => {
  const runId = 95n;
  const rows = lrows({ lanternRuns: [lrun(runId, { stage: SpireStage.Lobby, partySize: 2, endTick: LS + 100 })],
    lanternMembers: [lmember(1, runId, 0, SpireMemberState.Lobby), lmember(2, runId, 1, SpireMemberState.Lobby)],
    lanternReadiness: [{ identity: hexId(2), runId, tick: LS - 3 }] });
  const lead = person(1, 47, 151), mate = person(2, 47, 151);
  const you = (p: BossPlayer) => (describeBosses(rows, p, LS, { players: [lead, mate], keysHeld: 0, contribution: null, blocked: WORLD }) as any).lantern.you;
  assert.deepEqual(you(lead).members.map((m: any) => m.ready), [true, true]);
  assert.equal(you(lead).startReady, true);
  assert.equal(you(mate).sendReady, true);
  const stale = { ...rows, lanternReadiness: [{ identity: hexId(2), runId, tick: LS - 25 }] };
  assert.equal((describeBosses(stale, lead, LS, { players: [lead, mate], keysHeld: 0, contribution: null, blocked: WORLD }) as any).lantern.you.startReady, false);
});
