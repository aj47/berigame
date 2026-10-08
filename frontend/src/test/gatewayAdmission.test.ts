// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {
  constructor(public ctx: any, public env: any) {}
} }));
vi.mock('../../cloudflare/codecs', () => ({}));
vi.mock('../../cloudflare/socket', () => ({ openCloudflareSocket: vi.fn() }));
vi.mock('../../agent-api/game', () => ({ createGameService: vi.fn(), deadline: (promise: Promise<any>) => promise }));
import worker, { AgentGateway } from '../../cloudflare/worker';
import { createGameService } from '../../agent-api/game';
import { digest } from '../../agent-api/portable';
import { MAX_AGENT_SESSIONS, NETWORK_JOIN_BUDGET } from '../../agent-api/admissionPolicy';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.useRealTimers(); vi.clearAllMocks(); });
function fixture() {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  const sql = { exec(query: string, ...args: any[]) {
    const statement = db.prepare(query);
    const rows = statement.all(...args);
    return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
  } };
  let identity = 0;
  const service = { ready: () => true, close: vi.fn(),
    provision: vi.fn(async () => ({ identity: (++identity).toString(16).padStart(64, '0'), token: 'character-token', uri: 'wss://test', database: 'test' })),
    renew: vi.fn(async () => {}), revoke: vi.fn(async () => {}), suspend: vi.fn(async () => {}),
    resume: vi.fn(async () => ({ state: () => ({ players: [] }), suspend: vi.fn(), close: vi.fn() })),
  };
  vi.mocked(createGameService).mockResolvedValue(service as any);
  const env: any = { GATEWAY_CREDENTIAL: JSON.stringify({ uri: 'wss://test', database: 'test' }), SPACETIME_URI: 'wss://test', SPACETIME_DB: 'test', PUBLIC_ORIGIN: 'https://game.test',
    EDGE_LIMIT: { limit: vi.fn(async () => ({ success: true })) }, ADMIN_TOKEN: 'operator-test' };
  const gateway = new AgentGateway({ storage: { sql, transactionSync: (fn: () => unknown) => fn(), setAlarm: vi.fn(), deleteAlarm: vi.fn(), sync: vi.fn() } } as any, env);
  env.AGENT_GATEWAY = { idFromName: () => 'test', get: () => gateway };
  const request = (path: string, token?: string, ip = '192.0.2.1', method = 'POST') => worker.fetch(new Request(`https://game.test${path}`, {
    method, headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(method === 'POST' ? { body: '{}' } : {}),
  }), env);
  const join = async (kind = 'play') => {
    const response = await request(`/api/${kind}/v1/sessions`);
    expect(response.status, await response.clone().text()).toBe(201);
    return await response.json() as any;
  };
  return { db, sql, service, env, request, join, gateway };
}

describe('hosted LAN admission', () => {
  it('admits 256 distinct browser characters on one public IP, including after the old daily budgets', async () => {
    const f = fixture();
    const day = new Date().toISOString().slice(0, 10);
    f.sql.exec('INSERT INTO daily (day,joins,requests) VALUES (?,100,50000)', day);
    const ids = new Set<string>();
    for (let i = 0; i < 256; i++) ids.add((await f.join()).playerId);
    expect(ids.size).toBe(256);
    expect(f.service.provision).toHaveBeenCalledTimes(256);
  });

  it('preserves renewal traffic when one LAN exhausts its new-character budget', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const f = fixture(); const player = await f.join();
    for (let i = 1; i < NETWORK_JOIN_BUDGET.burst; i++) await f.join();
    expect((await f.request('/api/play/v1/sessions')).status).toBe(429);
    const response = await f.request('/api/play/v1/renewals', player.renewToken);
    expect(response.status).toBe(200);
    expect(f.service.renew).toHaveBeenCalledWith(player.playerId, 3600, false);
  });

  it('holds an idle-logged-out character until its player returns with resume', async () => {
    const f = fixture(), player = await f.join();
    const renew = (token: string, body: string) => worker.fetch(new Request('https://game.test/api/play/v1/renewals', { method: 'POST', body,
      headers: { 'CF-Connecting-IP': '192.0.2.1', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }), f.env);
    f.service.renew.mockRejectedValueOnce(new Error('SenderError: logged out for inactivity'));
    const held = await renew(player.renewToken, '{}');
    expect(held.status).toBe(409);
    expect((await held.json() as any).error.code).toBe('idle_logout');
    expect((await renew(player.renewToken, '{"resume":"yes"}')).status).toBe(400);
    const back = await renew(player.renewToken, '{"resume":true}');
    expect(back.status, await back.clone().text()).toBe(200);
    expect(f.service.renew).toHaveBeenLastCalledWith(player.playerId, 3600, true);
  });

  it('limits renewal by character, leaving other people on the same LAN unaffected', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const f = fixture(), first = await f.join(), second = await f.join();
    let token = first.renewToken;
    for (let i = 0; i < 3; i++) {
      const r = await f.request('/api/play/v1/renewals', token); expect(r.status).toBe(200);
      token = (await r.json() as any).renewToken;
    }
    const limited = await f.request('/api/play/v1/renewals', token);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await f.request('/api/play/v1/renewals', second.renewToken)).status).toBe(200);
  });

  it('reports actual world fullness and preserves a returning character for retry', async () => {
    const f = fixture(), player = await f.join();
    f.service.renew.mockRejectedValueOnce(new Error('world is full'));
    const full = await f.request('/api/play/v1/renewals', player.renewToken);
    expect(full.status).toBe(429); expect(await full.json()).toMatchObject({ error: { code: 'world_full' } });
    expect(f.sql.exec('SELECT * FROM renewals WHERE key = ?', digest(player.renewToken)).toArray()).toHaveLength(1);
    expect((await f.request('/api/play/v1/renewals', player.renewToken)).status).toBe(200);
  });

  it('bounds agent sockets without a shared-IP session cap', async () => {
    const f = fixture();
    for (let i = 0; i < MAX_AGENT_SESSIONS; i++) await f.join('agent');
    const full = await f.request('/api/agent/v1/sessions');
    expect(full.status).toBe(429); expect(await full.json()).toMatchObject({ error: { code: 'agent_capacity' } });
    await f.join(); // agent connections do not consume browser sign-in capacity
  });

  it('uses distinct edge budgets for distinct credentials on a shared network', async () => {
    const f = fixture(), a = await f.join(), b = await f.join();
    await f.request('/api/play/v1/renewals', a.renewToken);
    await f.request('/api/play/v1/renewals', b.renewToken);
    const keys = f.env.EDGE_LIMIT.limit.mock.calls.slice(-2).map(([arg]: any) => arg.key);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).not.toContain(a.renewToken);
  });

  it('does not revoke a renewal racing with cleanup of its old expired visit', async () => {
    const f = fixture(), a = await f.join();
    f.sql.exec('UPDATE sessions SET expires_at = ?', Date.now() - 1);
    await f.gateway.alarm();
    const response = await f.request('/api/play/v1/renewals', a.renewToken);
    expect(response.status).toBe(200);
    expect(f.service.revoke).not.toHaveBeenCalled();
  });
});

it('reserves pending agent slots before awaiting an upstream connection', async () => {
  const f = fixture();
  for (let i = 0; i < MAX_AGENT_SESSIONS - 1; i++) await f.join('agent');
  let release!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  f.service.provision.mockImplementationOnce(async () => {
    await paused; return { identity: 'f'.repeat(64), token: 'pending', uri: 'wss://test', database: 'test' };
  });
  const pending = f.request('/api/agent/v1/sessions');
  try {
    await vi.waitFor(() => expect(f.sql.exec("SELECT * FROM sessions WHERE state = 'pending'").toArray()).toHaveLength(1));
    const full = await f.request('/api/agent/v1/sessions');
    expect(full.status).toBe(429); expect(await full.json()).toMatchObject({ error: { code: 'agent_capacity' } });
  } finally { release(); }
  expect((await pending).status).toBe(201);
});

it('reserves in-flight room for renewal during a simultaneous LAN join burst', async () => {
  const f = fixture(), player = await f.join();
  let release!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  let next = 1000;
  f.service.provision.mockImplementation(async () => {
    const identity = (++next).toString(16).padStart(64, '0');
    await paused; return { identity, token: 'pending', uri: 'wss://test', database: 'test' };
  });
  const pending = Array.from({ length: 32 }, () => f.request('/api/play/v1/sessions'));
  try {
    await vi.waitFor(() => expect(f.sql.exec("SELECT * FROM sessions WHERE state = 'pending'").toArray()).toHaveLength(32));
    const busy = await f.request('/api/play/v1/sessions');
    expect(busy.status).toBe(429); expect(await busy.json()).toMatchObject({ error: { code: 'join_busy' } });
    expect((await f.request('/api/play/v1/renewals', player.renewToken)).status).toBe(200);
  } finally { release(); }
  expect((await Promise.all(pending)).every(response => response.status === 201)).toBe(true);
});

it('renews an active agent at socket capacity without disconnecting or surrendering its place', async () => {
  const f = fixture();
  const first = await f.join('agent');
  for (let i = 1; i < MAX_AGENT_SESSIONS; i++) await f.join('agent');
  const response = await f.request('/api/agent/v1/renewals', first.renewToken);
  expect(response.status).toBe(200);
  const renewed = await response.json() as any;
  expect(renewed.sessionId).toBe(first.sessionId);
  expect(renewed.token).not.toBe(first.token);
  expect(f.service.resume).toHaveBeenCalledTimes(MAX_AGENT_SESSIONS);
  expect(f.service.suspend).not.toHaveBeenCalled();
  for (const result of f.service.resume.mock.results) expect((await result.value).suspend).not.toHaveBeenCalled();
  expect(f.sql.exec('SELECT * FROM sessions WHERE key = ?', digest(first.token)).toArray()).toHaveLength(0);
  expect(f.sql.exec('SELECT * FROM sessions WHERE key = ?', digest(renewed.token)).toArray()).toHaveLength(1);
  expect((await f.request('/api/agent/v1/state', renewed.token, '192.0.2.1', 'GET')).status).toBe(200);
});

it('preserves an active agent session when the upstream renewal fails', async () => {
  const f = fixture(), player = await f.join('agent');
  f.service.renew.mockRejectedValueOnce(new Error('upstream unavailable'));
  expect((await f.request('/api/agent/v1/renewals', player.renewToken)).status).toBe(503);
  expect((await f.request('/api/agent/v1/state', player.token, '192.0.2.1', 'GET')).status).toBe(200);
  expect((await f.request('/api/agent/v1/renewals', player.renewToken)).status).toBe(200);
});
