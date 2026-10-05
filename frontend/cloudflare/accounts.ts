import { Discord, Google, decodeIdToken, generateCodeVerifier, generateState } from 'arctic';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { randomBytes, randomInt } from 'node:crypto';
import {
  Accounts, EMAIL_CODE_ATTEMPTS, emailSubject, maskEmail, noAccount, normalizeEmail,
  type AccountRow, type AccountStore, type CharacterLink, type Intent, type Login, type LoginRow,
} from '../agent-api/accounts';
import { validateObject } from '../agent-api/contract';
import type { Credential } from '../agent-api/game';
import { ApiError, digest, type Invite } from '../agent-api/portable';
import { openRecovery, sealRecovery } from '../agent-api/recovery';
import { lookupRenewal, RENEWAL_TTL_MS, type RenewalStore } from '../agent-api/renewal';
import { bearer, errorBody, readJson, send } from './http';

/** Cloudflare Email Service binding (send_email). */
export interface EmailSender {
  send(message: { to: string; from: string | { email: string; name?: string }; subject: string; text: string; html?: string }): Promise<unknown>;
}
export interface AccountEnv {
  PUBLIC_ORIGIN: string;
  SPACETIME_URI: string;
  SPACETIME_DB: string;
  GATEWAY_CREDENTIAL: string;
  RECOVERY_ENCRYPTION_KEY?: string;
  EMAIL?: EmailSender;
  EMAIL_FROM?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}
export interface AccountDeps {
  env: AccountEnv;
  sql: SqlStorage;
  transactionSync<T>(fn: () => T): T;
  take(key: string, capacity: number, perSecond: number, now: number): void;
  renewals(): RenewalStore;
  verifyCredential(credential: Credential): Promise<void>;
  ip: string;
  now: number;
}

export const ACCOUNT_BASE = '/api/play/v1/account';
const OAUTH_CALLBACK = /^\/api\/play\/v1\/account\/oauth\/(discord|google)\/callback$/;
const ROUTES = ['', '/providers', '/oauth/start', '/oauth/finish', '/email/start', '/email/verify',
  '/passkey/options', '/passkey/verify', '/play', '/logins/remove', '/logout'].map(route => ACCOUNT_BASE + route);
export const isAccountPath = (path: string) => ROUTES.includes(path) || OAUTH_CALLBACK.test(path);
export const isOAuthCallback = (path: string) => OAUTH_CALLBACK.test(path);

const COOKIE = '__Host-bg_login';
const EMAIL_TTL_MS = 15 * 60_000;
const tokenField = { token: { type: 'string', minLength: 1, maxLength: 3000 } } as const;

export function createAccountTables(sql: SqlStorage) {
  sql.exec('CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, identity TEXT UNIQUE, character TEXT, created_at INTEGER NOT NULL, seen_at INTEGER NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS account_logins (provider TEXT NOT NULL, subject TEXT NOT NULL, account_id TEXT NOT NULL, label TEXT NOT NULL, data TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (provider, subject))');
  sql.exec('CREATE INDEX IF NOT EXISTS account_logins_account ON account_logins(account_id)');
  sql.exec('CREATE TABLE IF NOT EXISTS account_sessions (key TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at INTEGER NOT NULL)');
  sql.exec('CREATE INDEX IF NOT EXISTS account_sessions_expiry ON account_sessions(expires_at)');
  sql.exec('CREATE TABLE IF NOT EXISTS account_pending (key TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL)');
}
export function reapAccounts(sql: SqlStorage, now: number) {
  sql.exec('DELETE FROM account_sessions WHERE expires_at <= ?', now);
  sql.exec('DELETE FROM account_pending WHERE expires_at <= ?', now);
}
/** A revoked character can no longer be played through any account login. */
export function forgetCharacter(sql: SqlStorage, identity: string) {
  sql.exec('UPDATE accounts SET identity = NULL, character = NULL WHERE identity = ?', identity);
}

function sqlStore(sql: SqlStorage, transactionSync: <T>(fn: () => T) => T): AccountStore {
  const one = <T extends Record<string, any>>(query: string, ...args: (string | number | null)[]) => sql.exec<T>(query, ...args).toArray()[0];
  return {
    account: id => one<AccountRow>('SELECT * FROM accounts WHERE id = ?', id),
    accountByIdentity: identity => one<AccountRow>('SELECT * FROM accounts WHERE identity = ?', identity),
    accountCount: () => one<{ n: number }>('SELECT COUNT(*) AS n FROM accounts')?.n ?? 0,
    putAccount: row => { sql.exec('INSERT OR REPLACE INTO accounts VALUES (?, ?, ?, ?, ?)', row.id, row.identity, row.character, row.created_at, row.seen_at); },
    login: (provider, subject) => one<LoginRow>('SELECT * FROM account_logins WHERE provider = ? AND subject = ?', provider, subject),
    logins: id => sql.exec<LoginRow>('SELECT * FROM account_logins WHERE account_id = ? ORDER BY created_at', id).toArray(),
    putLogin: row => { sql.exec('INSERT OR REPLACE INTO account_logins VALUES (?, ?, ?, ?, ?, ?)', row.provider, row.subject, row.account_id, row.label, row.data, row.created_at); },
    removeLogin: (provider, subject) => { sql.exec('DELETE FROM account_logins WHERE provider = ? AND subject = ?', provider, subject); },
    session: key => one<{ account_id: string; expires_at: number }>('SELECT account_id, expires_at FROM account_sessions WHERE key = ?', key),
    putSession: (key, accountId, expiresAt) => { sql.exec('INSERT OR REPLACE INTO account_sessions VALUES (?, ?, ?)', key, accountId, expiresAt); },
    removeSession: key => { sql.exec('DELETE FROM account_sessions WHERE key = ?', key); },
    pending: key => one<{ kind: string; payload: string; expires_at: number }>('SELECT kind, payload, expires_at FROM account_pending WHERE key = ?', key),
    putPending: (key, kind, payload, expiresAt) => {
      if (!one('SELECT key FROM account_pending WHERE key = ?', key) && (one<{ n: number }>('SELECT COUNT(*) AS n FROM account_pending')?.n ?? 0) >= 4096) {
        throw new ApiError(429, 'capacity', 'Too many logins in progress. Try again shortly.', 60);
      }
      sql.exec('INSERT OR REPLACE INTO account_pending VALUES (?, ?, ?, ?)', key, kind, payload, expiresAt);
    },
    removePending: key => { sql.exec('DELETE FROM account_pending WHERE key = ?', key); },
    transaction: fn => transactionSync(fn),
  };
}

type Pending = { intent: Intent; accountId?: string; link?: CharacterLink };
type OAuthPending = Pending & { provider: 'discord' | 'google'; state: string; verifier: string; result?: { accountToken?: string; error?: { status: number; code: string; message: string } } };
type EmailPending = Pending & { subject: string; label: string; code: string; attempts: number };
type PasskeyPending = Pending & { mode: 'register' | 'login'; challenge: string };

function oauthClient(env: AccountEnv, provider: 'discord' | 'google') {
  const redirect = `${env.PUBLIC_ORIGIN}${ACCOUNT_BASE}/oauth/${provider}/callback`;
  if (provider === 'discord' && env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) return new Discord(env.DISCORD_CLIENT_ID, env.DISCORD_CLIENT_SECRET, redirect);
  if (provider === 'google' && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) return new Google(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirect);
  throw new ApiError(404, 'provider_unavailable', 'This login method is not available yet.');
}
function readCookie(request: Request): string | undefined {
  const match = /(?:^|;\s*)__Host-bg_login=(bgx_[A-Za-z0-9_-]{43})(?:;|$)/.exec(request.headers.get('Cookie') ?? '');
  return match?.[1];
}
const cookie = (value: string, maxAge: number) => `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
const rpID = (env: AccountEnv) => new URL(env.PUBLIC_ORIGIN).hostname;
const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

export async function handleAccount(request: Request, path: string, deps: AccountDeps): Promise<Response> {
  const { env, now } = deps;
  const sealKey = env.RECOVERY_ENCRYPTION_KEY ?? env.GATEWAY_CREDENTIAL;
  const accounts = new Accounts(sqlStore(deps.sql, deps.transactionSync), {
    seal: value => sealRecovery(value, sealKey), open: <T>(sealed: string) => openRecovery<T>(sealed, sealKey),
  }, () => now);
  const signedIn = () => {
    const token = bearer(request);
    return { token, accountId: accounts.session(token) };
  };
  const signedInResult = (accountId: string) => ({ accountToken: accounts.issueSession(accountId), account: accounts.profile(accountId) });

  /** No bearer: log in. A visit renewal token plus the character token: save. An account token: add a login. */
  const intent = async (token?: string): Promise<Pending> => {
    if (!request.headers.has('Authorization')) return { intent: 'login' };
    const presented = bearer(request);
    if (presented.startsWith('bgu_')) return { intent: 'add', accountId: accounts.session(presented) };
    if (!presented.startsWith('bgr_') || !token) throw new ApiError(400, 'character_required', 'Enter the island before saving your character.');
    const found = lookupRenewal(deps.renewals(), presented, now);
    if ((JSON.parse(found.config) as { kind?: string }).kind === 'agent') throw new ApiError(403, 'browser_only', 'Accounts are for browser players.');
    deps.take(`account-link:${found.identity}`, 5, 1 / 60, now);
    const credential = { uri: env.SPACETIME_URI, database: env.SPACETIME_DB, identity: found.identity, token };
    await deps.verifyCredential(credential);
    return { intent: 'save', link: { identity: found.identity, config: found.config, credential, sessionId: found.session_id } };
  };

  if (OAUTH_CALLBACK.test(path)) {
    // A top-level navigation back from Discord/Google: always land on the game, which calls /oauth/finish.
    const provider = OAUTH_CALLBACK.exec(path)![1] as 'discord' | 'google';
    const binding = readCookie(request);
    const done = new Response(null, { status: 303, headers: { Location: '/play#account', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    if (!binding || request.method !== 'GET') return done;
    let pending: OAuthPending;
    try { pending = accounts.peek<OAuthPending>(binding, 'oauth'); } catch { return done; }
    if (pending.result) return done;
    const params = new URL(request.url).searchParams;
    let result: OAuthPending['result'];
    try {
      if (pending.provider !== provider || params.get('state') !== pending.state) throw new ApiError(401, 'login_expired', 'This login attempt expired. Start again.');
      if (params.get('error') || !params.get('code')) throw new ApiError(401, 'login_cancelled', 'The login was cancelled.');
      const tokens = await oauthClient(env, provider).validateAuthorizationCode(params.get('code')!, pending.verifier);
      let login: Login;
      if (provider === 'discord') {
        const response = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${tokens.accessToken()}` } });
        if (!response.ok) throw new ApiError(502, 'provider_failed', 'Discord did not confirm the login. Try again.');
        const user = await response.json() as { id: string; username: string; global_name?: string | null };
        login = { provider, subject: user.id, label: (user.global_name || user.username).slice(0, 64) };
      } else {
        const claims = decodeIdToken(tokens.idToken()) as { sub: string; email?: string; email_verified?: boolean };
        login = { provider, subject: claims.sub, label: claims.email && claims.email_verified ? maskEmail(claims.email.toLowerCase()) : 'Google account' };
      }
      const accountId = accounts.complete(pending.intent, login, pending);
      result = { accountToken: accounts.issueSession(accountId) };
    } catch (error) {
      const safe = error instanceof ApiError ? error : new ApiError(502, 'provider_failed', 'The login provider could not be reached. Try again.');
      result = { error: { status: safe.status, ...errorBody(safe).error } };
    }
    try { accounts.update(binding, 'oauth', { ...pending, link: undefined, result }); } catch { /* Expired meanwhile: finish reports it. */ }
    return done;
  }

  if (path === `${ACCOUNT_BASE}/providers` && request.method === 'GET') {
    return send(200, { discord: !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET), google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), email: !!(env.EMAIL && env.EMAIL_FROM), passkey: true });
  }
  if (path === ACCOUNT_BASE && request.method === 'GET') return send(200, accounts.profile(signedIn().accountId));
  if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed', 'Use POST.');
  deps.take(`account:${deps.ip}`, 30, 1 / 6, now);

  if (path === `${ACCOUNT_BASE}/oauth/start`) {
    const input = validateObject(await readJson(request), { provider: { type: 'string', minLength: 6, maxLength: 7, enum: ['discord', 'google'] }, ...tokenField }, ['provider']);
    const provider = input.provider as 'discord' | 'google';
    const client = oauthClient(env, provider);
    const pending: OAuthPending = { ...(await intent(input.token)), provider, state: generateState(), verifier: generateCodeVerifier() };
    const binding = accounts.begin('oauth', pending, 'bgx_');
    const url = client.createAuthorizationURL(pending.state, pending.verifier, provider === 'discord' ? ['identify'] : ['openid', 'email']);
    if (provider === 'google') url.searchParams.set('prompt', 'select_account');
    const response = send(200, { url: url.toString() });
    response.headers.append('Set-Cookie', cookie(binding, 600));
    return response;
  }
  if (path === `${ACCOUNT_BASE}/oauth/finish`) {
    validateObject(await readJson(request), {}, []);
    const binding = readCookie(request);
    if (!binding) throw new ApiError(401, 'login_expired', 'This login attempt expired. Start again.');
    const pending = accounts.peek<OAuthPending>(binding, 'oauth');
    if (!pending.result) throw new ApiError(409, 'login_pending', 'Finish logging in with the provider first.');
    accounts.consume(binding, 'oauth');
    const result = pending.result;
    const response = result.accountToken
      ? send(200, { accountToken: result.accountToken, account: accounts.profile(accounts.session(result.accountToken)) })
      : send(result.error!.status, { error: { code: result.error!.code, message: result.error!.message } });
    response.headers.append('Set-Cookie', cookie('', 0));
    return response;
  }
  if (path === `${ACCOUNT_BASE}/email/start`) {
    if (!env.EMAIL || !env.EMAIL_FROM) throw new ApiError(404, 'provider_unavailable', 'Email login is not available yet.');
    const input = validateObject(await readJson(request), { email: { type: 'string', minLength: 3, maxLength: 254 }, ...tokenField }, ['email']);
    const email = normalizeEmail(input.email), subject = emailSubject(email);
    deps.take(`email:${subject}`, 3, 1 / 600, now);
    deps.take(`email-ip:${deps.ip}`, 5, 1 / 600, now);
    deps.take('email:global', 200, 200 / 3600, now);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const pending: EmailPending = { ...(await intent(input.token)), subject, label: maskEmail(email), code: digest(code), attempts: 0 };
    const requestId = accounts.begin('email', pending, 'bge_', EMAIL_TTL_MS);
    const link = `${env.PUBLIC_ORIGIN}/play#login=${requestId}.${code}`;
    try {
      await env.EMAIL.send({ to: email, from: { email: env.EMAIL_FROM, name: 'BeriGame' }, subject: `BeriGame login code: ${code}`,
        text: `Open this link to log in to BeriGame:\n${link}\n\nOr enter this code in the game: ${code}\n\nThe link and code expire in 15 minutes. If you did not ask to log in, ignore this email.`,
        html: `<p>Open this link to log in to BeriGame:</p><p><a href="${link}">Log in to BeriGame</a></p><p>Or enter this code in the game: <strong style="font-size:20px;letter-spacing:2px">${code}</strong></p><p>The link and code expire in 15 minutes. If you did not ask to log in, ignore this email.</p>` });
    } catch (error) {
      accounts.consume(requestId, 'email');
      console.warn('Login email failed', (error as { code?: string })?.code ?? (error as Error)?.name ?? 'unknown');
      throw new ApiError(503, 'email_unavailable', 'The login email could not be sent. Try again shortly.');
    }
    return send(200, { requestId, expiresAt: new Date(now + EMAIL_TTL_MS).toISOString() });
  }
  if (path === `${ACCOUNT_BASE}/email/verify`) {
    const input = validateObject(await readJson(request), { requestId: { type: 'string', minLength: 47, maxLength: 47, pattern: '^bge_[A-Za-z0-9_-]{43}$' },
      code: { type: 'string', minLength: 6, maxLength: 6, pattern: '^[0-9]{6}$' } }, ['requestId', 'code']);
    const pending = accounts.peek<EmailPending>(input.requestId, 'email');
    if (digest(input.code) !== pending.code) {
      if (pending.attempts + 1 >= EMAIL_CODE_ATTEMPTS) accounts.consume(input.requestId, 'email');
      else accounts.update(input.requestId, 'email', { ...pending, attempts: pending.attempts + 1 });
      throw new ApiError(401, 'wrong_code', pending.attempts + 1 >= EMAIL_CODE_ATTEMPTS ? 'Too many wrong codes. Request a new email.' : 'That code is not right. Check the latest email and try again.');
    }
    accounts.consume(input.requestId, 'email');
    return send(200, signedInResult(accounts.complete(pending.intent, { provider: 'email', subject: pending.subject, label: pending.label }, pending)));
  }
  if (path === `${ACCOUNT_BASE}/passkey/options`) {
    const input = validateObject(await readJson(request), { mode: { type: 'string', minLength: 5, maxLength: 8, enum: ['register', 'login'] }, ...tokenField }, ['mode']);
    const pending = await intent(input.token);
    if ((input.mode === 'login') !== (pending.intent === 'login')) throw new ApiError(400, 'invalid_arguments', 'Log in with a passkey before you are signed in, or add one while signed in.');
    const options = input.mode === 'login'
      ? await generateAuthenticationOptions({ rpID: rpID(env), userVerification: 'preferred' })
      : await generateRegistrationOptions({ rpName: 'BeriGame', rpID: rpID(env), userName: 'BeriGame player', userDisplayName: 'BeriGame player',
          userID: pending.accountId ? Buffer.from(digest(pending.accountId).slice(0, 32), 'hex') : randomBytes(16), attestationType: 'none',
          authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
          excludeCredentials: pending.accountId ? deps.sql.exec<{ subject: string }>("SELECT subject FROM account_logins WHERE account_id = ? AND provider = 'passkey'", pending.accountId).toArray().map(row => ({ id: row.subject })) : [] });
    const challengeId = accounts.begin('passkey', { ...pending, mode: input.mode, challenge: options.challenge } satisfies PasskeyPending, 'bgp_', 5 * 60_000);
    return send(200, { challengeId, options });
  }
  if (path === `${ACCOUNT_BASE}/passkey/verify`) {
    const input = validateObject(await readJson(request, 16_384), { challengeId: { type: 'string', minLength: 47, maxLength: 47, pattern: '^bgp_[A-Za-z0-9_-]{43}$' },
      response: { type: 'string', minLength: 2, maxLength: 12_000 } }, ['challengeId', 'response']);
    const pending = accounts.consume<PasskeyPending>(input.challengeId, 'passkey');
    let response: any;
    try { response = JSON.parse(input.response); } catch { throw new ApiError(400, 'invalid_arguments', 'Send the passkey response as JSON.'); }
    const rejected = () => new ApiError(401, 'passkey_rejected', 'The passkey could not be verified. Try again.');
    const expected = { expectedChallenge: pending.challenge, expectedOrigin: env.PUBLIC_ORIGIN, expectedRPID: rpID(env) };
    if (pending.mode === 'register') {
      let verified;
      try { verified = await verifyRegistrationResponse({ response: response as RegistrationResponseJSON, ...expected }); } catch { throw rejected(); }
      if (!verified.verified) throw rejected();
      const credential = verified.registrationInfo.credential;
      const login: Login = { provider: 'passkey', subject: credential.id, label: verified.registrationInfo.credentialDeviceType === 'multiDevice' ? 'Synced passkey' : 'Passkey',
        data: JSON.stringify({ publicKey: b64url(credential.publicKey), counter: credential.counter, transports: credential.transports ?? [] }) };
      return send(200, signedInResult(accounts.complete(pending.intent, login, pending)));
    }
    if (typeof response?.id !== 'string' || !/^[A-Za-z0-9_-]{16,1400}$/.test(response.id)) throw rejected();
    const stored = deps.sql.exec<LoginRow>("SELECT * FROM account_logins WHERE provider = 'passkey' AND subject = ?", response.id).toArray()[0];
    if (!stored?.data) throw noAccount();
    const key = JSON.parse(stored.data) as { publicKey: string; counter: number; transports: string[] };
    let verified;
    try {
      verified = await verifyAuthenticationResponse({ response: response as AuthenticationResponseJSON, ...expected,
        credential: { id: stored.subject, publicKey: new Uint8Array(Buffer.from(key.publicKey, 'base64url')), counter: key.counter, transports: key.transports } });
    } catch { throw rejected(); }
    if (!verified.verified) throw rejected();
    const login: Login = { provider: 'passkey', subject: stored.subject, label: stored.label, data: JSON.stringify({ ...key, counter: verified.authenticationInfo.newCounter }) };
    return send(200, signedInResult(accounts.complete('login', login)));
  }

  const { token, accountId } = signedIn();
  if (path === `${ACCOUNT_BASE}/play`) {
    validateObject(await readJson(request), {}, []);
    deps.take(`account-play:${accountId}`, 5, 1 / 60, now);
    const link = accounts.character(accountId);
    if (link.credential.uri !== env.SPACETIME_URI || link.credential.database !== env.SPACETIME_DB) throw new ApiError(404, 'no_character', 'This account has no character in this world.');
    const renewToken = `bgr_${randomBytes(32).toString('base64url')}`;
    // Replaces any other browser's renewal; that browser signs in again with its account.
    deps.renewals().put({ key: digest(renewToken), prev_key: null, prev_until: 0, identity: link.identity, session_id: link.sessionId, config: link.config, expires_at: now + RENEWAL_TTL_MS });
    const invite = JSON.parse(link.config) as Invite;
    return send(200, { ...link.credential, playerId: link.identity, renewToken, permissions: { combat: invite.combat, chat: invite.chat } });
  }
  if (path === `${ACCOUNT_BASE}/logins/remove`) {
    const input = validateObject(await readJson(request), { id: { type: 'string', minLength: 16, maxLength: 16, pattern: '^[0-9a-f]{16}$' } }, ['id']);
    accounts.removeLogin(accountId, input.id);
    return send(200, accounts.profile(accountId));
  }
  if (path === `${ACCOUNT_BASE}/logout`) {
    validateObject(await readJson(request), {}, []);
    accounts.endSession(token);
    return send(204);
  }
  throw new ApiError(404, 'not_found', 'Unknown account endpoint.');
}

