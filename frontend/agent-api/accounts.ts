import { ApiError, digest, secret } from './portable';

/**
 * Player accounts. An account is a set of logins (Discord, Google, email,
 * passkeys) that unlock one saved character: the same sealed credential the
 * recovery key uses, so the SpacetimeDB identity never changes. Accounts are
 * only created by saving a character a guest is already playing.
 *
 * Login subjects are provider ids; emails are stored only as a digest plus a
 * masked label. Session tokens and one-time secrets are stored as digests.
 */
export const ACCOUNT_PREFIX = 'bgu_';
export const ACCOUNT_TTL_MS = 180 * 86400_000;
export const PENDING_TTL_MS = 10 * 60_000;
export const MAX_LOGINS = 10;
export const MAX_ACCOUNTS = 10_000;
export const EMAIL_CODE_ATTEMPTS = 5;

export type Provider = 'discord' | 'google' | 'email' | 'passkey';
export type Intent = 'login' | 'save' | 'add';
/** The sealed character, in the same shape as a recovery record. */
export type CharacterLink = { identity: string; config: string; credential: { uri: string; database: string; identity: string; token: string }; sessionId: string };
export type Login = { provider: Provider; subject: string; label: string; data?: string };
export type AccountRow = { id: string; identity: string | null; character: string | null; created_at: number; seen_at: number };
export type LoginRow = { provider: Provider; subject: string; account_id: string; label: string; data: string | null; created_at: number };

export interface AccountStore {
  account(id: string): AccountRow | undefined;
  accountByIdentity(identity: string): AccountRow | undefined;
  accountCount(): number;
  putAccount(row: AccountRow): void;
  login(provider: Provider, subject: string): LoginRow | undefined;
  logins(accountId: string): LoginRow[];
  putLogin(row: LoginRow): void;
  removeLogin(provider: Provider, subject: string): void;
  session(key: string): { account_id: string; expires_at: number } | undefined;
  putSession(key: string, accountId: string, expiresAt: number): void;
  removeSession(key: string): void;
  pending(key: string): { kind: string; payload: string; expires_at: number } | undefined;
  putPending(key: string, kind: string, payload: string, expiresAt: number): void;
  removePending(key: string): void;
  /** Runs fn atomically. */
  transaction<T>(fn: () => T): T;
}
export interface Sealer { seal(value: unknown): string; open<T>(sealed: string): T }

export const noAccount = () => new ApiError(404, 'no_account', 'No saved character uses this login yet. Enter the island as a guest, then save your character from Settings.');
const loginInUse = () => new ApiError(409, 'login_in_use', 'This login already belongs to another BeriGame account.');
const otherCharacter = () => new ApiError(409, 'account_has_character', 'This login already saves a different character. Log in with it from the title screen to play that character.');
export const accountSessionEnded = () => new ApiError(401, 'account_session_ended', 'Your account sign-in has ended. Log in again.');

export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@"<>()[\]\\,;:]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(email)) {
    throw new ApiError(400, 'invalid_email', 'Enter a valid email address.');
  }
  return email;
}
/** Shown in Settings so players can tell logins apart without the server keeping the address. */
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}${'•'.repeat(Math.min(6, Math.max(2, name.length - 1)))}@${domain}`;
}
export const emailSubject = (email: string) => digest(`berigame-email-v1\0${email}`);

export class Accounts {
  constructor(private store: AccountStore, private sealer: Sealer, private now: () => number = Date.now) {}

  /** A one-time record (OAuth state, passkey challenge, email code). Returns the secret that names it. */
  begin(kind: string, payload: unknown, prefix = 'bgx_', ttl = PENDING_TTL_MS): string {
    const key = secret(prefix);
    this.store.putPending(digest(key), kind, this.sealer.seal(payload), this.now() + ttl);
    return key;
  }
  peek<T>(key: string, kind: string): T {
    const row = this.store.pending(digest(key));
    if (!row || row.kind !== kind || row.expires_at <= this.now()) throw new ApiError(401, 'login_expired', 'This login attempt expired. Start again.');
    return this.sealer.open<T>(row.payload);
  }
  update(key: string, kind: string, payload: unknown): void {
    const row = this.store.pending(digest(key));
    if (!row || row.kind !== kind) throw new ApiError(401, 'login_expired', 'This login attempt expired. Start again.');
    this.store.putPending(digest(key), kind, this.sealer.seal(payload), row.expires_at);
  }
  /** Reads and deletes a one-time record. */
  consume<T>(key: string, kind: string): T {
    const value = this.peek<T>(key, kind);
    this.store.removePending(digest(key));
    return value;
  }

  /**
   * Applies a verified login. `login` finds the account, `add` attaches the
   * login to the signed-in account, `save` attaches the guest's character.
   */
  complete(intent: Intent, login: Login, context: { accountId?: string; link?: CharacterLink } = {}): string {
    return this.store.transaction(() => {
      const now = this.now();
      const existing = this.store.login(login.provider, login.subject);
      const attach = (accountId: string) => {
        if (existing) {
          if (existing.account_id !== accountId) throw loginInUse();
          if (login.data) this.store.putLogin({ ...existing, data: login.data });
          return;
        }
        if (this.store.logins(accountId).length >= MAX_LOGINS) throw new ApiError(409, 'too_many_logins', `An account can have at most ${MAX_LOGINS} logins. Remove one first.`);
        this.store.putLogin({ provider: login.provider, subject: login.subject, account_id: accountId, label: login.label, data: login.data ?? null, created_at: now });
      };
      if (intent === 'login') {
        if (!existing || !this.store.account(existing.account_id)) throw noAccount();
        if (login.data) this.store.putLogin({ ...existing, data: login.data });
        return existing.account_id;
      }
      if (intent === 'add') {
        if (!context.accountId || !this.store.account(context.accountId)) throw accountSessionEnded();
        attach(context.accountId);
        return context.accountId;
      }
      const link = context.link;
      if (!link) throw new ApiError(400, 'character_required', 'Enter the island before saving your character.');
      const character = this.sealer.seal(link);
      const owner = this.store.accountByIdentity(link.identity);
      if (existing) {
        const account = this.store.account(existing.account_id)!;
        if (owner?.id === account.id) { this.store.putAccount({ ...owner, character, seen_at: now }); attach(account.id); return account.id; }
        if (account.identity || owner) throw otherCharacter();
        this.store.putAccount({ ...account, identity: link.identity, character, seen_at: now });
        attach(account.id);
        return account.id;
      }
      if (owner) { this.store.putAccount({ ...owner, character, seen_at: now }); attach(owner.id); return owner.id; }
      if (this.store.accountCount() >= MAX_ACCOUNTS) throw new ApiError(429, 'account_capacity', 'Account capacity reached. Try again later.', 3600);
      const id = crypto.randomUUID();
      this.store.putAccount({ id, identity: link.identity, character, created_at: now, seen_at: now });
      attach(id);
      return id;
    });
  }

  issueSession(accountId: string): string {
    const token = secret(ACCOUNT_PREFIX);
    this.store.putSession(digest(token), accountId, this.now() + ACCOUNT_TTL_MS);
    return token;
  }
  /** Resolves an account session and slides its expiry. */
  session(token: string): string {
    if (!token.startsWith(ACCOUNT_PREFIX)) throw accountSessionEnded();
    const key = digest(token), row = this.store.session(key), now = this.now();
    if (!row || row.expires_at <= now || !this.store.account(row.account_id)) { if (row) this.store.removeSession(key); throw accountSessionEnded(); }
    if (row.expires_at - now < ACCOUNT_TTL_MS - 86400_000) this.store.putSession(key, row.account_id, now + ACCOUNT_TTL_MS);
    return row.account_id;
  }
  endSession(token: string): void { this.store.removeSession(digest(token)); }

  profile(accountId: string) {
    const account = this.store.account(accountId);
    if (!account) throw accountSessionEnded();
    return {
      playerId: account.identity,
      logins: this.store.logins(accountId).map(row => ({ provider: row.provider, id: digest(`${row.provider}\0${row.subject}`).slice(0, 16), label: row.label, createdAt: new Date(row.created_at).toISOString() })),
    };
  }
  removeLogin(accountId: string, id: string): void {
    this.store.transaction(() => {
      const logins = this.store.logins(accountId);
      const row = logins.find(row => digest(`${row.provider}\0${row.subject}`).slice(0, 16) === id);
      if (!row) throw new ApiError(404, 'login_not_found', 'That login is not on this account.');
      if (logins.length <= 1) throw new ApiError(409, 'last_login', 'Add another login before removing this one.');
      this.store.removeLogin(row.provider, row.subject);
    });
  }
  character(accountId: string): CharacterLink {
    const account = this.store.account(accountId);
    if (!account) throw accountSessionEnded();
    if (!account.character) throw new ApiError(404, 'no_character', 'This account has no saved character. Enter as a guest, then save your character.');
    this.store.putAccount({ ...account, seen_at: this.now() });
    return this.sealer.open<CharacterLink>(account.character);
  }
}
