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

const databases: DatabaseSync[] = [];
const realFetch = globalThis.fetch;
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.clearAllMocks(); globalThis.fetch = realFetch; });

function fixture(config: Record<string, unknown> = {}) {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  const sql = { exec(query: string, ...args: any[]) {
    const rows = db.prepare(query).all(...args);
    return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
  } };
  let identity = 0;
  const service = { ready: () => true, close: vi.fn(),
    provision: vi.fn(async () => { const id = (++identity).toString(16).padStart(64, '0'); return { identity: id, token: `character-${id}`, uri: 'wss://test', database: 'test' }; }),
    renew: vi.fn(async () => {}), revoke: vi.fn(async () => {}), suspend: vi.fn(async () => {}),
    verifyCredential: vi.fn(async (credential: any) => { if (credential.token !== `character-${credential.identity}`) throw new Error('wrong token'); }),
    resume: vi.fn(async () => ({ state: () => ({ players: [] }), suspend: vi.fn(), close: vi.fn() })),
    attestRecovery: vi.fn(async () => {}),
  };
  vi.mocked(createGameService).mockResolvedValue(service as any);
  const email = { send: vi.fn(async (_message: any) => ({ messageId: 'm' })) };
  const env: any = { GATEWAY_CREDENTIAL: JSON.stringify({ uri: 'wss://test', database: 'test' }), SPACETIME_URI: 'wss://test', SPACETIME_DB: 'test', PUBLIC_ORIGIN: 'https://game.test',
    EDGE_LIMIT: { limit: vi.fn(async () => ({ success: true })) }, ADMIN_TOKEN: 'operator-test', EMAIL: email, EMAIL_FROM: 'login@game.test', ...config };
  const gateway = new AgentGateway({ storage: { sql, transactionSync: (fn: () => unknown) => fn(), setAlarm: vi.fn(), deleteAlarm: vi.fn(), sync: vi.fn() } } as any, env);
  env.AGENT_GATEWAY = { idFromName: () => 'test', get: () => gateway };
  const request = (path: string, { token, body, method = 'POST', ip = '192.0.2.1', cookie }: { token?: string; body?: unknown; method?: string; ip?: string; cookie?: string } = {}) =>
    worker.fetch(new Request(`https://game.test${path}`, {
      method, headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
    }), env);
  const join = async (kind = 'play') => (await (await request(`/api/${kind}/v1/sessions`)).json()) as any;
  const emailLogin = async (address: string, guest?: any, ip?: string) => {
    const start = await request('/api/play/v1/account/email/start', { ip, token: guest?.renewToken, body: { email: address, ...(guest ? { token: guest.token } : {}) } });
    expect(start.status, await start.clone().text()).toBe(200);
    const { requestId } = await start.json() as any;
    const text = email.send.mock.calls.at(-1)![0].text as string;
    const code = /enter this code in the game: (\d{6})/.exec(text)![1];
    expect(text).toContain(`https://game.test/play#login=${requestId}.${code}`);
    return { requestId, code, verify: (value = code) => request('/api/play/v1/account/email/verify', { ip, body: { requestId, code: value } }) };
  };
  return { db, sql, service, env, email, request, join, emailLogin };
}

describe('player accounts', () => {
  it('lists only the login methods that are configured', async () => {
    const f = fixture({ EMAIL: undefined, DISCORD_CLIENT_ID: 'd', DISCORD_CLIENT_SECRET: 's' });
    const response = await f.request('/api/play/v1/account/providers', { method: 'GET' });
    expect(await response.json()).toEqual({ discord: true, google: false, email: false, passkey: true });
  });

  it('saves a guest by email and plays the same character on another browser', async () => {
    const f = fixture(), guest = await f.join();
    const saving = await f.emailLogin('Player@Example.com', guest);
    const saved = await saving.verify();
    expect(saved.status, await saved.clone().text()).toBe(200);
    const { accountToken, account } = await saved.json() as any;
    expect(accountToken).toMatch(/^bgu_/);
    expect(account).toMatchObject({ playerId: guest.playerId, logins: [{ provider: 'email', label: 'p•••••@example.com' }] });
    expect(JSON.stringify(f.sql.exec('SELECT * FROM accounts').toArray())).not.toContain(guest.token);
    expect(JSON.stringify(f.sql.exec('SELECT * FROM account_logins').toArray())).not.toContain('player@');

    const other = await f.emailLogin('player@example.com', undefined, '198.51.100.7');
    const login = await (await other.verify()).json() as any;
    const play = await f.request('/api/play/v1/account/play', { token: login.accountToken, ip: '198.51.100.7' });
    const character = await play.json() as any;
    expect(character).toMatchObject({ token: guest.token, playerId: guest.playerId, uri: 'wss://test', database: 'test' });
    expect((await f.request('/api/play/v1/renewals', { token: character.renewToken, ip: '198.51.100.7' })).status).toBe(200);
    // The first browser's renewal was replaced; its account brings it back.
    expect((await f.request('/api/play/v1/renewals', { token: guest.renewToken })).status).toBe(401);
    expect((await f.request('/api/play/v1/account/play', { token: accountToken })).status).toBe(200);
  });

  it('never creates an account without a character, and rejects a forged character token', async () => {
    const f = fixture(), guest = await f.join();
    const response = await (await f.emailLogin('nobody@example.com')).verify();
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'no_account' } });
    const forged = await f.request('/api/play/v1/account/email/start', { token: guest.renewToken, body: { email: 'x@example.com', token: 'character-ffff' } });
    expect(forged.status).toBe(503);
    expect(f.sql.exec('SELECT * FROM accounts').toArray()).toHaveLength(0);
  });

  it('limits wrong email codes and consumes a code once', async () => {
    const f = fixture(), guest = await f.join();
    const attempt = await f.emailLogin('a@example.com', guest);
    for (let i = 0; i < 4; i++) expect(await (await attempt.verify('000000' === attempt.code ? '111111' : '000000')).json()).toMatchObject({ error: { code: 'wrong_code' } });
    expect((await attempt.verify('000000' === attempt.code ? '111111' : '000000')).status).toBe(401);
    expect(await (await attempt.verify()).json()).toMatchObject({ error: { code: 'login_expired' } });
    const second = await f.emailLogin('a@example.com', guest);
    expect((await second.verify()).status).toBe(200);
    expect((await second.verify()).status).toBe(401);
  });

  it('rate limits login emails per address', async () => {
    const f = fixture();
    for (let i = 0; i < 3; i++) await f.request('/api/play/v1/account/email/start', { body: { email: 'spam@example.com' }, ip: `192.0.2.${i + 10}` });
    const limited = await f.request('/api/play/v1/account/email/start', { body: { email: 'SPAM@example.com' }, ip: '192.0.2.99' });
    expect(limited.status).toBe(429);
    expect(f.email.send).toHaveBeenCalledTimes(3);
  });

  it('saves with Discord through a cookie-bound state and returns the token only to that browser', async () => {
    const f = fixture({ DISCORD_CLIENT_ID: 'client', DISCORD_CLIENT_SECRET: 'secret' }), guest = await f.join();
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/oauth2/token')) return Response.json({ access_token: 'discord-access', token_type: 'Bearer', expires_in: 600 });
      if (url.endsWith('/users/@me')) return Response.json({ id: '4242', username: 'berifan', global_name: 'Beri Fan' });
      throw new Error(`unexpected fetch ${url}`);
    }) as any;
    const start = await f.request('/api/play/v1/account/oauth/start', { token: guest.renewToken, body: { provider: 'discord', token: guest.token } });
    expect(start.status, await start.clone().text()).toBe(200);
    const cookie = start.headers.get('Set-Cookie')!.split(';')[0];
    expect(start.headers.get('Set-Cookie')).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    const authorize = new URL((await start.json() as any).url);
    expect(authorize.origin).toBe('https://discord.com');
    expect(authorize.searchParams.get('redirect_uri')).toBe('https://game.test/api/play/v1/account/oauth/discord/callback');
    const state = authorize.searchParams.get('state')!;

    expect((await f.request('/api/play/v1/account/oauth/finish', { cookie })).status).toBe(409);
    const stranger = await f.request(`/api/play/v1/account/oauth/discord/callback?code=abc&state=${state}`, { method: 'GET' });
    expect(stranger.status).toBe(303);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const callback = await f.request(`/api/play/v1/account/oauth/discord/callback?code=abc&state=${state}`, { method: 'GET', cookie });
    expect(callback.status).toBe(303);
    expect(callback.headers.get('Location')).toBe('/play#account');
    const finish = await f.request('/api/play/v1/account/oauth/finish', { cookie });
    expect(finish.status, await finish.clone().text()).toBe(200);
    expect(finish.headers.get('Set-Cookie')).toMatch(/Max-Age=0/);
    expect(await finish.json()).toMatchObject({ account: { playerId: guest.playerId, logins: [{ provider: 'discord', label: 'Beri Fan' }] } });
    expect((await f.request('/api/play/v1/account/oauth/finish', { cookie })).status).toBe(401);
    expect((await f.request('/api/play/v1/account/providers?x=1', { method: 'GET' })).status).toBe(404);
  });

  it('manages logins and forgets a revoked character', async () => {
    const f = fixture(), guest = await f.join();
    const { accountToken } = await (await (await f.emailLogin('one@example.com', guest)).verify()).json() as any;
    const added = await (await f.emailLogin('two@example.com', { renewToken: accountToken })).verify();
    const account = (await added.json() as any).account;
    expect(account.logins).toHaveLength(2);
    const removed = await f.request('/api/play/v1/account/logins/remove', { token: accountToken, body: { id: account.logins[0].id } });
    expect((await removed.json() as any).logins).toHaveLength(1);
    const last = await f.request('/api/play/v1/account/logins/remove', { token: accountToken, body: { id: account.logins[1].id } });
    expect(await last.json()).toMatchObject({ error: { code: 'last_login' } });

    await f.request('/api/admin/revoke', { token: 'operator-test', body: { sessionId: guest.sessionId } });
    expect(await (await f.request('/api/play/v1/account/play', { token: accountToken })).json()).toMatchObject({ error: { code: 'no_character' } });
    expect((await f.request('/api/play/v1/account/logout', { token: accountToken })).status).toBe(204);
    expect((await f.request('/api/play/v1/account', { token: accountToken, method: 'GET' })).status).toBe(401);
  });

  it('issues passkey challenges for this site only, registering only with a character or account', async () => {
    const f = fixture(), guest = await f.join();
    const login = await (await f.request('/api/play/v1/account/passkey/options', { body: { mode: 'login' } })).json() as any;
    expect(login.challengeId).toMatch(/^bgp_/);
    expect(login.options).toMatchObject({ rpId: 'game.test', userVerification: 'preferred' });
    expect((await f.request('/api/play/v1/account/passkey/options', { body: { mode: 'register' } })).status).toBe(400);
    const register = await (await f.request('/api/play/v1/account/passkey/options', { token: guest.renewToken, body: { mode: 'register', token: guest.token } })).json() as any;
    expect(register.options).toMatchObject({ rp: { id: 'game.test', name: 'BeriGame' }, authenticatorSelection: { residentKey: 'required' } });
    const bogus = await f.request('/api/play/v1/account/passkey/verify', { body: { challengeId: register.challengeId, response: JSON.stringify({ id: 'abc', response: {} }) } });
    expect(await bogus.json()).toMatchObject({ error: { code: 'passkey_rejected' } });
    expect(f.sql.exec('SELECT * FROM accounts').toArray()).toHaveLength(0);
  });

  it('keeps agents persistent through the API alone: no account, email or provider needed', async () => {
    // No login method configured at all.
    const f = fixture({ EMAIL: undefined, EMAIL_FROM: undefined });
    const agent = await f.join('agent');
    expect(agent).toMatchObject({ token: expect.stringMatching(/^bgs_/), renewToken: expect.stringMatching(/^bgr_/) });

    // Leave, then return to the same character with the rotating renew token.
    expect((await f.request('/api/agent/v1/session', { token: agent.token, method: 'DELETE' })).status).toBe(204);
    const returned = await (await f.request('/api/agent/v1/renewals', { token: agent.renewToken })).json() as any;
    expect(returned).toMatchObject({ playerId: agent.playerId, token: expect.stringMatching(/^bgs_/) });

    // Long-term persistence: export a recovery key, lose every token, recover, renew.
    const exported = await f.request('/api/agent/v1/recovery', { token: returned.token });
    expect(exported.status, await exported.clone().text()).toBe(200);
    const { recoveryToken } = await exported.json() as any;
    const recovered = await (await f.request('/api/agent/v1/recover', { token: recoveryToken })).json() as any;
    expect(recovered).toMatchObject({ playerId: agent.playerId, renewToken: expect.stringMatching(/^bgr_/) });
    const resumed = await (await f.request('/api/agent/v1/renewals', { token: recovered.renewToken })).json() as any;
    expect(resumed.playerId).toBe(agent.playerId);

    // Agent credentials are never turned into browser accounts.
    const save = await f.request('/api/play/v1/account/passkey/options', { token: resumed.renewToken, body: { mode: 'register', token: 'character-x' } });
    expect(await save.json()).toMatchObject({ error: { code: 'browser_only' } });
    expect((await f.request('/api/play/v1/account', { token: resumed.token, method: 'GET' })).status).toBe(401);
    expect(f.sql.exec('SELECT * FROM accounts').toArray()).toHaveLength(0);
  });
});
