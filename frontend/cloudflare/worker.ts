import './codecs';
import { DurableObject } from 'cloudflare:workers';
import { timingSafeEqual } from 'node:crypto';
import { ACTIONS, openapi, validateAction, validateObject } from '../agent-api/contract';
import { ApiError, digest, secret, type Invite } from '../agent-api/portable';
import { createGameService, deadline, type Credential, type GameSession } from '../agent-api/game';
import { openCloudflareSocket } from './socket';

interface Env {
  ASSETS: Fetcher;
  AGENT_GATEWAY: DurableObjectNamespace<AgentGateway>;
  EDGE_LIMIT: RateLimit;
  PUBLIC_ORIGIN: string;
  SPACETIME_URI: string;
  SPACETIME_DB: string;
  GATEWAY_CREDENTIAL: string;
  ADMIN_TOKEN: string;
}
type Kind = 'agent' | 'human';
type SessionRow = { key: string; id: string; ip: string; kind: Kind; expires_at: number; last_seen: number;
  config: string; credential: string | null; state: 'pending' | 'active' | 'closing'; actions_count: number };
type Receipt = { fingerprint: string; status: number; body: string };
type Service = Awaited<ReturnType<typeof createGameService>>;
const PREFIX = '/api/agent/v1';
const IDLE_MS = 10 * 60_000;
const unavailable = () => new ApiError(503, 'world_unavailable', 'The island is unavailable. Retry shortly.');
const unauthorized = () => new ApiError(401, 'invalid_session', 'A valid, unexpired session bearer token is required.');
const errorBody = (error: ApiError) => ({ error: { code: error.code, message: error.message } });
function send(status: number, body?: unknown, retryAfter?: number) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    ...(body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
    ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
  } });
}
function bearer(request: Request) {
  const value = request.headers.get('Authorization');
  if (!value || !/^Bearer bg[isha]_[A-Za-z0-9_-]{43}$/.test(value)) throw unauthorized();
  return value.slice(7);
}
function isAdmin(request: Request, env: Env) {
  const value = request.headers.get('Authorization')?.slice(7) ?? '';
  return !!env.ADMIN_TOKEN && request.headers.get('Authorization')?.startsWith('Bearer ')
    && timingSafeEqual(Buffer.from(digest(value)), Buffer.from(digest(env.ADMIN_TOKEN)));
}
async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
    || ![null, 'identity'].includes(request.headers.get('Content-Encoding'))) {
    throw new ApiError(415, 'json_required', 'Send uncompressed application/json.');
  }
  if (Number(request.headers.get('Content-Length')) > 4096) throw new ApiError(413, 'body_too_large', 'JSON bodies are limited to 4096 bytes.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'invalid_json', 'Send a JSON object.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let size = 0;
  try {
    const text = await Promise.race([
      (async () => {
        const chunks: Uint8Array[] = [];
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > 4096) throw new ApiError(413, 'body_too_large', 'JSON bodies are limited to 4096 bytes.');
          chunks.push(next.value);
        }
        return Buffer.concat(chunks).toString('utf8');
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ApiError(408, 'body_timeout', 'Request body timed out.')), 3000); }),
    ]);
    try { return JSON.parse(text); } catch { throw new ApiError(400, 'invalid_json', 'Send a JSON object.'); }
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (url.search) throw new ApiError(404, 'not_found', 'Credentials belong in Authorization headers.');
      if (request.headers.get('Origin') && request.headers.get('Origin') !== env.PUBLIC_ORIGIN) {
        throw new ApiError(403, 'origin_not_allowed', 'Cross-origin browser requests are not allowed.');
      }
      if (![PREFIX, `${PREFIX}/`, `${PREFIX}/openapi.json`, `${PREFIX}/sessions`, `${PREFIX}/session`, `${PREFIX}/state`,
        '/api/play/v1/sessions', '/api/admin/invites', '/api/admin/revoke'].includes(url.pathname)
        && !Object.keys(ACTIONS).some(name => url.pathname === `${PREFIX}/actions/${name}`)) {
        throw new ApiError(404, 'not_found', 'Unknown endpoint. See /api/agent/v1/openapi.json.');
      }
      const publicRead = request.method === 'GET' && [PREFIX, `${PREFIX}/`, `${PREFIX}/openapi.json`].includes(url.pathname);
      if (url.pathname.startsWith('/api/admin/')) { if (!isAdmin(request, env)) throw unauthorized(); }
      else if (!publicRead) bearer(request);
      const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
      if (!(await env.EDGE_LIMIT.limit({ key: `berigame-beta:${ip}` })).success) {
        throw new ApiError(429, 'rate_limited', 'Slow down and honor Retry-After.', 60);
      }
      return await env.AGENT_GATEWAY.get(env.AGENT_GATEWAY.idFromName('beta-v1')).fetch(request);
    } catch (error) {
      const safe = error instanceof ApiError ? error : unavailable();
      return send(safe.status, errorBody(safe), safe.retryAfter);
    }
  },
};

/** One bounded coordinator stores admission and receipts; SpacetimeDB owns all game state. */
export class AgentGateway extends DurableObject<Env> {
  private service?: Service;
  private connecting?: Promise<Service>;
  private live = new Map<string, GameSession>();
  private opening = new Map<string, Promise<GameSession>>();
  private busy = new Set<string>();
  private reaping?: Promise<void>;
  private inflight = 0;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS invites (key TEXT PRIMARY KEY, kind TEXT NOT NULL, expires_at INTEGER NOT NULL, config TEXT NOT NULL)');
    sql.exec("CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, id TEXT NOT NULL, ip TEXT NOT NULL, kind TEXT NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, config TEXT NOT NULL, credential TEXT, state TEXT NOT NULL, actions_count INTEGER NOT NULL DEFAULT 0)");
    sql.exec('CREATE TABLE IF NOT EXISTS receipts (session_key TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, status INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (session_key, key))');
    sql.exec('CREATE TABLE IF NOT EXISTS buckets (key TEXT PRIMARY KEY, tokens REAL NOT NULL, updated INTEGER NOT NULL, expires_at INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS daily (day TEXT PRIMARY KEY, joins INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0)');
    sql.exec('CREATE INDEX IF NOT EXISTS buckets_expiry ON buckets(expires_at)');
  }
  private one<T extends Record<string, any>>(query: string, ...args: (string | number | null)[]): T | undefined {
    return this.ctx.storage.sql.exec<T>(query, ...args).toArray()[0];
  }
  private count(query: string, ...args: (string | number | null)[]) { return this.one<{ n: number }>(query, ...args)?.n ?? 0; }
  private take(key: string, capacity: number, perSecond: number, now: number) {
    const old = this.one<{ tokens: number; updated: number }>('SELECT tokens, updated FROM buckets WHERE key = ?', key);
    if (!old && this.count('SELECT COUNT(*) AS n FROM buckets') >= 10000) throw new ApiError(429, 'capacity', 'Request capacity reached.', 60);
    const tokens = old ? Math.min(capacity, old.tokens + Math.max(0, now - old.updated) * perSecond / 1000) : capacity;
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO buckets VALUES (?, ?, ?, ?)', key, Math.max(0, tokens - (tokens >= 1 ? 1 : 0)), now, now + 600_000);
    if (tokens < 1) throw new ApiError(429, 'rate_limited', 'Slow down and honor Retry-After.', Math.max(1, Math.ceil((1 - tokens) / perSecond)));
  }
  private async game(): Promise<Service> {
    if (this.service?.ready()) return this.service;
    if (this.connecting) return this.connecting;
    this.service?.close();
    this.service = undefined;
    this.connecting = (async () => {
      let credential: Credential;
      try { credential = JSON.parse(this.env.GATEWAY_CREDENTIAL); } catch { console.warn('Gateway credential encoding invalid'); throw unavailable(); }
      if (credential.uri !== this.env.SPACETIME_URI || credential.database !== this.env.SPACETIME_DB) { console.warn('Gateway world configuration mismatch'); throw unavailable(); }
      try { return this.service = await createGameService(credential, { webSocketFactory: openCloudflareSocket }); }
      catch (error) { console.warn('Gateway connection failed', error instanceof Error ? error.name : 'unknown'); throw error; }
    })();
    try { return await this.connecting; } finally { this.connecting = undefined; }
  }
  private async sessionGame(row: SessionRow) {
    const existing = this.live.get(row.key);
    if (existing) return existing;
    let opening = this.opening.get(row.key);
    if (!opening) {
      opening = (async () => {
        if (!row.credential) throw unauthorized();
        const session = await (await this.game()).resume(JSON.parse(row.config), JSON.parse(row.credential));
        if (!this.one("SELECT key FROM sessions WHERE key = ? AND state = 'active'", row.key)) {
          await session.close();
          throw unauthorized();
        }
        this.live.set(row.key, session);
        return session;
      })();
      this.opening.set(row.key, opening);
    }
    try { return await opening; } finally { this.opening.delete(row.key); }
  }
  private purge(key: string) {
    this.ctx.storage.sql.exec('DELETE FROM receipts WHERE session_key = ?', key);
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE key = ?', key);
    this.ctx.storage.sql.exec('DELETE FROM buckets WHERE key IN (?, ?)', `read:${key}`, `action:${key}`);
  }
  private async remove(row: SessionRow) {
    this.ctx.storage.sql.exec("UPDATE sessions SET state = 'closing' WHERE key = ?", row.key);
    const live = this.live.get(row.key);
    this.live.delete(row.key);
    if (live) await live.close();
    if (row.credential && row.expires_at > Date.now()) {
      // Keep a closing record and retry on the alarm if Maincloud is unavailable.
      await (await this.game()).revoke((JSON.parse(row.credential) as Credential).identity);
    }
    this.purge(row.key);
  }
  private async reap() {
    if (this.reaping) return this.reaping;
    this.reaping = (async () => {
      const now = Date.now();
      const rows = this.ctx.storage.sql.exec<SessionRow>("SELECT * FROM sessions WHERE expires_at <= ? OR state = 'closing' OR (kind = 'agent' AND last_seen <= ?) OR (state = 'pending' AND last_seen <= ?)", now, now - IDLE_MS, now - 30_000).toArray();
      for (const row of rows) { try { await this.remove(row); } catch { /* Retry; the permit also expires in SpacetimeDB. */ } }
      this.ctx.storage.sql.exec('DELETE FROM invites WHERE expires_at <= ?', now);
      this.ctx.storage.sql.exec('DELETE FROM buckets WHERE expires_at <= ?', now);
      this.ctx.storage.sql.exec('DELETE FROM daily WHERE day < ?', new Date(now - 7 * 86400_000).toISOString().slice(0, 10));
    })();
    try { await this.reaping; } finally { this.reaping = undefined; }
  }
  private async rest() {
    if (this.inflight !== 0 || this.connecting || this.opening.size) return;
    if (this.count("SELECT COUNT(*) AS n FROM sessions WHERE kind = 'agent' AND state != 'closing'") === 0) {
      this.service?.close(); this.service = undefined;
    }
    if (this.count('SELECT COUNT(*) AS n FROM sessions')) await this.ctx.storage.setAlarm(Date.now() + 30_000);
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm() { await this.reap(); await this.rest(); }

  async fetch(request: Request): Promise<Response> {
    this.inflight++;
    try {
      if (this.inflight > 32) throw new ApiError(429, 'capacity', 'Request capacity reached.', 2);
      const now = Date.now();
      const path = new URL(request.url).pathname;
      const ip = digest(request.headers.get('CF-Connecting-IP') ?? 'local');
      this.take('global', 200, 20, now);
      this.take(`ip:${ip}`, 60, 2, now);
      await this.reap();
      const day = new Date(now).toISOString().slice(0, 10);
      this.ctx.storage.sql.exec('INSERT OR IGNORE INTO daily (day) VALUES (?)', day);
      if (path.startsWith('/api/admin/')) {
        if (!isAdmin(request, this.env)) throw unauthorized();
        if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed', 'Use POST.');
        const input = await readJson(request);
        if (path === '/api/admin/revoke') {
          const value = validateObject(input, { sessionId: { type: 'string', minLength: 36, maxLength: 36 } }, ['sessionId']);
          const row = this.one<SessionRow>('SELECT * FROM sessions WHERE id = ?', value.sessionId);
          if (row) await this.remove(row);
          return send(204);
        }
        const value = validateObject(input, { kind: { type: 'string', minLength: 5, maxLength: 5, enum: ['agent', 'human'] },
          combat: { type: 'integer', minimum: 0, maximum: 1 }, chat: { type: 'integer', minimum: 0, maximum: 1 } }, ['kind']);
        if (this.count('SELECT COUNT(*) AS n FROM invites') >= 256) throw new ApiError(429, 'invite_capacity', 'Unredeemed invite capacity reached.');
        const code = secret(value.kind === 'human' ? 'bgh_' : 'bgi_');
        const invite: Invite = { expiresAt: now + 86400_000, lifetimeSeconds: 3600, combat: !!value.combat, chat: !!value.chat };
        this.ctx.storage.sql.exec('INSERT INTO invites VALUES (?, ?, ?, ?)', digest(code), value.kind, invite.expiresAt, JSON.stringify(invite));
        return send(201, { code, kind: value.kind, expiresAt: new Date(invite.expiresAt).toISOString(), permissions: { combat: invite.combat, chat: invite.chat } });
      }
      if (this.count('SELECT requests AS n FROM daily WHERE day = ?', day) >= 50000) throw new ApiError(429, 'daily_capacity', 'The beta has reached its daily request budget. Try tomorrow.', 3600);
      this.ctx.storage.sql.exec('UPDATE daily SET requests = requests + 1 WHERE day = ?', day);
      if (request.method === 'GET' && [PREFIX, `${PREFIX}/`].includes(path)) {
        let ready = false;
        try { ready = (await this.game()).ready(); } catch { /* Public status is safe without credentials configured. */ }
        return send(200, { name: 'BeriGame', version: 1, ready, onboarding: '/agent', openapi: `${PREFIX}/openapi.json`,
          access: 'single-use invite', pollIntervalMs: 1000, actionIntervalMs: 1000, idleTimeoutSeconds: 600 });
      }
      if (path === `${PREFIX}/openapi.json` && request.method === 'GET') return send(200, openapi);
      if ([`${PREFIX}/sessions`, '/api/play/v1/sessions'].includes(path) && request.method === 'POST') {
        this.take(`join:${ip}`, 5, 1 / 60, now);
        const token = bearer(request);
        validateObject(await readJson(request), {}, []);
        const kind: Kind = path === '/api/play/v1/sessions' ? 'human' : 'agent';
        const invitation = this.one<{ config: string; kind: Kind; expires_at: number }>('SELECT * FROM invites WHERE key = ?', digest(token));
        if (!invitation || invitation.kind !== kind || invitation.expires_at <= now) throw new ApiError(401, 'invalid_invite', 'This invite is invalid, expired, already used, or intended for a different type of player.');
        if (this.count('SELECT COUNT(*) AS n FROM sessions WHERE kind = ?', kind) >= 16
          || this.count('SELECT COUNT(*) AS n FROM sessions WHERE ip = ?', ip) >= 4
          || this.count('SELECT joins AS n FROM daily WHERE day = ?', day) >= 100) {
          throw new ApiError(429, 'session_capacity', 'Player session capacity reached. Try later.', 60);
        }
        const service = await this.game();
        // Claim and reserve synchronously after the last await. Racing requests cannot reuse an invite or oversubscribe slots.
        if (!this.one('SELECT key FROM invites WHERE key = ?', digest(token))) throw new ApiError(401, 'invalid_invite', 'This invite has already been used.');
        if (this.count('SELECT COUNT(*) AS n FROM sessions WHERE kind = ?', kind) >= 16
          || this.count('SELECT COUNT(*) AS n FROM sessions WHERE ip = ?', ip) >= 4
          || this.count('SELECT joins AS n FROM daily WHERE day = ?', day) >= 100) throw new ApiError(429, 'session_capacity', 'Player session capacity reached. Try later.', 60);
        const sessionToken = secret('bgs_');
        const key = digest(sessionToken);
        const invite = JSON.parse(invitation.config) as Invite;
        const row: SessionRow = { key, id: crypto.randomUUID(), ip, kind, expires_at: now + invite.lifetimeSeconds * 1000,
          last_seen: now, config: invitation.config, credential: null, state: 'pending', actions_count: 0 };
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec('DELETE FROM invites WHERE key = ?', digest(token));
          this.ctx.storage.sql.exec('INSERT INTO sessions (key,id,ip,kind,expires_at,last_seen,config,state) VALUES (?,?,?,?,?,?,?,?)', key, row.id, ip, kind, row.expires_at, now, row.config, 'pending');
          this.ctx.storage.sql.exec('UPDATE daily SET joins = joins + 1 WHERE day = ?', day);
        });
        await this.ctx.storage.setAlarm(Date.now() + 30_000);
        try {
          const credential = await service.provision(invite);
          row.credential = JSON.stringify(credential);
          this.ctx.storage.sql.exec('UPDATE sessions SET credential = ? WHERE key = ?', row.credential, key);
          if (kind === 'agent') this.live.set(key, await service.resume(invite, credential));
          this.ctx.storage.sql.exec("UPDATE sessions SET state = 'active' WHERE key = ?", key);
          return send(201, { ...(kind === 'agent' ? { token: sessionToken } : { token: credential.token, uri: credential.uri, database: credential.database }),
            sessionId: row.id, playerId: credential.identity, expiresAt: new Date(row.expires_at).toISOString(),
            permissions: { combat: invite.combat, chat: invite.chat }, pollIntervalMs: 1000 });
        } catch (error) { try { await this.remove(row); } catch { /* Alarm retries revocation. */ } throw error; }
      }
      const token = bearer(request);
      if (!token.startsWith('bgs_')) throw unauthorized();
      const key = digest(token);
      const row = this.one<SessionRow>("SELECT * FROM sessions WHERE key = ? AND kind = 'agent' AND state = 'active'", key);
      if (!row || row.expires_at <= now || row.last_seen <= now - IDLE_MS) throw unauthorized();
      if (!this.busy.has(key) && this.count('SELECT COUNT(*) AS n FROM receipts WHERE session_key = ? AND status = 0', key)) {
        await this.remove(row);
        throw new ApiError(503, 'action_outcome_uncertain', 'The connection restarted during an action. This session has been closed to prevent a duplicate action.');
      }
      this.take(`read:${key}`, 10, 2, now);
      this.ctx.storage.sql.exec('UPDATE sessions SET last_seen = ? WHERE key = ?', now, key);
      if (path === `${PREFIX}/session` && request.method === 'DELETE') { await this.remove(row); return send(204); }
      if (path === `${PREFIX}/state` && request.method === 'GET') {
        try { return send(200, (await this.sessionGame(row)).state()); }
        catch (error) {
          if (error instanceof ApiError && error.status === 401) await this.remove(row);
          else { const stale = this.live.get(key); this.live.delete(key); if (stale) await stale.close(); await this.remove(row); }
          throw error;
        }
      }
      if (path.startsWith(`${PREFIX}/actions/`) && request.method === 'POST') {
        this.take(`action:${key}`, 4, 1, now);
        const action = path.slice(`${PREFIX}/actions/`.length);
        const input = validateAction(action, await readJson(request));
        const invite = JSON.parse(row.config) as Invite;
        const scope = ACTIONS[action].scope;
        if (scope && !invite[scope]) throw new ApiError(403, 'scope_required', `This invite does not allow ${scope}.`);
        const idempotencyKey = request.headers.get('Idempotency-Key');
        if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,80}$/.test(idempotencyKey)) throw new ApiError(400, 'idempotency_key_required', 'Use a unique Idempotency-Key of 16..80 letters, digits, hyphens or underscores per action.');
        const fingerprint = digest(JSON.stringify([action, Object.entries(input).sort(([a], [b]) => a.localeCompare(b))]));
        const prior = this.one<Receipt>('SELECT * FROM receipts WHERE session_key = ? AND key = ?', key, idempotencyKey);
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw new ApiError(409, 'idempotency_conflict', 'This key was used for a different action.');
          if (prior.status === 0) {
            if (this.busy.has(key)) throw new ApiError(409, 'action_in_progress', 'Wait, then retry with the same key.');
            await this.remove(row); throw new ApiError(503, 'action_outcome_uncertain', 'The connection restarted during an action. This session has been closed to prevent a duplicate action.');
          }
          return send(prior.status, JSON.parse(prior.body));
        }
        if (row.actions_count >= 1024) throw new ApiError(429, 'session_action_budget', 'This session has reached its action budget.');
        if (this.busy.has(key)) throw new ApiError(409, 'action_in_progress', 'Wait for the current action receipt.');
        this.busy.add(key);
        try {
          const game = await this.sessionGame(row);
          if (!this.one("SELECT key FROM sessions WHERE key = ? AND state = 'active'", key)) throw unauthorized();
          this.ctx.storage.sql.exec('INSERT INTO receipts VALUES (?, ?, ?, 0, ?)', key, idempotencyKey, fingerprint, '{}');
          this.ctx.storage.sql.exec('UPDATE sessions SET actions_count = actions_count + 1 WHERE key = ?', key);
          await this.ctx.storage.sync(); // Persist the intent before sending a game action.
          let status = 200;
          let body: unknown = { accepted: true, action, idempotencyKey, message: 'Read /state to observe the result.' };
          try { await deadline(game.action(action, input), 5000); }
          catch (error) {
            const safe = error instanceof ApiError ? error : new ApiError(422, 'action_rejected', 'The game rejected this action. Inspect state before trying again.');
            status = safe.status; body = errorBody(safe);
            if ([401, 503].includes(status)) { await this.remove(row); return send(status, body); }
          }
          this.ctx.storage.sql.exec('UPDATE receipts SET status = ?, body = ? WHERE session_key = ? AND key = ?', status, JSON.stringify(body), key, idempotencyKey);
          return send(status, body);
        } finally { this.busy.delete(key); }
      }
      throw new ApiError(404, 'not_found', 'Unknown endpoint or method. See openapi.json.');
    } catch (error) {
      const safe = error instanceof ApiError ? error : unavailable();
      return send(safe.status, errorBody(safe), safe.retryAfter);
    } finally { this.inflight--; await this.rest(); }
  }
}
