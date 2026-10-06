import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createAgentServer } from './http';
import { InviteStore } from './security';
import { AGENT_ACTION_BUDGET, AGENT_READ_BUDGET } from './admissionPolicy';
import { GRID_SIZE } from '../../shared/sim/constants';

async function fixture(options: { maxSessions?: number; maxSessionsPerIp?: number; delayed?: boolean } = {}) {
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
  const api = createAgentServer({ invites, maxSessions: options.maxSessions, maxSessionsPerIp: options.maxSessionsPerIp, now: () => now, game: {
    ready: () => true,
    async create() {
      const identity = String(++created).padStart(64, '0');
      await gate;
      return { identity, state: () => ({ player: { id: identity }, inventory: [] }),
        danger: () => ({ v: 1, tick: ++dangerReads, where: null, moves: [], best: null, path: [] }) as any,
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
  return { directory, request, rawStatus, issue, enter, calls, inputs, closed, release, created: () => created, advance: (ms: number) => { now += ms; },
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

test('wield and unwield reach the game with the documented quick-slot range', async () => {
  const f = await fixture();
  try {
    const { token } = await f.enter();
    assert.equal((await f.request('/actions/wield', token, { slot: 2 }, { 'Idempotency-Key': randomUUID() })).status, 200);
    f.advance(1100);
    assert.equal((await f.request('/actions/unwield', token, {}, { 'Idempotency-Key': randomUUID() })).status, 200);
    assert.deepEqual(f.calls, ['wield', 'unwield']);
    const spec = await (await f.request('/openapi.json')).json() as any;
    assert.equal(spec.info.version, '1.7.0');
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
      ['spire', { op: 'leave' }], ['dodge', { x: 76, z: 60 }], ['attack_clatterhorn', {}]];
    for (const [name, body] of ok) {
      f.advance(1100);
      assert.equal((await f.request(`/actions/${name}`, token, body, { 'Idempotency-Key': randomUUID() })).status, 200, name);
    }
    assert.deepEqual(f.calls, ['spire', 'spire', 'spire', 'spire', 'spire', 'dodge', 'attack_clatterhorn']);
    assert.deepEqual(f.inputs[2], { op: 'join', runId: '41' });
  } finally { await f.close(); }
});

test('OpenAPI 1.7.0 documents /danger and the boss actions without a capability', async () => {
  const f = await fixture();
  try {
    const spec = await (await f.request('/openapi.json')).json() as any;
    assert.equal(spec.info.version, '1.7.0');
    assert.equal(spec.paths['/danger'].get.operationId, 'inspect_danger');
    assert.equal(spec.paths['/danger/next/{afterTick}'], undefined);
    for (const name of ['attack_clatterhorn', 'spire', 'dodge']) {
      assert.equal(spec.paths[`/actions/${name}`].post.operationId, name);
      assert.equal(spec.paths[`/actions/${name}`].post['x-required-capability'], undefined);
    }
    const spire = spec.paths['/actions/spire'].post.requestBody.content['application/json'].schema;
    assert.deepEqual(spire.properties.op.enum, ['open', 'join', 'start', 'leave']);
    assert.deepEqual(Object.keys(spire.properties).sort(), ['op', 'runId']);
    assert.deepEqual(spec.paths['/actions/dodge'].post.requestBody.content['application/json'].schema.required, ['x', 'z']);
  } finally { await f.close(); }
});
