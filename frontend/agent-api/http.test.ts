import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createAgentServer } from './http';
import { ApiError, unexpectedError } from './portable';
import { InviteStore } from './security';
import { AGENT_ACTION_BUDGET, AGENT_READ_BUDGET, WATCH_PASS_BUDGET } from './admissionPolicy';
import { GRID_SIZE } from '../../shared/sim/constants';
import { describeObjective } from '../../shared/sim/agentState';
import { firstDayGoal } from '../../shared/sim/goals';
import { emptySlots } from '../../shared/sim/inventory';
import { PlayerState, Pending } from '../../shared/sim/types';

async function fixture(options: { watchKey?: string; spectatorUri?: string; maxSessions?: number; maxSessionsPerIp?: number; delayed?: boolean; link?: { stalled: boolean; alive: boolean }; state?: () => Record<string, any> } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'berigame-agent-api-'));
  let now = Date.now();
  const calls: string[] = [];
  const inputs: Record<string, unknown>[] = [];
  let dangerReads = 0;
  const closed: string[] = [];
  let created = 0;
  let release: (() => void) | undefined;
  const gate = options.delayed ? new Promise<void>(r => { release = r; }) : Promise.resolve();
  const invites = new InviteStore(directory);
  const logs: Record<string, any>[] = [];
  const api = createAgentServer({ invites, maxSessions: options.maxSessions, maxSessionsPerIp: options.maxSessionsPerIp, now: () => now, log: entry => logs.push(entry), watchKey: options.watchKey, spectatorUri: options.spectatorUri, game: {
    ready: () => true,
    async spectate() { return { uri: 'ws://internal:3000', database: 'world', identity: 'f'.repeat(64), token: 'viewer-token', expiresAt: '2030-01-01T00:00:00.000Z' }; },
    async create() {
      const identity = String(++created).padStart(64, '0');
      await gate;
      return { identity, state: (map?: { map?: boolean }) => options.state?.() ?? { player: { id: identity }, inventory: [], world: { map: map?.map ? { rows: [] } : null } },
        danger: () => {
          if (options.link?.stalled) throw new ApiError(503, 'world_unavailable', 'The live world is unavailable. Retry shortly.');
          return { v: 1, tick: ++dangerReads, where: null, moves: [], best: null, path: [] } as any;
        },
        ...(options.link ? { alive: () => options.link!.alive } : {}),
        async action(name: string, input: Record<string, unknown>) { calls.push(name); inputs.push(input); }, async close() { closed.push(identity); } };
    },
  } });
  await new Promise<void>(r => api.server.listen(0, '127.0.0.1', r));
  const address = api.server.address();
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/agent/v1`;
  const request = (path: string, token?: string, body?: unknown, headers: Record<string, string> = {}, method = body === undefined ? 'GET' : 'POST') => fetch(base + path, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  const issue = (permissions = {}) => invites.issue({ expiresAt: now + 60_000, lifetimeSeconds: 60, combat: false, chat: false, ...permissions });
  const enter = async () => { const code = await issue(); const response = await request('/sessions', code, {}); assert.equal(response.status, 201); return await response.json() as any; };
  const rawStatus = (path: string, headers: Record<string, string>) => new Promise<number>((resolve, reject) => {
    const req = httpRequest(base + path, { headers }, res => { res.resume(); resolve(res.statusCode!); });
    req.on('error', reject); req.end();
  });
  return { directory, request, rawStatus, issue, enter, calls, inputs, closed, logs, release, created: () => created, advance: (ms: number) => { now += ms; },
    async close() { release?.(); await api.close(); await rm(directory, { recursive: true, force: true }); } };
}

test('invites are atomically single-use across concurrent stores and durable across restarts', async () => {
  const f = await fixture();
  try {
    const code = await f.issue();
    const attempts = await Promise.allSettled([new InviteStore(f.directory).consume(code), new InviteStore(f.directory).consume(code)]);
    assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
    await assert.rejects(new InviteStore(f.directory).consume(code), /already used/);
    for (const file of await readdir(join(f.directory, 'spent'))) assert.ok(!(await readFile(join(f.directory, 'spent', file), 'utf8')).includes(code));
  } finally { await f.close(); }
});

test('authentication, scope and strict schemas reject requests before game actions', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/state')).status, 401);
    const { token } = await f.enter();
    const cases: [string, object, number][] = [
      ['attack', { playerId: '0'.repeat(64) }, 403], ['chat', { text: 'hi' }, 403],
      ['move', { x: 4, z: 5, owner: 'someone_else' }, 400], ['move', { x: GRID_SIZE, z: 5 }, 400],
      ['move', { x: 1.5, z: 5 }, 400], ['__proto__', {}, 404], ['tick', {}, 404],
      // Weapons are wielded only from the three quick slots; unwield takes no fields.
      ['wield', { slot: 3 }, 400], ['wield', { slot: -1 }, 400], ['wield', {}, 400], ['unwield', { slot: 0 }, 400],
      // The rock-paper-scissors stance action was retired in API 1.1.0.
      ['stance', { stance: 'guard' }, 404],
    ];
    for (const [name, body, status] of cases) {
      f.advance(1100);
      assert.equal((await f.request(`/actions/${name}`, token, body, { 'Idempotency-Key': randomUUID() })).status, status);
    }
    assert.deepEqual(f.calls, []);
  } finally { await f.close(); }
});

test('the dropped-bag goal reaches /state after a death and its id is what pickup accepts', async () => {
  const id = 18446744073709551615n;
  const me = { x: 25, z: 25, hp: 30, maxHp: 30, state: PlayerState.Alive, weapon: '', pending: Pending.None, pendingId: 0, harvestTreeId: 0, harvestEndTick: 0, respawnTick: 0, lastInputTick: 0 };
  const { goal } = firstDayGoal({ me, slots: emptySlots(), trees: [], others: [], tick: 10, canFight: true, done: [], bag: { id, x: 20, z: 20 } });
  // describeObjective spreads the goal, so the action reaches /state twice.
  const f = await fixture({ state: () => ({ goal, objective: describeObjective('bramblewild', goal, { enabled: false, quests: [] }) }) });
  try {
    const { token } = await f.enter();
    const response = await f.request('/state', token);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    const action = body.goal.action;
    assert.deepEqual(action, { kind: 'pickup', itemId: String(id) });
    assert.deepEqual(body.objective.action, action);
    assert.equal((await f.request('/actions/pickup', token, { id: action.itemId }, { 'Idempotency-Key': randomUUID() })).status, 200);
    assert.equal(BigInt(f.inputs[0].id as string), id);
  } finally { await f.close(); }
});

test('an unexpected exception logs the real error and tells the client nothing', async () => {
  const f = await fixture({ state: () => ({ leaked: 1n }) });
  try {
    const { token } = await f.enter();
    const response = await f.request('/state', token);
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { error: { code: 'unavailable', message: 'The request could not be completed.' } });
    const entry = f.logs.find(e => e.event === 'unexpected_error');
    assert.ok(entry, 'the exception must reach the server log');
    assert.equal(entry.method, 'GET'); assert.equal(entry.path, '/api/agent/v1/state');
    assert.match(entry.error.message, /serialize a BigInt/);
    assert.match(entry.error.stack, /http\.ts/);
  } finally { await f.close(); }
});

test('expected refusals stay out of the unexpected error log', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/state')).status, 401);
    assert.equal(f.logs.filter(e => e.event === 'unexpected_error').length, 0);
  } finally { await f.close(); }
});

test('logged errors never carry credentials', () => {
  const error = new Error('connect wss://db.test/v1?token=eyJhbGciOi.payload.sig failed for Bearer bgs_' + 'a'.repeat(43) + ' and bgi_' + 'b'.repeat(43));
  error.stack = error.message + '\n    at connect (game.ts:1:1)';
  const logged = JSON.stringify(unexpectedError(error));
  assert.doesNotMatch(logged, /eyJhbGciOi|aaaa|bbbb/);
  assert.match(logged, /game\.ts:1:1/);
  assert.equal(unexpectedError('plain').message, 'plain');
});

test('wield and unwield reach the game with the documented quick-slot range', async () => {
  const f = await fixture();
  try {
    const { token } = await f.enter();
    assert.equal((await f.request('/actions/wield', token, { slot: 2 }, { 'Idempotency-Key': randomUUID() })).status, 200);
    f.advance(1100);
    assert.equal((await f.request('/actions/unwield', token, {}, { 'Idempotency-Key': randomUUID() })).status, 200);
    assert.deepEqual(f.calls, ['wield', 'unwield']);
    const spec = await (await f.request('/openapi.json')).json() as any;
    assert.equal(spec.info.version, '1.11.0');
    assert.equal(spec.paths['/actions/stance'], undefined);
    assert.deepEqual(spec.paths['/actions/wield'].post.requestBody.content['application/json'].schema.properties.slot, { type: 'integer', minimum: 0, maximum: 2 });
  } finally { await f.close(); }
});

test('an action retry runs once and a changed payload cannot reuse the same key', async () => {
  const f = await fixture();
  try {
    const { token } = await f.enter();
    const headers = { 'Idempotency-Key': randomUUID() };
    assert.equal((await f.request('/actions/eat', token, { slot: 0 }, headers)).status, 200);
    assert.equal((await f.request('/actions/eat', token, { slot: 0 }, headers)).status, 200);
    assert.equal((await f.request('/actions/eat', token, { slot: 1 }, headers)).status, 409);
    assert.deepEqual(f.calls, ['eat']);
  } finally { await f.close(); }
});

test('invalid action attempts exhaust the same rate budget and include Retry-After', async () => {
  const f = await fixture();
  try {
    const { token } = await f.enter();
    for (let i = 0; i < AGENT_ACTION_BUDGET.burst; i++) assert.equal((await f.request('/actions/move', token, { x: -1, z: 1 })).status, 400);
    const response = await f.request('/actions/stop', token, {}, { 'Idempotency-Key': randomUUID() });
    assert.equal(response.status, 429); assert.ok(Number(response.headers.get('Retry-After')) >= 1);
    assert.deepEqual(f.calls, []);
  } finally { await f.close(); }
});

test('a bot can act every tick for a second and still read state', async () => {
  const f = await fixture();
  try {
    const { token } = await f.enter();
    for (let i = 0; i < AGENT_ACTION_BUDGET.burst; i++) {
      assert.equal((await f.request('/actions/stop', token, {}, { 'Idempotency-Key': randomUUID() })).status, 200);
    }
    assert.equal((await f.request('/state', token)).status, 200);
    f.advance(1000);
    for (let i = 0; i < AGENT_ACTION_BUDGET.perSecond; i++) {
      assert.equal((await f.request('/actions/stop', token, {}, { 'Idempotency-Key': randomUUID() })).status, 200);
    }
    assert.equal(f.calls.length, AGENT_ACTION_BUDGET.burst + AGENT_ACTION_BUDGET.perSecond);
  } finally { await f.close(); }
});

test('API rejects oversized bodies, URL credentials, browser origins and forged hosts', async () => {
  const f = await fixture();
  try {
    const { token } = await f.enter();
    assert.equal((await f.request('/actions/chat', token, { text: 'x'.repeat(5000) })).status, 413);
    assert.equal((await f.request(`/state?token=${token}`)).status, 404);
    assert.equal((await f.request('/state', token, undefined, { Origin: 'https://evil.example' })).status, 403);
    assert.equal(await f.rawStatus('/state', { Host: 'evil.example', Authorization: `Bearer ${token}` }), 403);
    assert.deepEqual(f.calls, []);
  } finally { await f.close(); }
});

test('absolute expiry and explicit leave invalidate tokens and disconnect their characters', async () => {
  const f = await fixture();
  try {
    const first = await f.enter();
    f.advance(61_000);
    assert.equal((await f.request('/state', first.token)).status, 401);
    const second = await f.enter();
    assert.notEqual(first.playerId, second.playerId);
    assert.equal((await f.request('/session', second.token, undefined, {}, 'DELETE')).status, 204);
    assert.equal((await f.request('/state', second.token)).status, 401);
    assert.deepEqual(f.closed, [first.playerId, second.playerId]);
  } finally { await f.close(); }
});

test('session capacity includes connections still provisioning', async () => {
  const f = await fixture({ maxSessions: 1, delayed: true });
  try {
    const first = f.request('/sessions', await f.issue(), {});
    while (f.created() === 0) await new Promise(r => setTimeout(r, 5));
    const second = await f.request('/sessions', await f.issue(), {}, { 'X-Forwarded-For': '203.0.113.9' });
    assert.equal(second.status, 429);
    f.release!(); assert.equal((await first).status, 201);
    assert.equal(f.created(), 1);
  } finally { await f.close(); }
});

test('untrusted forwarded addresses cannot evade an explicitly configured address limit', async () => {
  const f = await fixture({ maxSessionsPerIp: 4 });
  try {
    for (let i = 0; i < 4; i++) {
      const response = await f.request('/sessions', await f.issue(), {}, { 'X-Forwarded-For': `203.0.113.${i + 1}` });
      assert.equal(response.status, 201);
    }
    const response = await f.request('/sessions', await f.issue(), {}, { 'X-Forwarded-For': '203.0.113.99' });
    assert.equal(response.status, 429);
    assert.equal(f.created(), 4);
  } finally { await f.close(); }
});

test('idle timeout revokes a session before its absolute lifetime ends', async () => {
  const f = await fixture();
  try {
    const response = await f.request('/sessions', await f.issue({ lifetimeSeconds: 3600 }), {});
    const { token, playerId } = await response.json() as any;
    f.advance(600_001);
    assert.equal((await f.request('/state', token)).status, 401);
    assert.deepEqual(f.closed, [playerId]);
  } finally { await f.close(); }
});

test('invite replay and expiration cannot create another player', async () => {
  const f = await fixture();
  try {
    const code = await f.issue();
    assert.equal((await f.request('/sessions', code, {})).status, 201);
    assert.equal((await f.request('/sessions', code, {})).status, 401);
    const expired = await f.issue(); f.advance(61_000);
    assert.equal((await f.request('/sessions', expired, {})).status, 401);
    assert.equal(f.created(), 1);
  } finally { await f.close(); }
});

test('a LAN can fill 64 agent slots without an address cap', async () => {
  const f = await fixture();
  try { for (let i = 0; i < 64; i++) await f.enter(); assert.equal(f.created(), 64); }
  finally { await f.close(); }
});

test('GET /danger returns the feed and is billed as an ordinary read, sharing the state budget', async () => {
  const f = await fixture();
  try {
    const { token } = await f.enter();
    const first = await f.request('/danger', token);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { v: 1, tick: 1, where: null, moves: [], best: null, path: [] });
    for (let i = 1; i < AGENT_READ_BUDGET.burst; i++) assert.equal((await f.request(i % 2 ? '/state' : '/danger', token)).status, 200);
    const limited = await f.request('/danger', token);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('Retry-After')) >= 1);
    assert.equal((await f.request('/state', token)).status, 429);
    // Actions keep their own budget.
    assert.equal((await f.request('/actions/dodge', token, { x: 75, z: 60 }, { 'Idempotency-Key': randomUUID() })).status, 200);
    f.advance(1000);
    assert.equal((await f.request('/danger/next/5', token)).status, 404);
    assert.equal((await f.request('/danger', token, {}, {}, 'POST')).status, 404);
  } finally { await f.close(); }
});

test('GET /danger keeps the session through a tick stall but closes it once the link has dropped', async () => {
  const link = { stalled: false, alive: true };
  const f = await fixture({ link });
  try {
    const { token } = await f.enter();
    assert.equal((await f.request('/danger', token)).status, 200);
    link.stalled = true;
    assert.equal((await f.request('/danger', token)).status, 503);
    assert.deepEqual(f.closed, []);
    link.stalled = false;
    assert.equal((await f.request('/danger', token)).status, 200);
    link.stalled = true; link.alive = false;
    f.advance(1000);
    assert.equal((await f.request('/danger', token)).status, 503);
    assert.equal(f.closed.length, 1);
    assert.equal((await f.request('/danger', token)).status, 401);
  } finally { await f.close(); }
});

test('boss actions validate their documented fields before reaching the game', async () => {
  const f = await fixture();
  try {
    const { token } = await f.enter();
    const cases: [string, object, number][] = [
      ['spire', {}, 400], ['spire', { op: 'kick' }, 400], ['spire', { op: 'open', practice: 1 }, 400], ['spire', { op: 'open', public: 0 }, 400],
      ['spire', { op: 'open', runId: '4' }, 400], ['spire', { op: 'start', runId: '4' }, 400], ['spire', { op: 'join', runId: '4x' }, 400],
      ['spire', { op: 'join', runId: '18446744073709551616' }, 400], ['spire', { op: 'leave', playerId: '0'.repeat(64) }, 400],
      ['dodge', { x: 1 }, 400], ['dodge', { x: GRID_SIZE, z: 1 }, 400], ['dodge', { x: 1.5, z: 1 }, 400], ['dodge', { x: 1, z: 1, y: 0 }, 400],
      ['attack_clatterhorn', { id: 1 }, 400],
      ['lantern', {}, 400], ['lantern', { op: 'cap' }, 400], ['lantern', { op: 'open', runId: '4' }, 400], ['lantern', { op: 'start', runId: '4' }, 400],
      ['lantern', { op: 'leave', runId: '4' }, 400], ['lantern', { op: 'join', runId: '-1' }, 400], ['lantern', { op: 'join', runId: 7 }, 400],
      ['lantern', { op: 'open', clientRules: 2 }, 400], ['lantern', { op: 'join', runId: '18446744073709551616' }, 400],
    ];
    for (const [name, body, status] of cases) {
      f.advance(1100);
      const response = await f.request(`/actions/${name}`, token, body, { 'Idempotency-Key': randomUUID() });
      assert.equal(response.status, status, `${name} ${JSON.stringify(body)}`);
    }
    f.advance(1100);
    const big = await f.request('/actions/spire', token, { op: 'join', runId: '18446744073709551616' }, { 'Idempotency-Key': randomUUID() });
    assert.equal((await big.json() as any).error.code, 'invalid_id');
    assert.deepEqual(f.calls, []);
    const ok: [string, object][] = [['spire', { op: 'open' }], ['spire', { op: 'join' }], ['spire', { op: 'join', runId: '41' }], ['spire', { op: 'start' }],
      ['spire', { op: 'leave' }], ['dodge', { x: 76, z: 60 }], ['attack_clatterhorn', {}],
      ['lantern', { op: 'open' }], ['lantern', { op: 'join' }], ['lantern', { op: 'join', runId: '52' }], ['lantern', { op: 'start' }], ['lantern', { op: 'leave' }]];
    for (const [name, body] of ok) {
      f.advance(1100);
      assert.equal((await f.request(`/actions/${name}`, token, body, { 'Idempotency-Key': randomUUID() })).status, 200, name);
    }
    assert.deepEqual(f.calls, ['spire', 'spire', 'spire', 'spire', 'spire', 'dodge', 'attack_clatterhorn', 'lantern', 'lantern', 'lantern', 'lantern', 'lantern']);
    assert.deepEqual(f.inputs[2], { op: 'join', runId: '41' });
    assert.deepEqual(f.inputs[9], { op: 'join', runId: '52' });
  } finally { await f.close(); }
});

test('OpenAPI 1.11.0 documents /danger and the boss actions without a capability', async () => {
  const f = await fixture();
  try {
    const spec = await (await f.request('/openapi.json')).json() as any;
    assert.equal(spec.info.version, '1.11.0');
    assert.equal(spec.paths['/danger'].get.operationId, 'inspect_danger');
    assert.equal(spec.paths['/danger/next/{afterTick}'], undefined);
    for (const name of ['attack_clatterhorn', 'spire', 'lantern', 'dodge']) {
      assert.equal(spec.paths[`/actions/${name}`].post.operationId, name);
      assert.equal(spec.paths[`/actions/${name}`].post['x-required-capability'], undefined);
    }
    const spire = spec.paths['/actions/spire'].post.requestBody.content['application/json'].schema;
    assert.deepEqual(spire.properties.op.enum, ['open', 'join', 'start', 'leave']);
    assert.deepEqual(Object.keys(spire.properties).sort(), ['op', 'runId']);
    const lantern = spec.paths['/actions/lantern'].post;
    assert.deepEqual(lantern.requestBody.content['application/json'].schema.properties.op.enum, ['open', 'join', 'start', 'leave']);
    assert.deepEqual(Object.keys(lantern.requestBody.content['application/json'].schema.properties).sort(), ['op', 'runId']);
    assert.deepEqual(lantern.requestBody.content['application/json'].schema.required, ['op']);
    assert.match(lantern.summary, /Fen Gate \(47,152\)/);
    assert.match(lantern.summary, /1 gleamshell \+ 1 obsidian \+ 2 driftwood, Crafting 1\) and 5 coins/);
    assert.match(lantern.summary, /lantern_weapon, lantern_bait, lantern_fee/);
    assert.match(spec.paths['/danger'].get.summary, /Drowned Hollow/);
    assert.deepEqual(spec.paths['/actions/dodge'].post.requestBody.content['application/json'].schema.required, ['x', 'z']);
  } finally { await f.close(); }
});

test('OpenAPI 1.11.0 documents deliver_commission and the tiered node kinds', async () => {
  const f = await fixture();
  try {
    const spec = await (await f.request('/openapi.json')).json() as any;
    const deliver = spec.paths['/actions/deliver_commission'].post;
    assert.equal(deliver.operationId, 'deliver_commission');
    assert.equal(deliver['x-required-capability'], undefined);
    assert.equal(deliver.parameters[0].name, 'Idempotency-Key');
    assert.deepEqual(deliver.requestBody.content['application/json'].schema.properties.slot, { type: 'integer', minimum: 0, maximum: 2 });
    assert.deepEqual(deliver.requestBody.content['application/json'].schema.required, ['slot']);
    const kinds = spec.paths['/actions/harvest'].post.requestBody.content['application/json'].schema.properties.kind.enum;
    assert.deepEqual(kinds.slice(0, 4), ['berry', 'driftwood', 'tide_rock', 'obsidian']);
    assert.ok(kinds.includes('honey_hive') && kinds.includes('fallen_star'));
    assert.match(spec.paths['/actions/harvest'].post.summary, /honey_hive \(Foraging 15/);
  } finally { await f.close(); }
});

test('GET /world serves the compact map without a session, and OpenAPI documents it', async () => {
  const f = await fixture();
  try {
    const res = await f.request('/world');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.length < 48 * 1024, `atlas is ${text.length} bytes`);
    const atlas = JSON.parse(text);
    const { GRID_SIZE, TERRAIN_MAP, TERRAIN_VERSION } = await import('../../shared/sim');
    const { decodeRuns } = await import('./worldAtlas');
    assert.equal(atlas.gridSize, GRID_SIZE);
    assert.equal(atlas.version, TERRAIN_VERSION);
    assert.equal(atlas.rows.length, GRID_SIZE);
    assert.ok(atlas.rows.every((row: string, z: number) => decodeRuns(row) === TERRAIN_MAP.rows[z]));
    assert.ok(atlas.biomeRows.every((row: string) => decodeRuns(row).length === GRID_SIZE));
    assert.deepEqual(atlas.biomes.map((b: any) => b.id), ['isle', 'frostpine', 'hearthvale', 'glimmerfen', 'dunes', 'starfall']);
    assert.deepEqual(atlas.routes.causeways.find((c: any) => c.id === 'kings-road').connects, ['isle', 'frostpine']);
    assert.equal(atlas.waystones.length, 5);
    const spec = await (await f.request('/openapi.json')).json() as any;
    assert.equal(spec.paths['/world'].get.operationId, 'inspect_world_map');
    assert.deepEqual(spec.paths['/world'].get.security, []);
  } finally { await f.close(); }
});

test('GET /state?map=1 is the one accepted query: it adds world.map, which is otherwise null', async () => {
  const f = await fixture();
  try {
    const { token } = await f.enter();
    assert.equal(((await (await f.request('/state', token)).json()) as any).world.map, null);
    assert.deepEqual(((await (await f.request('/state?map=1', token)).json()) as any).world.map, { rows: [] });
    for (const path of ['/state?map=0', '/state?map=1&x=1', '/danger?map=1']) assert.equal((await f.request(path, token)).status, 404, path);
  } finally { await f.close(); }
});

test('POST /spectators issues a read-only pass, from any origin, behind the world\'s watch key', async () => {
  const keyed = await fixture({ watchKey: 'secret-key', spectatorUri: 'wss://public.example' });
  try {
    const response = await keyed.request('/spectators', 'secret-key', undefined, { Origin: 'https://elsewhere.example' }, 'POST');
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    const pass = await response.json() as any;
    assert.equal(pass.token, 'viewer-token');
    assert.equal(pass.uri, 'wss://public.example');
    assert.equal((await keyed.request('/spectators', undefined, undefined, { Origin: 'https://elsewhere.example' }, 'OPTIONS')).status, 204);
    // The exemption is this path's alone.
    assert.equal((await keyed.request('/world', undefined, undefined, { Origin: 'https://elsewhere.example' })).status, 403);
    assert.equal((await keyed.request('/spectators', undefined, undefined, {}, 'POST')).status, 401);
    assert.equal((await keyed.request('/spectators', 'wrong-key!', undefined, {}, 'POST')).status, 401);
  } finally { await keyed.close(); }
});

test('POST /spectators fails closed when the world has no watch key', async () => {
  const open = await fixture();
  try {
    const response = await open.request('/spectators', undefined, undefined, { Origin: 'https://elsewhere.example' }, 'POST');
    assert.equal(response.status, 403);
    assert.equal(((await response.json()) as any).error.code, 'watch_disabled');
    assert.equal((await open.request('/spectators', 'anything', undefined, {}, 'POST')).status, 403);
  } finally { await open.close(); }
});

test('passes have their own per-address lane, charged only after the key is accepted', async () => {
  const f = await fixture({ watchKey: 'secret-key' });
  try {
    for (let i = 0; i < 50; i++) assert.equal((await f.request('/spectators', 'wrong-key!', undefined, {}, 'POST')).status, 401);
    for (let i = 0; i < WATCH_PASS_BUDGET.burst; i++) assert.equal((await f.request('/spectators', 'secret-key', undefined, {}, 'POST')).status, 201, `pass ${i}`);
    const refused = await f.request('/spectators', 'secret-key', undefined, {}, 'POST');
    assert.equal(refused.status, 429);
    assert.ok(Number(refused.headers.get('retry-after')) > 60);
    // Players and agents still join from the same address.
    await f.enter();
    f.advance(Math.ceil(1000 / WATCH_PASS_BUDGET.perSecond));
    assert.equal((await f.request('/spectators', 'secret-key', undefined, {}, 'POST')).status, 201);
  } finally { await f.close(); }
});
