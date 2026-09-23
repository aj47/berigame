import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { ACTIONS, openapi, validateAction, validateObject } from './contract';
import { AddressLimits, ApiError, Budget, digest, InviteStore, secret, type Invite } from './security';
import { deadline, type GameService, type GameSession } from './game';

const PREFIX = '/api/agent/v1';
type Receipt = { fingerprint: string; status: number; body: unknown };
type Session = { id: string; ip: string; game: GameSession; expiresAt: number; lastSeen: number; invite: Invite;
  reads: Budget; actions: Budget; busy: boolean; receipts: Map<string, Receipt> };
type Options = { invites: InviteStore; game: GameService; publicOrigin?: string; trustedProxyIPs?: string[];
  maxSessions?: number; maxSessionsPerIp?: number; idleMs?: number; now?: () => number; log?: (entry: object) => void };
const canonicalIp = (value: string) => value.replace(/^::ffff:/, '');
const errorBody = (error: ApiError) => ({ error: { code: error.code, message: error.message } });
const unauthorized = () => new ApiError(401, 'invalid_session', 'A valid, unexpired session bearer token is required.');

function bearer(req: IncomingMessage): string {
  const value = req.headers.authorization;
  if (!value || !/^Bearer [A-Za-z0-9_-]{47}$/.test(value)) throw unauthorized();
  return value.slice(7);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json'
    || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) {
    throw new ApiError(415, 'json_required', 'Send uncompressed application/json.');
  }
  if (Number(req.headers['content-length']) > 4096) throw new ApiError(413, 'body_too_large', 'JSON bodies are limited to 4096 bytes.');
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const cleanup = () => { clearTimeout(timer); req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('aborted', onError); };
    const fail = (error: ApiError) => { cleanup(); req.pause(); reject(error); };
    const onError = () => fail(new ApiError(400, 'request_aborted', 'Request was interrupted.'));
    const onData = (chunk: Buffer) => { size += chunk.length; if (size > 4096) fail(new ApiError(413, 'body_too_large', 'JSON bodies are limited to 4096 bytes.')); else chunks.push(chunk); };
    const onEnd = () => { cleanup(); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new ApiError(400, 'invalid_json', 'Send a JSON object.')); } };
    const timer = setTimeout(() => fail(new ApiError(408, 'body_timeout', 'Request body timed out.')), 3000);
    req.on('data', onData); req.on('end', onEnd); req.on('error', onError); req.on('aborted', onError);
  });
}

export function createAgentServer(options: Options) {
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});
  const sessions = new Map<string, Session>();
  const pending = new Map<string, number>();
  const limits = new AddressLimits();
  let inflight = 0;
  const maxSessions = options.maxSessions ?? 16;
  const maxPerIp = options.maxSessionsPerIp ?? 4;
  const idleMs = options.idleMs ?? 10 * 60_000;
  const publicOrigin = options.publicOrigin ? new URL(options.publicOrigin).origin : undefined;

  const remove = async (key: string, reason: string) => {
    const session = sessions.get(key);
    if (!session) return;
    sessions.delete(key);
    log({ event: 'session_closed', session: session.id, player: session.game.identity, reason });
    await session.game.close();
  };
  const reap = async () => {
    const tasks: Promise<void>[] = [];
    for (const [key, session] of sessions) if (session.expiresAt <= now() || now() - session.lastSeen >= idleMs || !options.game.ready()) tasks.push(remove(key, 'expired_or_unavailable'));
    await Promise.allSettled(tasks);
  };
  const timer = setInterval(() => { void reap(); }, 1000);
  timer.unref();

  const server = createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    const send = (status: number, body?: unknown, retryAfter?: number) => {
      res.statusCode = status;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      if (retryAfter) res.setHeader('Retry-After', retryAfter);
      if (status >= 400) res.setHeader('Connection', 'close');
      if (body !== undefined) res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    inflight++;
    try {
      if (inflight > 64) throw new ApiError(429, 'capacity', 'Request capacity reached.', 2);
      const remote = canonicalIp(req.socket.remoteAddress ?? 'unknown');
      let ip = remote;
      if (options.trustedProxyIPs?.includes(remote) && req.headers['x-forwarded-for']) {
        const forwarded = req.headers['x-forwarded-for'];
        if (typeof forwarded !== 'string' || !isIP(forwarded.trim())) throw new ApiError(400, 'invalid_proxy_header', 'Trusted proxy must overwrite X-Forwarded-For with one client address.');
        ip = canonicalIp(forwarded.trim());
      }
      const joining = req.method === 'POST' && req.url === `${PREFIX}/sessions`;
      limits.take(ip, joining, now());
      const hosts = [`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`, `[::1]:${req.socket.localPort}`];
      if (publicOrigin) hosts.push(new URL(publicOrigin).host);
      if (!req.headers.host || !hosts.includes(req.headers.host)) throw new ApiError(403, 'host_not_allowed', 'Host is not configured for this API.');
      if (req.headers.origin && req.headers.origin !== publicOrigin) throw new ApiError(403, 'origin_not_allowed', 'Cross-origin browser requests are not allowed.');
      if (!req.url?.startsWith(PREFIX) || req.url.includes('?') || req.url.includes('#')) throw new ApiError(404, 'not_found', 'Use /api/agent/v1; credentials belong in Authorization headers.');
      const route = req.url.slice(PREFIX.length);
      if ((route === '' || route === '/') && req.method === 'GET') {
        send(200, { name: 'BeriGame', version: 1, ready: options.game.ready(), onboarding: '/agent', openapi: `${PREFIX}/openapi.json`,
          access: 'single-use invite', pollIntervalMs: 1000, actionIntervalMs: 1000, idleTimeoutSeconds: idleMs / 1000 }); return;
      }
      if (route === '/openapi.json' && req.method === 'GET') { send(200, openapi); return; }
      if (!options.game.ready()) throw new ApiError(503, 'world_unavailable', 'The admitted game world is unavailable.');
      if (route === '/sessions' && req.method === 'POST') {
        const code = bearer(req);
        validateObject(await readJson(req), {}, []);
        const pendingCount = [...pending.values()].reduce((a, b) => a + b, 0);
        const activeAtIp = [...sessions.values()].filter(s => s.ip === ip).length;
        if (sessions.size + pendingCount >= maxSessions || activeAtIp + (pending.get(ip) ?? 0) >= maxPerIp) {
          throw new ApiError(429, 'session_capacity', 'Player session capacity reached. Try later.', 60);
        }
        pending.set(ip, (pending.get(ip) ?? 0) + 1);
        try {
          const invite = await options.invites.consume(code, now());
          const expiresAt = now() + invite.lifetimeSeconds * 1000;
          const game = await options.game.create(invite);
          if (req.aborted || res.destroyed) { await game.close(); return; }
          const token = secret('bgs_');
          const key = digest(token);
          const session: Session = { id: randomUUID(), game, invite, ip, expiresAt, lastSeen: now(),
            reads: new Budget(10, 2, now()), actions: new Budget(4, 1, now()), busy: false, receipts: new Map() };
          sessions.set(key, session);
          // The response is the only disclosure of this token. Store only its hash.
          res.once('close', () => { if (!res.writableFinished) void remove(key, 'response_interrupted'); });
          log({ event: 'session_created', session: session.id, player: game.identity, expiresAt, combat: invite.combat, chat: invite.chat });
          send(201, { token, sessionId: session.id, playerId: game.identity, expiresAt: new Date(expiresAt).toISOString(),
            permissions: { combat: invite.combat, chat: invite.chat }, pollIntervalMs: 1000 });
        } finally {
          const count = (pending.get(ip) ?? 1) - 1;
          if (count) pending.set(ip, count); else pending.delete(ip);
        }
        return;
      }
      const token = bearer(req);
      if (!/^bgs_[A-Za-z0-9_-]{43}$/.test(token)) throw unauthorized();
      const key = digest(token);
      const session = sessions.get(key);
      if (!session) throw unauthorized();
      if (session.expiresAt <= now() || now() - session.lastSeen >= idleMs) { await remove(key, 'expired'); throw unauthorized(); }
      session.reads.take(now());
      session.lastSeen = now();
      if (route === '/session' && req.method === 'DELETE') { await remove(key, 'left'); send(204); return; }
      try {
        if (route === '/state' && req.method === 'GET') { send(200, session.game.state()); return; }
        if (route.startsWith('/actions/') && req.method === 'POST') {
          session.actions.take(now()); // Failed validation and denied actions count too.
          const action = route.slice('/actions/'.length);
          const input = validateAction(action, await readJson(req));
          const scope = ACTIONS[action].scope;
          if (scope && !session.invite[scope]) throw new ApiError(403, 'scope_required', `This invite does not allow ${scope}.`);
          const idempotencyKey = req.headers['idempotency-key'];
          if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(idempotencyKey)) throw new ApiError(400, 'idempotency_key_required', 'Use a unique Idempotency-Key of 16..80 letters, digits, hyphens or underscores per action.');
          const fingerprint = digest(JSON.stringify([action, Object.entries(input).sort(([a], [b]) => a.localeCompare(b))]));
          const prior = session.receipts.get(idempotencyKey);
          if (prior) {
            if (prior.fingerprint !== fingerprint) throw new ApiError(409, 'idempotency_conflict', 'This Idempotency-Key was already used for a different action.');
            send(prior.status, prior.body); return;
          }
          if (session.receipts.size >= 1024) throw new ApiError(429, 'session_action_budget', 'This session has reached its action budget.');
          if (session.busy) throw new ApiError(409, 'action_in_progress', 'Wait for the current action receipt, then retry with the same key.');
          session.busy = true;
          try {
            let status = 200;
            let body: unknown;
            try {
              await deadline(session.game.action(action, input), 5000);
              body = { accepted: true, action, idempotencyKey, message: 'Read /state to observe the result.' };
            } catch (err) {
              const error = err instanceof ApiError ? err : new ApiError(422, 'action_rejected', 'The game rejected this action. Inspect state before trying again.');
              status = error.status; body = errorBody(error);
              if (status === 503) await remove(key, 'action_outcome_uncertain');
            }
            session.receipts.set(idempotencyKey, { fingerprint, status, body });
            log({ event: 'action', session: session.id, action, status });
            send(status, body);
          } finally { session.busy = false; }
          return;
        }
        throw new ApiError(404, 'not_found', 'Unknown endpoint or method. See openapi.json.');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) await remove(key, 'revoked');
        throw error;
      }
    } catch (error) {
      const safe = error instanceof ApiError ? error : new ApiError(503, 'unavailable', 'The request could not be completed.');
      send(safe.status, errorBody(safe), safe.retryAfter);
    } finally { inflight--; }
  });
  server.maxConnections = 128;
  server.maxRequestsPerSocket = 100;
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5000;
  return { server, async close() {
    clearInterval(timer);
    await Promise.allSettled([...sessions.keys()].map(key => remove(key, 'shutdown')));
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  } };
}
