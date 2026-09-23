import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createAgentServer } from './http';
import { InviteStore } from './security';

async function fixture(options: { maxSessions?: number; delayed?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'berigame-agent-api-'));
  let now = Date.now();
  const calls: string[] = [];
  const closed: string[] = [];
  let created = 0;
  let release: (() => void) | undefined;
  const gate = options.delayed ? new Promise<void>(r => { release = r; }) : Promise.resolve();
  const invites = new InviteStore(directory);
  const api = createAgentServer({ invites, maxSessions: options.maxSessions, now: () => now, game: {
    ready: () => true,
    async create() {
      const identity = String(++created).padStart(64, '0');
      await gate;
      return { identity, state: () => ({ player: { id: identity }, inventory: [] }),
        async action(name: string) { calls.push(name); }, async close() { closed.push(identity); } };
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
  return { directory, request, rawStatus, issue, enter, calls, closed, release, created: () => created, advance: (ms: number) => { now += ms; },
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
      ['move', { x: 4, z: 5, owner: 'someone_else' }, 400], ['move', { x: 50, z: 5 }, 400],
      ['move', { x: 1.5, z: 5 }, 400], ['__proto__', {}, 404], ['tick', {}, 404],
    ];
    for (const [name, body, status] of cases) {
      f.advance(1100);
      assert.equal((await f.request(`/actions/${name}`, token, body, { 'Idempotency-Key': randomUUID() })).status, status);
    }
    assert.deepEqual(f.calls, []);
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
    for (let i = 0; i < 4; i++) assert.equal((await f.request('/actions/move', token, { x: -1, z: 1 })).status, 400);
    const response = await f.request('/actions/stop', token, {}, { 'Idempotency-Key': randomUUID() });
    assert.equal(response.status, 429); assert.ok(Number(response.headers.get('Retry-After')) >= 1);
    assert.deepEqual(f.calls, []);
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

test('untrusted forwarded addresses cannot evade per-address active session limits', async () => {
  const f = await fixture();
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
