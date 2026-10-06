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
  // The tagged internal coordinate (256 + joined-frame x) seen in playtests.
  assert.equal(outward.x, 256 + MEADOW_OFFSET.x + 31);
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
  assert.equal(blocks.clatterhorn.state, 'dormant');
  assert.deepEqual(blocks.clatterhorn.you.contribution, 20);
  assert.equal(blocks.spire.key.held, 2);
  assert.deepEqual(blocks.spire.capacity, { active: 1, max: BOSS_CONFIG_DEFAULTS.spireMaxRuns, lobbies: 1, inside: 1 });
  assert.equal(blocks.spire.lobbies[0].runId, '89');
  assert.equal(blocks.spire.run.runId, '88');
  assert.equal(blocks.spire.run.members[1].tile, null);
  assert.deepEqual(describeBosses(rows, person(1, 74, 60, { region: 'settlement' }), 1010, { players, keysHeld: 0, contribution: null, blocked: WORLD }), { clatterhorn: null, spire: null });
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
