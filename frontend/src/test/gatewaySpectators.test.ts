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
import { JOIN_BUDGET, WATCH_PASS_BUDGET } from '../../agent-api/admissionPolicy';
import { gatewayObjects } from './gatewayObjects';

// /watch passes on the Worker (docs/SPECTATOR.md): fail closed without a key, and never spend the players' join budgets.
const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.useRealTimers(); vi.clearAllMocks(); });

function fixture(watchKey?: string) {
  let identity = 0;
  const service = { ready: () => true, close: vi.fn(),
    provision: vi.fn(async () => ({ identity: (++identity).toString(16).padStart(64, '0'), token: 'character-token', uri: 'wss://test', database: 'test' })),
    spectate: vi.fn(async () => ({ identity: 'f'.repeat(64), token: 'viewer-token', uri: 'wss://test', database: 'test', expiresAt: '2030-01-01T00:00:00.000Z' })),
    renew: vi.fn(async () => {}), revoke: vi.fn(async () => {}), suspend: vi.fn(async () => {}),
    verifyCredential: vi.fn(async () => {}), attestRecovery: vi.fn(async () => {}),
    resume: vi.fn(async () => ({ state: () => ({ players: [] }), suspend: vi.fn(), close: vi.fn() })),
  };
  vi.mocked(createGameService).mockResolvedValue(service as any);
  const env: any = { GATEWAY_CREDENTIAL: JSON.stringify({ uri: 'wss://test', database: 'test' }), SPACETIME_URI: 'wss://test', SPACETIME_DB: 'test', PUBLIC_ORIGIN: 'https://game.test',
    EDGE_LIMIT: { limit: vi.fn(async () => ({ success: true })) }, ADMIN_TOKEN: 'operator-test', AGENT_SHARDS: '2', ...(watchKey ? { WATCH_KEY: watchKey } : {}) };
  gatewayObjects(AgentGateway, env, databases);
  const pass = (key?: string, ip = '192.0.2.1') => worker.fetch(new Request('https://game.test/api/agent/v1/spectators', {
    method: 'POST', headers: { 'CF-Connecting-IP': ip, Origin: 'https://obs.example', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
  }), env);
  const join = (ip = '192.0.2.1') => worker.fetch(new Request('https://game.test/api/play/v1/sessions', {
    method: 'POST', headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' }, body: '{}',
  }), env);
  return { service, env, pass, join };
}

describe('/watch passes on the Worker', () => {
  it('fails closed when WATCH_KEY is unset', async () => {
    const f = fixture();
    const response = await f.pass();
    expect(response.status).toBe(403);
    expect(((await response.json()) as any).error.code).toBe('watch_disabled');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect((await f.pass('guess')).status).toBe(403);
    expect(f.service.spectate).not.toHaveBeenCalled();
  });

  it('refuses a wrong key before any budget, so key spam cannot block player joins', async () => {
    const f = fixture('secret-key');
    for (let i = 0; i < JOIN_BUDGET.burst + 20; i++) expect((await f.pass('wrong-key')).status).toBe(401);
    expect(f.env.EDGE_LIMIT.limit).not.toHaveBeenCalled();
    expect((await f.join()).status).toBe(201);
    expect((await f.pass('secret-key')).status).toBe(201);
    expect(f.service.spectate).toHaveBeenCalledTimes(1);
  });

  it('gives passes their own small per-address lane, apart from joins', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const f = fixture('secret-key');
    for (let i = 0; i < WATCH_PASS_BUDGET.burst; i++) expect((await f.pass('secret-key')).status, `pass ${i}`).toBe(201);
    const refused = await f.pass('secret-key');
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(60);
    // Another address, and players on this one, are unaffected.
    expect((await f.pass('secret-key', '192.0.2.9')).status).toBe(201);
    expect((await f.join()).status).toBe(201);
    vi.setSystemTime(Date.now() + Math.ceil(1000 / WATCH_PASS_BUDGET.perSecond));
    expect((await f.pass('secret-key')).status).toBe(201);
  });
});
