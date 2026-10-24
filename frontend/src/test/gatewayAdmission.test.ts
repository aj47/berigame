// @vitest-environment node
import type { DatabaseSync } from 'node:sqlite';
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
import { agentSessionCapacity, MAX_AGENT_SESSIONS_PER_SHARD, NETWORK_JOIN_BUDGET } from '../../agent-api/admissionPolicy';
import { gatewayObjects } from './gatewayObjects';

/** Two session shards keep the capacity tests small (2 x 250). */
const SHARDS = 2;
const MAX_AGENT_SESSIONS = agentSessionCapacity(SHARDS);

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.useRealTimers(); vi.clearAllMocks(); });
function fixture(shards = String(SHARDS)) {
  let identity = 0;
  const service = { ready: () => true, close: vi.fn(),
    provision: vi.fn(async () => ({ identity: (++identity).toString(16).padStart(64, '0'), token: 'character-token', uri: 'wss://test', database: 'test' })),
    renew: vi.fn(async () => {}), revoke: vi.fn(async () => {}), suspend: vi.fn(async () => {}),
    verifyCredential: vi.fn(async () => {}), attestRecovery: vi.fn(async () => {}),
    resume: vi.fn(async () => ({ state: () => ({ players: [] }), suspend: vi.fn(), close: vi.fn() })),
  };
  vi.mocked(createGameService).mockResolvedValue(service as any);
  const env: any = { GATEWAY_CREDENTIAL: JSON.stringify({ uri: 'wss://test', database: 'test' }), SPACETIME_URI: 'wss://test', SPACETIME_DB: 'test', PUBLIC_ORIGIN: 'https://game.test',
    EDGE_LIMIT: { limit: vi.fn(async () => ({ success: true })) }, ADMIN_TOKEN: 'operator-test', AGENT_SHARDS: shards };
  const objects = gatewayObjects(AgentGateway, env, databases);
  const { gateway, sql } = objects.home;
  const request = (path: string, token?: string, ip = '192.0.2.1', method = 'POST') => worker.fetch(new Request(`https://game.test${path}`, {
    method, headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(method === 'POST' ? { body: '{}' } : {}),
  }), env);
  const join = async (kind = 'play') => {
    const response = await request(`/api/${kind}/v1/sessions`);
    expect(response.status, await response.clone().text()).toBe(201);
    return await response.json() as any;
  };
  /** Joins `count` agents half a second apart, so the join budgets refill past their 256-request bursts. */
  const joinAgents = async (count: number) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const players = [];
    for (let i = 0; i < count; i++) { players.push(await join('agent')); vi.setSystemTime(Date.now() + 500); }
    return players;
  };
  return { sql, service, env, request, join, joinAgents, gateway, objects };
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
    await f.joinAgents(MAX_AGENT_SESSIONS);
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
  await f.joinAgents(MAX_AGENT_SESSIONS - 1);
  let release!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  f.service.provision.mockImplementationOnce(async () => {
    await paused; return { identity: 'f'.repeat(64), token: 'pending', uri: 'wss://test', database: 'test' };
  });
  const pending = f.request('/api/agent/v1/sessions');
  try {
    await vi.waitFor(() => expect(f.objects.all("SELECT * FROM sessions WHERE state = 'pending'")).toHaveLength(1));
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
  const [first] = await f.joinAgents(MAX_AGENT_SESSIONS);
  const response = await f.request('/api/agent/v1/renewals', first.renewToken);
  expect(response.status).toBe(200);
  const renewed = await response.json() as any;
  expect(renewed.sessionId).toBe(first.sessionId);
  expect(renewed.token).not.toBe(first.token);
  expect(f.service.resume).toHaveBeenCalledTimes(MAX_AGENT_SESSIONS);
  expect(f.service.suspend).not.toHaveBeenCalled();
  for (const result of f.service.resume.mock.results) expect((await result.value).suspend).not.toHaveBeenCalled();
  expect(f.objects.all('SELECT * FROM sessions WHERE key = ?', digest(first.token))).toHaveLength(0);
  expect(f.objects.all('SELECT * FROM sessions WHERE key = ?', digest(renewed.token))).toHaveLength(1);
  expect(renewed.token[4]).toBe(first.token[4]); // same shard
  expect((await f.request('/api/agent/v1/state', renewed.token, '192.0.2.1', 'GET')).status).toBe(200);
});

it('preserves an active agent session when the upstream renewal fails', async () => {
  const f = fixture(), player = await f.join('agent');
  f.service.renew.mockRejectedValueOnce(new Error('upstream unavailable'));
  expect((await f.request('/api/agent/v1/renewals', player.renewToken)).status).toBe(503);
  expect((await f.request('/api/agent/v1/state', player.token, '192.0.2.1', 'GET')).status).toBe(200);
  expect((await f.request('/api/agent/v1/renewals', player.renewToken)).status).toBe(200);
});

describe('agent session shards', () => {
  const SLOTS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const shardSql = (f: ReturnType<typeof fixture>, token: string) => f.objects.objects.get(`beta-v1/agents/${SLOTS.indexOf(token[4])}`)!.sql;

  it('hosts agent sessions in the shard their token names, never in the coordinator', async () => {
    const f = fixture();
    const players = [];
    for (let i = 0; i < 12; i++) players.push(await f.join('agent'));
    expect(f.sql.exec("SELECT * FROM sessions WHERE kind = 'agent'").toArray()).toHaveLength(0);
    expect(f.objects.shards().length).toBeGreaterThan(0);
    for (const player of players) {
      expect(player.token).toMatch(/^bgs_[A-Za-z0-9_-]{43}$/);
      expect(SLOTS.indexOf(player.token[4])).toBeLessThan(SHARDS);
      expect(shardSql(f, player.token).exec('SELECT * FROM sessions WHERE key = ?', digest(player.token)).toArray()).toHaveLength(1);
      expect((await f.request('/api/agent/v1/state', player.token, '192.0.2.1', 'GET')).status).toBe(200);
      const renewal = f.sql.exec('SELECT config FROM renewals WHERE identity = ?', player.playerId).toArray()[0] as any;
      expect(JSON.parse(renewal.config).slot).toBe(SLOTS.indexOf(player.token[4]));
    }
    const gone = await f.request('/api/agent/v1/session', players[0].token, '192.0.2.1', 'DELETE');
    expect(gone.status).toBe(204);
    expect((await f.service.resume.mock.results[0].value as any).suspend).toHaveBeenCalledTimes(1);
    expect(f.service.revoke).not.toHaveBeenCalled();
  });

  it('keeps every agent session in the coordinator when AGENT_SHARDS is 0', async () => {
    const f = fixture('0'), player = await f.join('agent');
    expect(f.sql.exec("SELECT * FROM sessions WHERE kind = 'agent'").toArray()).toHaveLength(1);
    expect(f.objects.shards()).toHaveLength(0);
    expect((await f.request('/api/agent/v1/state', player.token, '192.0.2.1', 'GET')).status).toBe(200);
    const renewed = await f.request('/api/agent/v1/renewals', player.renewToken);
    expect(renewed.status).toBe(200);
    expect((await f.request('/api/agent/v1/state', (await renewed.json() as any).token, '192.0.2.1', 'GET')).status).toBe(200);
    expect(f.objects.shards()).toHaveLength(0);
  });

  it('moves a session from before sharding into a shard when the agent renews', async () => {
    const f = fixture('0'), player = await f.join('agent');
    f.env.AGENT_SHARDS = String(SHARDS);
    expect((await f.request('/api/agent/v1/state', player.token, '192.0.2.1', 'GET')).status).toBe(401);
    const response = await f.request('/api/agent/v1/renewals', player.renewToken);
    expect(response.status, await response.clone().text()).toBe(200);
    const renewed = await response.json() as any;
    expect(renewed.sessionId).toBe(player.sessionId);
    expect(f.sql.exec("SELECT * FROM sessions WHERE kind = 'agent'").toArray()).toHaveLength(0);
    expect(shardSql(f, renewed.token).exec('SELECT * FROM sessions WHERE key = ?', digest(renewed.token)).toArray()).toHaveLength(1);
    expect((await f.request('/api/agent/v1/state', renewed.token, '192.0.2.1', 'GET')).status).toBe(200);
    expect(f.service.revoke).not.toHaveBeenCalled();
  });

  it('accepts only ?map=1 on GET /state and passes it to the session', async () => {
    const f = fixture(), player = await f.join('agent');
    const session = await f.service.resume.mock.results[0].value as any;
    session.state = vi.fn(() => ({ players: [] }));
    expect((await f.request('/api/agent/v1/state?map=1', player.token, '192.0.2.1', 'GET')).status).toBe(200);
    expect(session.state).toHaveBeenLastCalledWith({ map: true });
    expect((await f.request('/api/agent/v1/state', player.token, '192.0.2.1', 'GET')).status).toBe(200);
    expect(session.state).toHaveBeenLastCalledWith({ map: false });
    expect((await f.request('/api/agent/v1/state?map=0', player.token, '192.0.2.1', 'GET')).status).toBe(404);
    expect((await f.request('/api/agent/v1/danger?map=1', player.token, '192.0.2.1', 'GET')).status).toBe(404);
  });

  it('ignores a shard header sent by the client', async () => {
    const f = fixture('0'), player = await f.join('agent');
    f.env.AGENT_SHARDS = String(SHARDS);
    // A pre-sharding token whose slot character is beyond the shard count reaches the coordinator; a forged header
    // must not make the coordinator serve it as a host.
    const legacy = await worker.fetch(new Request('https://game.test/api/agent/v1/state', { headers: { 'CF-Connecting-IP': '192.0.2.1',
      Authorization: `Bearer ${player.token}`, 'X-BeriGame-Shard': '0' } }), f.env);
    expect(legacy.status).toBe(401);
  });

  it('admin revoke ends an agent session in its shard', async () => {
    const f = fixture(), player = await f.join('agent');
    const response = await worker.fetch(new Request('https://game.test/api/admin/revoke', { method: 'POST', body: JSON.stringify({ sessionId: player.sessionId }),
      headers: { 'CF-Connecting-IP': '192.0.2.1', 'Content-Type': 'application/json', Authorization: 'Bearer operator-test' } }), f.env);
    expect(response.status).toBe(204);
    expect(f.objects.all('SELECT * FROM sessions WHERE id = ?', player.sessionId)).toHaveLength(0);
    expect(f.service.revoke).toHaveBeenCalledWith(player.playerId);
    expect((await f.request('/api/agent/v1/state', player.token, '192.0.2.1', 'GET')).status).toBe(401);
  });

  it('exports a recovery key with a live session token held by a shard', async () => {
    const f = fixture(), player = await f.join('agent');
    const response = await f.request('/api/agent/v1/recovery', player.token);
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await response.json() as any).playerId).toBe(player.playerId);
    expect(f.service.attestRecovery).toHaveBeenCalledWith(player.playerId);
  });

  it('advertises the capacity of all shards and fills each to its own cap', async () => {
    const f = fixture();
    const discovery = await (await f.request('/api/agent/v1', undefined, '192.0.2.1', 'GET')).json() as any;
    expect(discovery.capacity.maxAgentSessions).toBe(MAX_AGENT_SESSIONS_PER_SHARD * SHARDS);
  });
});
