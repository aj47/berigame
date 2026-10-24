import { requestLane, agentSessionCapacity, agentShards, AGENT_ACTION_BUDGET, AGENT_ACTION_INTERVAL_MS, AGENT_POLL_INTERVAL_MS, AGENT_READ_BUDGET, MAX_AGENT_SESSIONS_PER_SHARD, MAX_SESSION_ACTIONS, REQUEST_BUDGET, JOIN_BUDGET, NETWORK_JOIN_BUDGET, RENEWAL_BUDGET, CHARACTER_RENEWAL_BUDGET } from '../agent-api/admissionPolicy';
import { IDLE_LOGOUT_MINUTES, MAX_ONLINE_PLAYERS, MAX_STORED_CHARACTERS } from '../../shared/sim/admission';
import { sealRecovery, openRecovery } from '../agent-api/recovery';
import './codecs';
import { DurableObject } from 'cloudflare:workers';
import { timingSafeEqual } from 'node:crypto';
import { ACTIONS, openapi, validateAction, validateObject } from '../agent-api/contract';
import { admissionError, ApiError, digest, secret, type Invite } from '../agent-api/portable';
import { createGameService, deadline, type Credential, type GameSession } from '../agent-api/game';
import { worldAtlas } from '../agent-api/worldAtlas';
import { openCloudflareSocket } from './socket';
import { bearer, errorBody, readJson, send, sendJsonText, unauthorized } from './http';
import { ACCOUNT_BASE, createAccountTables, forgetCharacter, handleAccount, isAccountPath, isOAuthCallback, reapAccounts, type AccountEnv } from './accounts';
import { issueRenewal, lookupRenewal, MAX_RENEWALS, RENEWAL_TTL_MS, renewalRefusal, renewedElsewhere, rotateRenewal, visitEnded, type RenewalRow, type RenewalStore } from '../agent-api/renewal';
import { HOME_GATEWAY, SHARD_HEADER, sessionPath, sessionToken, shardName, shardOf, slotForSession, tokenSlot } from './shards';
import { handleMcp, MCP_PATH, PLAYER_KEY_PREFIX, type PlayerTokens } from './mcp';
import { MCP_APP_HTML, MCP_ICON_SVG } from './mcpApp';

interface Env extends AccountEnv {
  ASSETS: Fetcher;
  AGENT_GATEWAY: DurableObjectNamespace<AgentGateway>;
  EDGE_LIMIT: RateLimit;
  PUBLIC_ORIGIN: string;
  SPACETIME_URI: string;
  SPACETIME_DB: string;
  GATEWAY_CREDENTIAL: string;
  RECOVERY_ENCRYPTION_KEY?: string;
  ADMIN_TOKEN: string;
  /** Agent session shards (Durable Objects of this class named beta-v1/agents/<n>); "0" keeps every session in beta-v1. */
  AGENT_SHARDS?: string;
}
type Kind = 'agent' | 'human';
type SessionRow = { key: string; id: string; ip: string; kind: Kind; expires_at: number; last_seen: number;
  config: string; credential: string | null; state: 'pending' | 'active' | 'closing'; actions_count: number };
type Receipt = { fingerprint: string; status: number; body: string };
/** An agent's renewal config: its invite terms, character credential and (sharded) the shard holding its session. */
type AgentRenewal = Invite & { kind: 'agent'; credential: Credential; slot?: number };
type Service = Awaited<ReturnType<typeof createGameService>>;
/** Shard RPC replies: Workers RPC does not carry ApiError fields, so failures travel as data. `forget` ends renewal. */
type Failure = { ok: false; status: number; code: string; message: string; retryAfter?: number; forget?: boolean };
type Result<T> = { ok: true; value: T } | Failure;
type Joined = { token: string; credential: Credential; expiresAt: number };
type Renewed = { token: string; expiresAt: number };
type HostedStat = { kind: string; state: string; n: number; actions: number };
type HostedSession = { kind: string; state: string; actions_count: number; last_seen: number; expires_at: number };
/** A session host: a shard, or the coordinator itself when unsharded. Both are this class. */
interface SessionHost {
  hostJoin(input: { id: string; ip: string; invite: Invite; slot: number | null }): Promise<Result<Joined>>;
  hostRenew(input: { sessionId: string; identity: string; ip: string; invite: Invite; credential: Credential; resume: boolean; slot: number | null }): Promise<Result<Renewed>>;
  hostEnd(input: { sessionId: string; mode: 'revoke' | 'suspend' }): Promise<Result<boolean>>;
  hostStats(now: number): Promise<HostedStat[]>;
  hostSessions(sessionId: string): Promise<HostedSession[]>;
  hostActiveSession(key: string): Promise<string | null>;
}
const forgetting = (error: ApiError) => Object.assign(error, { forget: true });
async function settle<T>(run: () => Promise<T>): Promise<Result<T>> {
  try { return { ok: true, value: await run() }; }
  catch (error) {
    const safe = admissionError(error) ?? new ApiError(503, 'world_unavailable', 'The island is unavailable. Retry shortly.');
    return { ok: false, status: safe.status, code: safe.code, message: safe.message, retryAfter: safe.retryAfter, forget: (error as { forget?: boolean })?.forget };
  }
}
function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw Object.assign(new ApiError(result.status, result.code, result.message, result.retryAfter), { forget: result.forget });
}
/** The Durable Object for a request: a session shard for a bgs_ bearer on a session path, otherwise the coordinator. */
function gatewayFor(env: Env, request: Request, path: string) {
  const slot = sessionPath(path) ? tokenSlot(request.headers.get('Authorization'), agentShards(env.AGENT_SHARDS)) : null;
  // Only the edge or the coordinator sets the shard header; a client's copy is dropped.
  const forwarded = new Request(request);
  forwarded.headers.delete(SHARD_HEADER);
  if (slot !== null) forwarded.headers.set(SHARD_HEADER, String(slot));
  return { stub: env.AGENT_GATEWAY.get(env.AGENT_GATEWAY.idFromName(slot === null ? HOME_GATEWAY : shardName(slot))), request: forwarded, slot };
}
const PREFIX = '/api/agent/v1';
/** Browser origins allowed to call /mcp (server-to-server MCP clients send none). */
const MCP_ORIGINS = ['https://chatgpt.com', 'https://chat.openai.com'];
const mcpError = (status: number, message: string) => new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }),
  { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const IDLE_MS = 10 * 60_000;
/** Renewal bodies: `resume: true` is the player choosing to return after an idle logout. */
const RESUME_BODY = { resume: { type: 'boolean' } } as const;
const unavailable = () => new ApiError(503, 'world_unavailable', 'The island is unavailable. Retry shortly.');
function playerRejection(error: unknown): string {
  const message = String(error instanceof Error ? error.message : error).replace(/^SenderError:\s*/, '').slice(0, 300);
  if (/access required or expired/.test(message)) return `This character is logged out: no game action for ${IDLE_LOGOUT_MINUTES} minutes, or its permit ended. POST ${PREFIX}/renewals with your renewToken and {"resume": true} to return.`;
  return /^(Needs |Walk |Put |Pick |The |This |That |You |Both |One |Finish |Change |Earn |Three |Visit |Four |Join |Choose |Catch |Pass |Ask |Equip |Fresh |No |They |Only |empty slot|still chewing|not a weapon|No fighting)/i.test(message) && !/token|credential|sql|stack|https?:/i.test(message)
    ? message : 'The game rejected this action. Inspect state before trying again.';
}
function isAdmin(request: Request, env: Env) {
  const value = request.headers.get('Authorization')?.slice(7) ?? '';
  return !!env.ADMIN_TOKEN && request.headers.get('Authorization')?.startsWith('Bearer ')
    && timingSafeEqual(Buffer.from(digest(value)), Buffer.from(digest(env.ADMIN_TOKEN)));
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === MCP_PATH) {
      const origin = request.headers.get('Origin');
      if (origin && origin !== env.PUBLIC_ORIGIN && !MCP_ORIGINS.includes(origin)) return mcpError(403, 'Cross-origin browser requests are not allowed.');
      // No edge limit here: chat hosts share a few egress addresses. The coordinator budgets each address and character.
      try { return await env.AGENT_GATEWAY.get(env.AGENT_GATEWAY.idFromName(HOME_GATEWAY)).fetch(request); }
      catch { return mcpError(503, 'The island is unavailable. Retry shortly.'); }
    }
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      const account = isAccountPath(url.pathname);
      // The one query accepted: GET /state?map=1 (world.map in state, kept for one release).
      const mapQuery = request.method === 'GET' && url.pathname === `${PREFIX}/state` && url.search === '?map=1';
      if (url.search && !mapQuery && !isOAuthCallback(url.pathname)) throw new ApiError(404, 'not_found', 'Credentials belong in Authorization headers.');
      if (request.headers.get('Origin') && request.headers.get('Origin') !== env.PUBLIC_ORIGIN) {
        throw new ApiError(403, 'origin_not_allowed', 'Cross-origin browser requests are not allowed.');
      }
      if (![PREFIX, `${PREFIX}/`, `${PREFIX}/openapi.json`, `${PREFIX}/world`, `${PREFIX}/sessions`, `${PREFIX}/renewals`, `${PREFIX}/session`, `${PREFIX}/state`, `${PREFIX}/danger`,
        '/api/play/v1/sessions', '/api/play/v1/renewals', '/api/play/v1/recovery', '/api/play/v1/recover', `${PREFIX}/recovery`, `${PREFIX}/recover`, '/api/admin/invites', '/api/admin/revoke', '/api/admin/stats', '/api/admin/player'].includes(url.pathname)
        && !account && !Object.keys(ACTIONS).some(name => url.pathname === `${PREFIX}/actions/${name}`)) {
        throw new ApiError(404, 'not_found', 'Unknown endpoint. See /api/agent/v1/openapi.json.');
      }
      const publicRead = request.method === 'GET' && [PREFIX, `${PREFIX}/`, `${PREFIX}/openapi.json`, `${PREFIX}/world`].includes(url.pathname);
      if (url.pathname.startsWith('/api/admin/')) { if (!isAdmin(request, env)) throw unauthorized(); }
      else if (!publicRead && !account && !(request.method === 'POST' && [ `${PREFIX}/sessions`, '/api/play/v1/sessions' ].includes(url.pathname))) bearer(request);
      const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
      // A shared network is not one player. Bearers are authenticated again in the coordinator.
      const credential = request.headers.get('Authorization');
      const edgeKey = credential ? `credential:${digest(credential)}` : `network:${ip}`;
      if (!(await env.EDGE_LIMIT.limit({ key: `berigame-beta:${edgeKey}` })).success) {
        throw new ApiError(429, 'rate_limited', 'Slow down and honor Retry-After.', 60);
      }
      const target = gatewayFor(env, request, url.pathname);
      return await target.stub.fetch(target.request);
    } catch (error) {
      const safe = admissionError(error) ?? unavailable();
      return send(safe.status, errorBody(safe), safe.retryAfter);
    }
  },
};

/**
 * One class, two roles. The coordinator (beta-v1) stores admission, invites, renewals, recoveries, accounts and MCP
 * keys; session hosts hold agent sessions, their sockets, receipts and budgets. With AGENT_SHARDS > 0 the hosts are
 * the shard objects (shards.ts); with 0 the coordinator hosts every session itself. SpacetimeDB owns all game state.
 */
export class AgentGateway extends DurableObject<Env> implements SessionHost {
  private service?: Service;
  private connecting?: Promise<Service>;
  private live = new Map<string, GameSession>();
  private opening = new Map<string, Promise<GameSession>>();
  private busy = new Set<string>();
  private reaping?: Promise<void>;
  private lastReaped = 0;
  private inflight = 0;
  private joining = 0;
  /** Identities whose renewal this object coordinates, and (as a session host) whose session it is renewing. */
  private renewing = new Set<string>();
  private hostRenewing = new Set<string>();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS recoveries (identity TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, expires_at INTEGER NOT NULL, session_id TEXT)');
    if (!sql.exec<{name:string}>('PRAGMA table_info(recoveries)').toArray().some(column => column.name === 'session_id')) sql.exec('ALTER TABLE recoveries ADD COLUMN session_id TEXT');
    sql.exec('CREATE INDEX IF NOT EXISTS recovery_session ON recoveries(session_id)');
    sql.exec('CREATE TABLE IF NOT EXISTS invites (key TEXT PRIMARY KEY, kind TEXT NOT NULL, expires_at INTEGER NOT NULL, config TEXT NOT NULL)');
    sql.exec("CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, id TEXT NOT NULL, ip TEXT NOT NULL, kind TEXT NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, config TEXT NOT NULL, credential TEXT, state TEXT NOT NULL, actions_count INTEGER NOT NULL DEFAULT 0)");
    sql.exec('CREATE INDEX IF NOT EXISTS sessions_kind ON sessions(kind)');
    sql.exec('CREATE INDEX IF NOT EXISTS sessions_id ON sessions(id)');
    sql.exec('CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at)');
    sql.exec('CREATE TABLE IF NOT EXISTS receipts (session_key TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, status INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (session_key, key))');
    sql.exec('CREATE TABLE IF NOT EXISTS buckets (key TEXT PRIMARY KEY, tokens REAL NOT NULL, updated INTEGER NOT NULL, expires_at INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS daily (day TEXT PRIMARY KEY, joins INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0)');
    sql.exec('CREATE INDEX IF NOT EXISTS buckets_expiry ON buckets(expires_at)');
    // Returning browsers (F1): token digests only, bound to one identity each. No IP or other personal data.
    sql.exec('CREATE TABLE IF NOT EXISTS renewals (key TEXT PRIMARY KEY, prev_key TEXT, prev_until INTEGER NOT NULL, identity TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL, config TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS renewals_prev ON renewals(prev_key)');
    sql.exec('CREATE INDEX IF NOT EXISTS renewals_session ON renewals(session_id)');
    createAccountTables(sql);
    // MCP player keys (bgm_): digest -> sealed session and renewal tokens, so a chat can return to its character.
    sql.exec('CREATE TABLE IF NOT EXISTS mcp_players (key TEXT PRIMARY KEY, payload TEXT NOT NULL, player_id TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS mcp_players_expiry ON mcp_players(expires_at)');
  }
  private one<T extends Record<string, any>>(query: string, ...args: (string | number | null)[]): T | undefined {
    return this.ctx.storage.sql.exec<T>(query, ...args).toArray()[0];
  }
  private renewals(): RenewalStore {
    const sql = this.ctx.storage.sql;
    return {
      byKey: key => this.one<RenewalRow>('SELECT * FROM renewals WHERE key = ?', key),
      byPrev: key => this.one<RenewalRow>('SELECT * FROM renewals WHERE prev_key = ?', key),
      count: () => this.count('SELECT COUNT(*) AS n FROM renewals'),
      put: row => { sql.exec('INSERT OR REPLACE INTO renewals VALUES (?, ?, ?, ?, ?, ?, ?)', row.key, row.prev_key, row.prev_until, row.identity, row.session_id, row.config, row.expires_at); },
      removeIdentity: identity => { sql.exec('DELETE FROM renewals WHERE identity = ?', identity); },
    };
  }
  private shards() { return agentShards(this.env.AGENT_SHARDS); }
  /** The coordinator itself (unsharded, slot null) or the shard object for a slot. */
  private host(slot: number | null): SessionHost {
    return slot === null ? this : this.env.AGENT_GATEWAY.get(this.env.AGENT_GATEWAY.idFromName(shardName(slot))) as unknown as SessionHost;
  }
  private sessionCapacity(kind: Kind) {
    // Browser visit records are credentials, not occupied world slots. The world
    // enforces connected characters atomically in clientConnected. Agent sessions are counted per host.
    const limit = kind === 'agent' ? MAX_AGENT_SESSIONS_PER_SHARD : MAX_STORED_CHARACTERS;
    if (this.count('SELECT COUNT(*) AS n FROM sessions WHERE kind = ?', kind) >= limit) {
      throw new ApiError(429, kind === 'agent' ? 'agent_capacity' : 'visit_capacity',
        kind === 'agent' ? 'All agent connections are in use. Try again after a session ends.' : 'The sign-in service is busy. Try again shortly.', 30);
    }
  }
  private takeRenewal(identity: string, now: number) {
    this.take(`renew:${identity}`, CHARACTER_RENEWAL_BUDGET.burst, CHARACTER_RENEWAL_BUDGET.perSecond, now);
  }
  private count(query: string, ...args: (string | number | null)[]) { return this.one<{ n: number }>(query, ...args)?.n ?? 0; }
  /** Admission-side numbers for the admin panel: live API sessions, joins, invites and sign-in accounts. No IPs or tokens. */
  private async gatewayStats(now: number) {
    const sql = this.ctx.storage.sql;
    const day = 86400_000;
    // Agent sessions live in the shards: add their counts to the coordinator's own (browser visits, legacy agents).
    const merged = new Map<string, HostedStat>();
    const hosted = await Promise.all([this.hostStats(now), ...Array.from({ length: this.shards() }, (_, slot) => this.host(slot).hostStats(now).catch(() => []))]);
    for (const row of hosted.flat()) {
      const key = `${row.kind}:${row.state}`, prior = merged.get(key);
      merged.set(key, prior ? { ...prior, n: prior.n + row.n, actions: (prior.actions ?? 0) + (row.actions ?? 0) } : { ...row });
    }
    return {
      sessions: [...merged.values()],
      shards: this.shards(),
      daily: sql.exec<{ day: string; joins: number; requests: number }>('SELECT * FROM daily ORDER BY day').toArray(),
      invites: sql.exec<{ kind: string; n: number }>('SELECT kind, COUNT(*) AS n FROM invites WHERE expires_at > ? GROUP BY kind', now).toArray(),
      renewals: this.count('SELECT COUNT(*) AS n FROM renewals WHERE expires_at > ?', now),
      accounts: {
        total: this.count('SELECT COUNT(*) AS n FROM accounts'),
        withCharacter: this.count('SELECT COUNT(*) AS n FROM accounts WHERE identity IS NOT NULL'),
        seen1d: this.count('SELECT COUNT(*) AS n FROM accounts WHERE seen_at > ?', now - day),
        seen7d: this.count('SELECT COUNT(*) AS n FROM accounts WHERE seen_at > ?', now - 7 * day),
        new7d: this.count('SELECT COUNT(*) AS n FROM accounts WHERE created_at > ?', now - 7 * day),
        byProvider: sql.exec<{ provider: string; n: number }>('SELECT provider, COUNT(*) AS n FROM account_logins GROUP BY provider').toArray(),
      },
    };
  }
  private take(key: string, capacity: number, perSecond: number, now: number) {
    const old = this.one<{ tokens: number; updated: number }>('SELECT tokens, updated FROM buckets WHERE key = ?', key);
    if (!old && this.count('SELECT COUNT(*) AS n FROM buckets') >= 10000) throw new ApiError(429, 'capacity', 'Request capacity reached.', 60);
    const tokens = old ? Math.min(capacity, old.tokens + Math.max(0, now - old.updated) * perSecond / 1000) : capacity;
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO buckets VALUES (?, ?, ?, ?)', key, Math.max(0, tokens - (tokens >= 1 ? 1 : 0)), now, now + 600_000);
    if (tokens < 1) throw new ApiError(429, 'rate_limited', 'Slow down and honor Retry-After.', Math.max(1, Math.ceil((1 - tokens) / perSecond)));
  }
  /**
   * The gateway's own socket. Session hosts (world) also hold the shared world cache their sessions read; a sharded
   * coordinator needs only the admission reducers, so it never downloads the world.
   */
  private async game(world = this.shards() === 0): Promise<Service> {
    if (this.service?.ready() && (this.service.world || !world)) return this.service;
    if (this.connecting) {
      const pending = await this.connecting;
      if (pending.world || !world) return pending;
    }
    this.service?.close();
    this.service = undefined;
    this.connecting = (async () => {
      let credential: Credential;
      try { credential = JSON.parse(this.env.GATEWAY_CREDENTIAL); } catch { console.warn('Gateway credential encoding invalid'); throw unavailable(); }
      if (credential.uri !== this.env.SPACETIME_URI || credential.database !== this.env.SPACETIME_DB) { console.warn('Gateway world configuration mismatch'); throw unavailable(); }
      try { return this.service = await createGameService(credential, { webSocketFactory: openCloudflareSocket, world }); }
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
        const session = await (await this.game(true)).resume(JSON.parse(row.config), JSON.parse(row.credential));
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
  /** Whether a closing agent may come back: shard-hosted sessions always (the coordinator owns the renewal). */
  private returning(row: SessionRow) {
    if (row.kind !== 'agent') return false;
    try { if ((JSON.parse(row.config) as { hosted?: boolean }).hosted) return true; } catch { /* Legacy config. */ }
    return !!this.one<RenewalRow>('SELECT * FROM renewals WHERE session_id = ?', row.id);
  }
  /** Ends a session: suspends a returning character's visit (renewable), otherwise revokes its permit. */
  private async remove(row: SessionRow, returning = this.returning(row)) {
    this.ctx.storage.sql.exec("UPDATE sessions SET state = 'closing' WHERE key = ?", row.key);
    const live = this.live.get(row.key);
    this.live.delete(row.key);
    if (returning && row.credential) {
      if (live?.suspend) await live.suspend();
      else await (await this.game()).suspend((JSON.parse(row.credential) as Credential).identity);
    } else if (live) await live.close();
    if (!returning && row.credential && row.expires_at > Date.now()) {
      // Keep a closing record and retry on the alarm if Maincloud is unavailable.
      await (await this.game()).revoke((JSON.parse(row.credential) as Credential).identity);
    }
    this.purge(row.key);
  }
  private async reap(force = false) {
    if (this.reaping) return this.reaping;
    if (!force && Date.now() - this.lastReaped < 30_000) return;
    this.reaping = (async () => {
      const now = Date.now();
      const rows = this.ctx.storage.sql.exec<SessionRow>("SELECT * FROM sessions WHERE expires_at <= ? OR state = 'closing' OR (kind = 'agent' AND last_seen <= ?) OR (state = 'pending' AND last_seen <= ?)", now, now - IDLE_MS, now - 30_000).toArray();
      for (const row of rows) {
        if (row.state === 'active' && row.credential && [this.renewing, this.hostRenewing].some(set => set.has((JSON.parse(row.credential!) as Credential).identity))) continue;
        if (row.kind === 'human' && row.state === 'active' && row.expires_at <= now) { this.purge(row.key); continue; }
        try { await this.remove(row); } catch { /* Retry; the permit also expires in SpacetimeDB. */ } }
      this.ctx.storage.sql.exec('DELETE FROM invites WHERE expires_at <= ?', now);
      this.ctx.storage.sql.exec('DELETE FROM renewals WHERE expires_at <= ?', now);
      this.ctx.storage.sql.exec('DELETE FROM recoveries WHERE expires_at <= ?', now);
      this.ctx.storage.sql.exec('DELETE FROM mcp_players WHERE expires_at <= ?', now);
      reapAccounts(this.ctx.storage.sql, now);
      this.ctx.storage.sql.exec('DELETE FROM buckets WHERE expires_at <= ?', now);
      this.ctx.storage.sql.exec('DELETE FROM daily WHERE day < ?', new Date(now - 7 * 86400_000).toISOString().slice(0, 10));
    })();
    try { await this.reaping; this.lastReaped = Date.now(); } finally { this.reaping = undefined; }
  }
  private async rest() {
    if (this.inflight !== 0 || this.connecting || this.opening.size) return;
    if (this.count("SELECT COUNT(*) AS n FROM sessions WHERE kind = 'agent' AND state != 'closing'") === 0) {
      this.service?.close(); this.service = undefined;
    }
    if (this.count('SELECT COUNT(*) AS n FROM sessions')) await this.ctx.storage.setAlarm(Date.now() + 30_000);
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm() { await this.reap(true); await this.rest(); }

  /** Runs a session-host RPC like a request: counted in flight, so rest() keeps the socket, then rests. */
  private async hosting<T>(run: () => Promise<T>): Promise<Result<T>> {
    this.inflight++;
    try { return await settle(run); } finally { this.inflight--; await this.rest(); }
  }

  /**
   * Session host: admits a new agent in this object. The coordinator has already checked the invite, network
   * budgets and returning-player capacity; this checks the host's own session cap, provisions the character with
   * this host's gateway socket and opens its player socket. The coordinator then issues the renewal token.
   */
  async hostJoin(input: { id: string; ip: string; invite: Invite; slot: number | null }): Promise<Result<Joined>> {
    return this.hosting(async () => {
      this.sessionCapacity('agent');
      const service = await this.game(true);
      // Claim the slot synchronously after the last await, so racing joins cannot oversubscribe this host.
      this.sessionCapacity('agent');
      const now = Date.now(), token = sessionToken(input.slot), key = digest(token);
      const row: SessionRow = { key, id: input.id, ip: input.ip, kind: 'agent', expires_at: now + input.invite.lifetimeSeconds * 1000, last_seen: now,
        config: JSON.stringify(input.slot === null ? input.invite : { ...input.invite, hosted: true }), credential: null, state: 'pending', actions_count: 0 };
      this.ctx.storage.sql.exec('INSERT INTO sessions (key,id,ip,kind,expires_at,last_seen,config,state) VALUES (?,?,?,?,?,?,?,?)', key, row.id, row.ip, 'agent', row.expires_at, now, row.config, 'pending');
      await this.ctx.storage.setAlarm(Date.now() + 30_000);
      try {
        const credential = await service.provision(input.invite);
        row.credential = JSON.stringify(credential);
        this.ctx.storage.sql.exec('UPDATE sessions SET credential = ? WHERE key = ?', row.credential, key);
        this.live.set(key, await service.resume(input.invite, credential));
        this.ctx.storage.sql.exec("UPDATE sessions SET state = 'active' WHERE key = ?", key);
        return { token, credential, expiresAt: row.expires_at };
      } catch (error) {
        // No renewal exists yet: revoke the new character's permit rather than suspend it.
        try { await this.remove(row, false); } catch { /* Alarm retries revocation. */ }
        throw error;
      }
    });
  }

  /**
   * Session host: renews an agent's session here. A playing session is extended in place under a new token (a
   * disconnect would release its world slot and let a new arrival displace it); otherwise the old record is closed
   * and a new socket opened. The coordinator rotates the renewal token afterwards.
   */
  async hostRenew(input: { sessionId: string; identity: string; ip: string; invite: Invite; credential: Credential; resume: boolean; slot: number | null }): Promise<Result<Renewed>> {
    return this.hosting(async () => {
      if (this.hostRenewing.has(input.identity)) throw renewedElsewhere();
      this.hostRenewing.add(input.identity);
      let reserved: SessionRow | undefined;
      let retainedKey: string | undefined;
      try {
        const service = await this.game(true);
        const old = this.one<SessionRow>('SELECT * FROM sessions WHERE id = ?', input.sessionId);
        if (old && this.busy.has(old.key)) throw new ApiError(409, 'action_in_progress', 'Wait for the current action before returning.');
        const renewPermit = async () => {
          try { await service.renew(input.identity, input.invite.lifetimeSeconds, input.resume); }
          catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/revoked|no renewable permit/.test(message)) throw forgetting(visitEnded());
            throw renewalRefusal(error) ?? admissionError(error) ?? unavailable();
          }
        };
        if (old?.state === 'active') {
          this.busy.add(old.key); retainedKey = old.key;
          await renewPermit();
          const game = await this.sessionGame(old);
          if (!this.one("SELECT key FROM sessions WHERE key = ? AND state = 'active'", old.key)) throw visitEnded();
          const token = sessionToken(input.slot), key = digest(token), at = Date.now();
          const expiresAt = at + input.invite.lifetimeSeconds * 1000;
          this.ctx.storage.transactionSync(() => {
            this.purge(old.key);
            this.ctx.storage.sql.exec("INSERT INTO sessions (key,id,ip,kind,expires_at,last_seen,config,credential,state) VALUES (?,?,?,'agent',?,?,?,?,'active')",
              key, old.id, input.ip, expiresAt, at, old.config, old.credential);
          });
          this.live.delete(old.key); this.live.set(key, game);
          await this.ctx.storage.setAlarm(Date.now() + 30_000);
          return { token, expiresAt };
        }
        if (old) await this.remove(old);
        this.sessionCapacity('agent');
        const token = sessionToken(input.slot), at = Date.now(), key = digest(token);
        const invite: Invite = { ...input.invite, expiresAt: at + input.invite.lifetimeSeconds * 1000 };
        reserved = { key, id: input.sessionId, ip: input.ip, kind: 'agent', expires_at: invite.expiresAt, last_seen: at,
          config: JSON.stringify(input.slot === null ? invite : { ...invite, hosted: true }), credential: JSON.stringify(input.credential), state: 'pending', actions_count: 0 };
        this.ctx.storage.sql.exec('INSERT INTO sessions (key,id,ip,kind,expires_at,last_seen,config,credential,state) VALUES (?,?,?,?,?,?,?,?,?)', key, reserved.id, input.ip, 'agent', reserved.expires_at, at, reserved.config, reserved.credential, 'pending');
        await renewPermit();
        const game = await service.resume(invite, input.credential);
        this.live.set(key, game);
        this.ctx.storage.sql.exec("UPDATE sessions SET state = 'active' WHERE key = ?", key);
        await this.ctx.storage.setAlarm(Date.now() + 30_000);
        return { token, expiresAt: reserved.expires_at };
      } catch (error) { if (reserved) { try { await this.remove(reserved); } catch { /* Alarm retries; permit also expires. */ } } throw error; }
      finally { this.hostRenewing.delete(input.identity); if (retainedKey) this.busy.delete(retainedKey); }
    });
  }

  /** Session host: ends a session by id, revoking its permit (admin) or suspending it (moved to another shard). */
  async hostEnd(input: { sessionId: string; mode: 'revoke' | 'suspend' }): Promise<Result<boolean>> {
    return this.hosting(async () => {
      const row = this.one<SessionRow>('SELECT * FROM sessions WHERE id = ?', input.sessionId);
      if (row) await this.remove(row, input.mode === 'suspend');
      return !!row;
    });
  }

  /** Session host: the id of the active, unexpired, not idle agent session with this token digest, if any. */
  async hostActiveSession(key: string): Promise<string | null> {
    const now = Date.now();
    return this.one<{ id: string }>("SELECT id FROM sessions WHERE key = ? AND state = 'active' AND expires_at > ? AND last_seen > ?", key, now, now - IDLE_MS)?.id ?? null;
  }

  /** Session host: live session counts for the admin panel. */
  async hostStats(now: number): Promise<HostedStat[]> {
    return this.ctx.storage.sql.exec<HostedStat>('SELECT kind, state, COUNT(*) AS n, SUM(actions_count) AS actions FROM sessions WHERE expires_at > ? GROUP BY kind, state', now).toArray();
  }

  /** Session host: one session's admin summary. */
  async hostSessions(sessionId: string): Promise<HostedSession[]> {
    return this.ctx.storage.sql.exec<HostedSession>('SELECT kind, state, actions_count, last_seen, expires_at FROM sessions WHERE id = ?', sessionId).toArray();
  }

  /** A request to this gateway's own API, sent where the edge would send it (MCP tools). */
  private async route(request: Request): Promise<Response> {
    const target = gatewayFor(this.env, request, new URL(request.url).pathname);
    return target.slot === null ? this.fetch(target.request) : target.stub.fetch(target.request);
  }

  /**
   * POST /api/agent/v1/sessions after the invite and network checks. The invite is claimed before the first await;
   * the session host (a shard, or this object unsharded) admits the agent, then the renewal token is issued here.
   */
  private async joinAgent(token: string | null, invitation: { config: string; kind: Kind; expires_at: number } | undefined, ip: string, day: string, now: number) {
    if (this.count('SELECT COUNT(*) AS n FROM renewals') >= MAX_RENEWALS) throw new ApiError(429, 'renewal_capacity', 'Returning-player capacity reached.', 3600);
    this.ctx.storage.transactionSync(() => {
      if (token) this.ctx.storage.sql.exec('DELETE FROM invites WHERE key = ?', digest(token));
      this.ctx.storage.sql.exec('UPDATE daily SET joins = joins + 1 WHERE day = ?', day);
    });
    const invite: Invite = token && invitation ? JSON.parse(invitation.config) : { expiresAt: now + 3600_000, lifetimeSeconds: 3600, combat: true, chat: true };
    const id = crypto.randomUUID(), shards = this.shards();
    let slot = shards ? slotForSession(id, shards) : null;
    let joined: Joined;
    // A full shard hands the join to the next (up to three shards in all).
    for (let attempt = 0; ; attempt++) {
      const result = await this.host(slot).hostJoin({ id, ip, invite, slot });
      if (result.ok) { joined = result.value; break; }
      if (result.code !== 'agent_capacity' || slot === null || attempt >= Math.min(2, shards - 1)) {
        // Turned away for capacity: the invite is still good.
        if (token && invitation && result.code === 'agent_capacity') this.ctx.storage.sql.exec('INSERT OR IGNORE INTO invites VALUES (?, ?, ?, ?)', digest(token), invitation.kind, invitation.expires_at, invitation.config);
        throw unwrap(result);
      }
      slot = (slot + 1) % shards;
    }
    let renewToken: string;
    try {
      renewToken = issueRenewal(this.renewals(), joined.credential.identity, id, JSON.stringify({ ...invite, kind: 'agent', credential: joined.credential, ...(slot === null ? {} : { slot }) }), Date.now());
    } catch (error) {
      try { unwrap(await this.host(slot).hostEnd({ sessionId: id, mode: 'revoke' })); } catch { /* The permit expires in SpacetimeDB. */ }
      throw error;
    }
    return send(201, { token: joined.token, renewToken, sessionId: id, playerId: joined.credential.identity, expiresAt: new Date(joined.expiresAt).toISOString(),
      permissions: { combat: invite.combat, chat: invite.chat }, pollIntervalMs: AGENT_POLL_INTERVAL_MS });
  }

  /**
   * POST /api/agent/v1/renewals for an agent: the session host renews the permit and the session (in place while it
   * plays), then the renewal token rotates here. A session keeps its shard; one still in this coordinator from before
   * sharding, or in a shard beyond a reduced count, is suspended there and placed again.
   */
  private async renewAgent(store: RenewalStore, found: RenewalRow, config: AgentRenewal, ip: string, resume: boolean) {
    if (this.renewing.has(found.identity)) throw renewedElsewhere();
    this.renewing.add(found.identity);
    try {
      const shards = this.shards();
      let slot = shards ? shardOf(config, shards) : null;
      if (shards) {
        const legacy = this.one<SessionRow>('SELECT * FROM sessions WHERE id = ?', found.session_id);
        if (legacy && this.busy.has(legacy.key)) throw new ApiError(409, 'action_in_progress', 'Wait for the current action before returning.');
        if (legacy) await this.remove(legacy);
        slot ??= slotForSession(found.session_id, shards);
      }
      if (typeof config.slot === 'number' && config.slot !== slot) unwrap(await this.host(config.slot).hostEnd({ sessionId: found.session_id, mode: 'suspend' }));
      const renewed = await this.host(slot).hostRenew({ sessionId: found.session_id, identity: found.identity, ip, resume, slot, credential: config.credential,
        invite: { expiresAt: 0, lifetimeSeconds: config.lifetimeSeconds, combat: config.combat, chat: config.chat } });
      if (!renewed.ok && renewed.forget) store.removeIdentity(found.identity);
      const { token, expiresAt } = unwrap(renewed);
      let renewToken = '';
      this.ctx.storage.transactionSync(() => {
        renewToken = rotateRenewal(store, found, Date.now());
        if ((config.slot ?? null) !== slot) {
          const row = store.byKey(digest(renewToken));
          const { slot: _previous, ...rest } = config;
          if (row) store.put({ ...row, config: JSON.stringify(slot === null ? rest : { ...rest, slot }) });
        }
      });
      return send(200, { token, renewToken, sessionId: found.session_id, playerId: found.identity, expiresAt: new Date(expiresAt).toISOString(),
        permissions: { combat: config.combat, chat: config.chat }, pollIntervalMs: AGENT_POLL_INTERVAL_MS });
    } finally { this.renewing.delete(found.identity); }
  }

  /** MCP tools call this gateway's own agent API, so every budget and rule applies as for any agent. */
  private async mcp(request: Request): Promise<Response> {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
    try { this.take(`mcp:${digest(ip)}`, 200, 50, Date.now()); }
    catch { return mcpError(429, 'Slow down and retry shortly.'); }
    const sealKey = this.env.RECOVERY_ENCRYPTION_KEY ?? this.env.GATEWAY_CREDENTIAL;
    const sql = this.ctx.storage.sql;
    return handleMcp(request, {
      api: async call => {
        const headers: Record<string, string> = { 'CF-Connecting-IP': ip, 'User-Agent': 'BeriGame-MCP/1.0' };
        if (call.token) headers.Authorization = `Bearer ${call.token}`;
        if (call.idempotencyKey) headers['Idempotency-Key'] = call.idempotencyKey;
        if (call.body !== undefined) headers['Content-Type'] = 'application/json';
        const response = await this.route(new Request(new URL(call.path, this.env.PUBLIC_ORIGIN), { method: call.method, headers,
          body: call.body === undefined ? undefined : JSON.stringify(call.body) }));
        const text = await response.text();
        let body: unknown = null;
        try { body = text ? JSON.parse(text) : null; } catch { /* A non-JSON reply reads as a failure below. */ }
        return { status: response.status, body };
      },
      players: {
        get: key => {
          const row = this.one<{ payload: string; expires_at: number }>('SELECT payload, expires_at FROM mcp_players WHERE key = ?', digest(key));
          if (!row || row.expires_at <= Date.now()) return undefined;
          try { return openRecovery<PlayerTokens>(row.payload, sealKey); } catch { return undefined; }
        },
        put: (key, value) => { sql.exec('INSERT OR REPLACE INTO mcp_players VALUES (?, ?, ?, ?)', digest(key), sealRecovery(value, sealKey), value.playerId, Date.now() + RENEWAL_TTL_MS); },
        remove: key => { sql.exec('DELETE FROM mcp_players WHERE key = ?', digest(key)); },
      },
      newKey: () => secret(PLAYER_KEY_PREFIX),
      newIdempotencyKey: () => crypto.randomUUID(),
      guide: async () => (await this.env.ASSETS.fetch(new Request(new URL('/agent.md', this.env.PUBLIC_ORIGIN)))).text(),
      appHtml: MCP_APP_HTML,
      iconSvg: MCP_ICON_SVG,
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    });
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === MCP_PATH) return this.mcp(request);
    const lane = requestLane(path, request.method);
    this.inflight++;
    if (lane === 'join') this.joining++;
    try {
      if (this.inflight > 512) throw new ApiError(429, 'capacity', 'The sign-in service is busy. Retry shortly.', 2);
      // Leave room for renewals and existing agents during a burst of new joins.
      if (lane === 'join' && this.joining > 32) throw new ApiError(429, 'join_busy', 'Players are joining right now. Retry shortly.', 2);
      const now = Date.now();
      const ip = digest(request.headers.get('CF-Connecting-IP') ?? 'local');
      const budget = lane === 'join' ? JOIN_BUDGET : lane === 'renew' ? RENEWAL_BUDGET : REQUEST_BUDGET;
      this.take(`global:${lane}`, budget.burst, budget.perSecond, now);
      await this.reap();
      const day = new Date(now).toISOString().slice(0, 10);
      this.ctx.storage.sql.exec('INSERT OR IGNORE INTO daily (day) VALUES (?)', day);
      if (path.startsWith('/api/admin/')) {
        if (!isAdmin(request, this.env)) throw unauthorized();
        if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed', 'Use POST.');
        const input = await readJson(request);
        if (path === '/api/admin/stats') {
          const value = validateObject(input, { days: { type: 'integer', minimum: 1, maximum: 120 } }, []);
          const game = await (await this.game()).admin.snapshot(value.days ?? 30);
          return sendJsonText(200, `{"game":${game},"gateway":${JSON.stringify(await this.gatewayStats(now))}}`);
        }
        if (path === '/api/admin/player') {
          const value = validateObject(input, { identity: { type: 'string', minLength: 64, maxLength: 64, pattern: '^[0-9a-f]{64}$' } }, ['identity']);
          const game = await (await this.game()).admin.player(value.identity);
          const account = this.one<{ created_at: number; seen_at: number }>('SELECT created_at, seen_at FROM accounts WHERE identity = ?', value.identity);
          const logins = this.ctx.storage.sql.exec<{ provider: string }>('SELECT provider FROM account_logins l JOIN accounts a ON a.id = l.account_id WHERE a.identity = ?', value.identity).toArray().map(row => row.provider);
          const sessions = this.ctx.storage.sql.exec<{ kind: string; state: string; actions_count: number; last_seen: number; expires_at: number }>(
            'SELECT s.kind, s.state, s.actions_count, s.last_seen, s.expires_at FROM sessions s JOIN renewals r ON r.session_id = s.id WHERE r.identity = ?', value.identity).toArray();
          // An agent's session lives in the shard its renewal remembers.
          const renewal = this.one<RenewalRow>('SELECT * FROM renewals WHERE identity = ?', value.identity);
          const slot = renewal ? (JSON.parse(renewal.config) as { slot?: unknown }).slot : undefined;
          if (renewal && typeof slot === 'number') sessions.push(...await this.host(slot).hostSessions(renewal.session_id));
          return sendJsonText(200, `{"game":${game},"gateway":${JSON.stringify({ account: account ? { createdAt: account.created_at, seenAt: account.seen_at, logins } : null, sessions })}}`);
        }
        if (path === '/api/admin/revoke') {
          const value = validateObject(input, { sessionId: { type: 'string', minLength: 36, maxLength: 36 } }, ['sessionId']);
          const row = this.one<SessionRow>('SELECT * FROM sessions WHERE id = ?', value.sessionId);
          if (row) await this.remove(row, false);
          // A returning browser keeps its sessionId across renewals; revoking it ends renewal for good.
          const renewal = this.one<RenewalRow>('SELECT * FROM renewals WHERE session_id = ?', value.sessionId);
          // An agent session in a shard: its renewal names the shard; without one, ask every shard.
          const remembered = renewal ? (JSON.parse(renewal.config) as { slot?: unknown }).slot : undefined;
          const slots = typeof remembered === 'number' ? [remembered] : Array.from({ length: this.shards() }, (_, slot) => slot);
          for (const result of await Promise.all(slots.map(slot => this.host(slot).hostEnd({ sessionId: value.sessionId, mode: 'revoke' })))) unwrap(result);
          const recovery = this.one<{identity:string}>('SELECT identity FROM recoveries WHERE session_id = ?',value.sessionId);
          const identity = renewal?.identity ?? recovery?.identity;
          if (identity) {
            await (await this.game()).revoke(identity);
            this.renewals().removeIdentity(identity);
            this.ctx.storage.sql.exec('DELETE FROM recoveries WHERE identity = ?', identity);
            forgetCharacter(this.ctx.storage.sql, identity);
          }
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
      this.ctx.storage.sql.exec('UPDATE daily SET requests = requests + 1 WHERE day = ?', day);
      if (path.startsWith(ACCOUNT_BASE)) {
        return await handleAccount(request, path, { env: this.env, sql: this.ctx.storage.sql, transactionSync: fn => this.ctx.storage.transactionSync(fn),
          take: (key, capacity, perSecond, at) => this.take(key, capacity, perSecond, at), renewals: () => this.renewals(),
          verifyCredential: async credential => (await this.game()).verifyCredential(credential), ip, now });
      }
      if (request.method === 'GET' && [PREFIX, `${PREFIX}/`].includes(path)) {
        let ready = false;
        try { ready = (await this.game()).ready(); } catch { /* Public status is safe without credentials configured. */ }
        return send(200, { name: 'BeriGame', version: 1, ready, onboarding: '/agent', openapi: `${PREFIX}/openapi.json`,
          access: 'open beta', pollIntervalMs: AGENT_POLL_INTERVAL_MS, actionIntervalMs: AGENT_ACTION_INTERVAL_MS, idleTimeoutSeconds: 600,
          capacity: { maxOnlinePlayers: MAX_ONLINE_PLAYERS, maxAgentSessions: agentSessionCapacity(this.shards()), perNetworkPlayerLimit: null } });
      }
      if (path === `${PREFIX}/world` && request.method === 'GET') return send(200, worldAtlas());
      if (path === `${PREFIX}/openapi.json` && request.method === 'GET') return send(200, { ...openapi, paths: { ...openapi.paths, '/sessions': { post: { ...openapi.paths['/sessions'].post, summary: 'Join the open beta', security: [] } } } });
      if ([`${PREFIX}/sessions`, '/api/play/v1/sessions'].includes(path) && request.method === 'POST') {
        this.take(`join:${ip}`, NETWORK_JOIN_BUDGET.burst, NETWORK_JOIN_BUDGET.perSecond, now);
        const token = request.headers.has('Authorization') ? bearer(request) : null;
        validateObject(await readJson(request), {}, []);
        const kind: Kind = path === '/api/play/v1/sessions' ? 'human' : 'agent';
        const invitation = this.one<{ config: string; kind: Kind; expires_at: number }>('SELECT * FROM invites WHERE key = ?', digest(token ?? ''));
        if (token && (!invitation || invitation.kind !== kind || invitation.expires_at <= now)) throw new ApiError(401, 'invalid_invite', 'This invite is invalid, expired, already used, or intended for a different type of player.');
        if (kind === 'agent') return await this.joinAgent(token, invitation, ip, day, now);
        this.sessionCapacity(kind);
        if (this.count('SELECT COUNT(*) AS n FROM renewals') >= MAX_RENEWALS) {
          throw new ApiError(429, 'renewal_capacity', 'Returning-player capacity reached.', 3600);
        }
        const service = await this.game();
        // Claim and reserve synchronously after the last await. Racing requests cannot reuse an invite or oversubscribe slots.
        if (token && !this.one('SELECT key FROM invites WHERE key = ?', digest(token))) throw new ApiError(401, 'invalid_invite', 'This invite has already been used.');
        this.sessionCapacity(kind);
        // Browser visits: the record is only for renewal and revocation (agents take joinAgent above).
        const key = digest(secret('bgs_'));
        const invite: Invite = token && invitation ? JSON.parse(invitation.config) : { expiresAt: now + 3600_000, lifetimeSeconds: 3600, combat: true, chat: true };
        const row: SessionRow = { key, id: crypto.randomUUID(), ip, kind, expires_at: now + invite.lifetimeSeconds * 1000,
          last_seen: now, config: JSON.stringify(invite), credential: null, state: 'pending', actions_count: 0 };
        this.ctx.storage.transactionSync(() => {
          if (token) this.ctx.storage.sql.exec('DELETE FROM invites WHERE key = ?', digest(token));
          this.ctx.storage.sql.exec('INSERT INTO sessions (key,id,ip,kind,expires_at,last_seen,config,state) VALUES (?,?,?,?,?,?,?,?)', key, row.id, ip, kind, row.expires_at, now, row.config, 'pending');
          this.ctx.storage.sql.exec('UPDATE daily SET joins = joins + 1 WHERE day = ?', day);
        });
        await this.ctx.storage.setAlarm(Date.now() + 30_000);
        try {
          const credential = await service.provision(invite);
          // Browsers hold their own SpacetimeDB token; the gateway keeps only the identity for revocation.
          row.credential = JSON.stringify({ identity: credential.identity });
          this.ctx.storage.sql.exec('UPDATE sessions SET credential = ? WHERE key = ?', row.credential, key);
          const renewToken = issueRenewal(this.renewals(), credential.identity, row.id, row.config, now);
          this.ctx.storage.sql.exec("UPDATE sessions SET state = 'active' WHERE key = ?", key);
          return send(201, { token: credential.token, uri: credential.uri, database: credential.database, renewToken,
            sessionId: row.id, playerId: credential.identity, expiresAt: new Date(row.expires_at).toISOString(),
            permissions: { combat: invite.combat, chat: invite.chat }, pollIntervalMs: AGENT_POLL_INTERVAL_MS });
        } catch (error) {
          if (row.credential) this.renewals().removeIdentity((JSON.parse(row.credential) as Credential).identity);
          try { await this.remove(row); } catch { /* Alarm retries revocation. */ }
          throw error;
        }
      }
      if ([`${PREFIX}/recovery`, '/api/play/v1/recovery'].includes(path) && request.method === 'POST') {
        const input = validateObject(await readJson(request), { token: {type:'string',minLength:1,maxLength:3000} }, []);
        const presented = bearer(request);
        let found: RenewalRow | undefined;
        if (presented.startsWith('bgr_')) found = lookupRenewal(this.renewals(), presented, now);
        else {
          // A live session token: its session is in the shard the token names (or here, unsharded or legacy).
          const slot = tokenSlot(`Bearer ${presented}`, this.shards());
          const sessionId = slot === null ? await this.hostActiveSession(digest(presented)) : await this.host(slot).hostActiveSession(digest(presented));
          if (sessionId) found = this.one<RenewalRow>('SELECT * FROM renewals WHERE session_id = ?', sessionId);
        }
        if (!found || found.expires_at <= now) throw unauthorized();
        this.take(`recovery:${found.identity}`, 3, 1 / 60, now);
        const config = JSON.parse(found.config) as Invite & {kind?:string;credential?:Credential};
        const credential = config.credential ?? {uri:this.env.SPACETIME_URI,database:this.env.SPACETIME_DB,identity:found.identity,token:input.token};
        if (!credential.token) throw unauthorized();
        const service = await this.game(); await service.verifyCredential(credential);
        const recoveryToken = secret('bgk_');
        const payload = sealRecovery({config:found.config,credential,sessionId:found.session_id}, this.env.RECOVERY_ENCRYPTION_KEY ?? this.env.GATEWAY_CREDENTIAL);
        await service.attestRecovery(found.identity);
        this.ctx.storage.sql.exec('INSERT OR REPLACE INTO recoveries (identity,key,payload,expires_at,session_id) VALUES (?,?,?,?,?)',found.identity,digest(recoveryToken),payload,now+180*86400_000,found.session_id);
        return send(200,{recoveryToken,playerId:found.identity,expiresAt:new Date(now+180*86400_000).toISOString()});
      }
      if ([`${PREFIX}/recover`, '/api/play/v1/recover'].includes(path) && request.method === 'POST') {
        validateObject(await readJson(request),{},[]);
        const key = digest(bearer(request));
        const row = this.one<{identity:string;key:string;payload:string;expires_at:number}>('SELECT * FROM recoveries WHERE key = ?',key);
        if (!row || row.expires_at<=now) throw unauthorized();
        this.take(`recovery:${row.identity}`, 3, 1 / 60, now);
        const saved = openRecovery<{config:string;credential:Credential;sessionId:string}>(row.payload,this.env.RECOVERY_ENCRYPTION_KEY ?? this.env.GATEWAY_CREDENTIAL);
        const recoveryToken=secret('bgk_'),renewToken=secret('bgr_');
        // No awaits: one-time consumption and renewal replacement commit together.
        this.ctx.storage.transactionSync(()=>{
          this.ctx.storage.sql.exec('UPDATE recoveries SET key = ?, expires_at = ? WHERE key = ?',digest(recoveryToken),now+180*86400_000,key);
          this.renewals().put({key:digest(renewToken),prev_key:null,prev_until:0,identity:row.identity,session_id:saved.sessionId,config:saved.config,expires_at:now+30*86400_000});
        });
        return send(200,{recoveryToken,renewToken,playerId:row.identity,...saved.credential,expiresAt:new Date(now+180*86400_000).toISOString(),next:'Use the ordinary renewal endpoint to obtain a bounded play permit.'});
      }
      if (path === `${PREFIX}/renewals` && request.method === 'POST') {
        const { resume = false } = validateObject(await readJson(request), RESUME_BODY, []);
        const store = this.renewals(), found = lookupRenewal(store, bearer(request), now);
        this.takeRenewal(found.identity, now);
        const config = JSON.parse(found.config) as Invite & { kind?: string; credential?: Credential };
        if (config.kind !== 'agent' || !config.credential) throw visitEnded();
        return await this.renewAgent(store, found, config as AgentRenewal, ip, resume);
      }
      if (path === '/api/play/v1/renewals' && request.method === 'POST') {
        const token = bearer(request);
        const { resume = false } = validateObject(await readJson(request), RESUME_BODY, []);
        const store = this.renewals();
        const found = lookupRenewal(store, token, now);
        this.takeRenewal(found.identity, now);
        if (this.renewing.has(found.identity)) throw renewedElsewhere();
        const invite = JSON.parse(found.config) as Invite & { kind?: string };
        if (invite.kind === 'agent') throw visitEnded();
        const visit = () => this.one<SessionRow>("SELECT * FROM sessions WHERE id = ? AND kind = 'human'", found.session_id);
        if (visit() && visit()!.state !== 'active') throw visitEnded();
        if (!visit()) this.sessionCapacity('human');
        this.renewing.add(found.identity);
        try {
          const service = await this.game();
          try { await service.renew(found.identity, invite.lifetimeSeconds, resume); }
          catch (error) {
            if (error instanceof ApiError) throw error;
            const message = error instanceof Error ? error.message : String(error);
            if (/revoked|no renewable permit/.test(message)) { store.removeIdentity(found.identity); throw visitEnded(); }
            throw renewalRefusal(error) ?? admissionError(error) ?? unavailable();
          }
          // Synchronous from here: rotation and the visit slot commit together.
          const at = Date.now();
          const current = visit();
          if (current && current.state !== 'active') throw visitEnded();
          if (!current) this.sessionCapacity('human');
          const renewToken = rotateRenewal(store, found, at);
          const expiresAt = at + invite.lifetimeSeconds * 1000;
          if (current) this.ctx.storage.sql.exec('UPDATE sessions SET expires_at = ?, last_seen = ?, ip = ? WHERE key = ?', expiresAt, at, ip, current.key);
          else this.ctx.storage.sql.exec("INSERT INTO sessions (key,id,ip,kind,expires_at,last_seen,config,credential,state) VALUES (?,?,?,'human',?,?,?,?,'active')",
            digest(secret('bgs_')), found.session_id, ip, expiresAt, at, found.config, JSON.stringify({ identity: found.identity }));
          await this.ctx.storage.setAlarm(Date.now() + 30_000);
          return send(200, { renewToken, sessionId: found.session_id, playerId: found.identity, expiresAt: new Date(expiresAt).toISOString(),
            permissions: { combat: invite.combat, chat: invite.chat } });
        } finally { this.renewing.delete(found.identity); }
      }
      const token = bearer(request);
      if (!token.startsWith('bgs_')) throw unauthorized();
      const key = digest(token);
      const row = this.one<SessionRow>("SELECT * FROM sessions WHERE key = ? AND kind = 'agent' AND state = 'active'", key);
      // With shards, the edge sends every session request to its shard. One reaching the coordinator carries a token
      // from before sharding (or a reduced shard count): end that visit, renewably, and send the agent to renew.
      if (this.shards() > 0 && !request.headers.has(SHARD_HEADER)) {
        if (row) await this.remove(row);
        throw new ApiError(401, 'invalid_session', `This session token predates a gateway update. POST ${PREFIX}/renewals with your renewToken to continue as the same character.`);
      }
      if (!row || row.expires_at <= now || row.last_seen <= now - IDLE_MS) throw unauthorized();
      if (!this.busy.has(key) && this.count('SELECT COUNT(*) AS n FROM receipts WHERE session_key = ? AND status = 0', key)) {
        await this.remove(row);
        throw new ApiError(503, 'action_outcome_uncertain', 'The connection restarted during an action. This session has been closed to prevent a duplicate action.');
      }
      const acting = path.startsWith(`${PREFIX}/actions/`) && request.method === 'POST';
      if (!acting) this.take(`read:${key}`, AGENT_READ_BUDGET.burst, AGENT_READ_BUDGET.perSecond, now); // Actions spend only the action budget.
      this.ctx.storage.sql.exec('UPDATE sessions SET last_seen = ? WHERE key = ?', now, key);
      if (path === `${PREFIX}/session` && request.method === 'DELETE') { await this.remove(row); return send(204); }
      if (path === `${PREFIX}/state` && request.method === 'GET') {
        try { return send(200, (await this.sessionGame(row)).state({ map: new URL(request.url).search === '?map=1' })); }
        catch (error) {
          if (error instanceof ApiError && error.status === 401) await this.remove(row);
          else { const stale = this.live.get(key); this.live.delete(key); if (stale?.suspend) await stale.suspend(); else if (stale) await stale.close(); await this.remove(row); }
          throw error;
        }
      }
      if (path === `${PREFIX}/danger` && request.method === 'GET') {
        // An ordinary read (CORE_SCOPE). A brief tick stall is a 503 that keeps the session. A dropped socket never
        // reconnects, so that 503 is permanent: drop the session as /state does, and the agent re-joins cleanly.
        try { return send(200, (await this.sessionGame(row)).danger()); }
        catch (error) {
          const stale = this.live.get(key);
          if (error instanceof ApiError && error.status === 401) await this.remove(row);
          else if (stale && stale.alive?.() === false) { this.live.delete(key); if (stale.suspend) await stale.suspend(); else await stale.close(); await this.remove(row); }
          throw error instanceof ApiError ? error : unavailable();
        }
      }
      if (acting) {
        this.take(`action:${key}`, AGENT_ACTION_BUDGET.burst, AGENT_ACTION_BUDGET.perSecond, now);
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
        if (row.actions_count >= MAX_SESSION_ACTIONS) throw new ApiError(429, 'session_action_budget', 'This session has reached its action budget.');
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
          try {
            const result = await deadline(game.action(action, input), 5000);
            if (result) body = { ...(body as object), ...result };
          }
          catch (error) {
            const safe = error instanceof ApiError ? error : new ApiError(422, 'action_rejected', playerRejection(error));
            status = safe.status; body = errorBody(safe);
            if ([401, 503].includes(status)) { await this.remove(row); return send(status, body); }
          }
          this.ctx.storage.sql.exec('UPDATE receipts SET status = ?, body = ? WHERE session_key = ? AND key = ?', status, JSON.stringify(body), key, idempotencyKey);
          return send(status, body);
        } finally { this.busy.delete(key); }
      }
      throw new ApiError(404, 'not_found', 'Unknown endpoint or method. See openapi.json.');
    } catch (error) {
      const safe = admissionError(error) ?? unavailable();
      return send(safe.status, errorBody(safe), safe.retryAfter);
    } finally { this.inflight--; if (lane === 'join') this.joining--; await this.rest(); }
  }
}
