import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digest } from './portable';
import { sealRecovery, openRecovery } from './recovery';
import { Accounts, ACCOUNT_TTL_MS, emailSubject, maskEmail, normalizeEmail, type AccountRow, type AccountStore, type CharacterLink, type LoginRow } from './accounts';

function memoryStore() {
  const accounts = new Map<string, AccountRow>(), logins = new Map<string, LoginRow>();
  const sessions = new Map<string, { account_id: string; expires_at: number }>();
  const pending = new Map<string, { kind: string; payload: string; expires_at: number }>();
  const store: AccountStore = {
    account: id => accounts.get(id),
    accountByIdentity: identity => [...accounts.values()].find(row => row.identity === identity),
    accountCount: () => accounts.size,
    putAccount: row => { accounts.set(row.id, row); },
    login: (provider, subject) => logins.get(`${provider}:${subject}`),
    logins: id => [...logins.values()].filter(row => row.account_id === id),
    putLogin: row => { logins.set(`${row.provider}:${row.subject}`, row); },
    removeLogin: (provider, subject) => { logins.delete(`${provider}:${subject}`); },
    session: key => sessions.get(key),
    putSession: (key, account_id, expires_at) => { sessions.set(key, { account_id, expires_at }); },
    removeSession: key => { sessions.delete(key); },
    pending: key => pending.get(key),
    putPending: (key, kind, payload, expires_at) => { pending.set(key, { kind, payload, expires_at }); },
    removePending: key => { pending.delete(key); },
    transaction: fn => {
      const snapshot = [new Map(accounts), new Map(logins)] as const;
      try { return fn(); }
      catch (error) {
        accounts.clear(); snapshot[0].forEach((v, k) => accounts.set(k, v));
        logins.clear(); snapshot[1].forEach((v, k) => logins.set(k, v));
        throw error;
      }
    },
  };
  let clock = 1_000;
  const sealer = { seal: (value: unknown) => sealRecovery(value, 'test-key'), open: <T>(sealed: string) => openRecovery<T>(sealed, 'test-key') };
  return { accounts, logins, sessions, pending, store, tick: (ms: number) => { clock += ms; }, service: new Accounts(store, sealer, () => clock) };
}
const code = (error: unknown) => (error as { code?: string }).code;
const link = (identity: string): CharacterLink => ({ identity, config: '{}', sessionId: `session-${identity}`,
  credential: { uri: 'wss://world', database: 'beta', identity, token: `token-${identity}` } });
const discord = { provider: 'discord' as const, subject: '123', label: 'berifan' };
const google = { provider: 'google' as const, subject: 'g-1', label: 'b•••@gmail.com' };

test('only saving a character creates an account, and logging in returns that character', () => {
  const { service, accounts } = memoryStore();
  assert.throws(() => service.complete('login', discord), error => code(error) === 'no_account');
  assert.equal(accounts.size, 0);
  const id = service.complete('save', discord, { link: link('aa') });
  assert.equal(service.complete('login', discord), id);
  assert.deepEqual(service.character(id), link('aa'));
  assert.ok(!accounts.get(id)!.character!.includes('token-aa'), 'the character credential is sealed at rest');
});

test('saving again with the same login, or a second login, keeps one account per character', () => {
  const { service, accounts } = memoryStore();
  const id = service.complete('save', discord, { link: link('aa') });
  assert.equal(service.complete('save', discord, { link: link('aa') }), id);
  assert.equal(service.complete('save', google, { link: link('aa') }), id);
  assert.equal(accounts.size, 1);
  assert.deepEqual(service.profile(id).logins.map(row => row.provider).sort(), ['discord', 'google']);
});

test('a login that already saves one character cannot be pointed at another', () => {
  const { service } = memoryStore();
  const id = service.complete('save', discord, { link: link('aa') });
  assert.throws(() => service.complete('save', discord, { link: link('bb') }), error => code(error) === 'account_has_character');
  assert.deepEqual(service.character(id).identity, 'aa');
  const other = service.complete('save', google, { link: link('bb') });
  assert.throws(() => service.complete('add', discord, { accountId: other }), error => code(error) === 'login_in_use');
});

test('logins can be added and removed, but never the last one', () => {
  const { service } = memoryStore();
  const id = service.complete('save', discord, { link: link('aa') });
  assert.equal(service.complete('add', google, { accountId: id }), id);
  const [first, second] = service.profile(id).logins;
  service.removeLogin(id, first.id);
  assert.throws(() => service.removeLogin(id, second.id), error => code(error) === 'last_login');
  assert.throws(() => service.complete('add', discord, {}), error => code(error) === 'account_session_ended');
});

test('account sessions are stored as digests, slide forward when used, and expire', () => {
  const { service, sessions, tick } = memoryStore();
  const id = service.complete('save', discord, { link: link('aa') });
  const token = service.issueSession(id);
  assert.match(token, /^bgu_[A-Za-z0-9_-]{43}$/);
  assert.ok(sessions.has(digest(token)) && !sessions.has(token));
  tick(ACCOUNT_TTL_MS - 1000);
  assert.equal(service.session(token), id);
  tick(ACCOUNT_TTL_MS - 1000);
  assert.equal(service.session(token), id, 'use within the window extends the session');
  tick(ACCOUNT_TTL_MS);
  assert.throws(() => service.session(token), error => code(error) === 'account_session_ended');
  service.endSession(service.issueSession(id));
});

test('one-time records are sealed, single use and expire', () => {
  const { service, pending, tick } = memoryStore();
  const key = service.begin('oauth', { verifier: 'secret-verifier' });
  assert.ok(![...pending.values()][0].payload.includes('secret-verifier'));
  assert.deepEqual(service.consume(key, 'oauth'), { verifier: 'secret-verifier' });
  assert.throws(() => service.consume(key, 'oauth'), error => code(error) === 'login_expired');
  const late = service.begin('oauth', {});
  assert.throws(() => service.peek(late, 'passkey'), error => code(error) === 'login_expired');
  tick(11 * 60_000);
  assert.throws(() => service.peek(late, 'oauth'), error => code(error) === 'login_expired');
});

test('emails are normalised, kept only as a digest and shown masked', () => {
  assert.equal(normalizeEmail('  Beri@Example.COM '), 'beri@example.com');
  assert.throws(() => normalizeEmail('not-an-email'), error => code(error) === 'invalid_email');
  assert.notEqual(emailSubject('beri@example.com'), 'beri@example.com');
  assert.equal(maskEmail('beri@example.com'), 'b•••@example.com');
});
