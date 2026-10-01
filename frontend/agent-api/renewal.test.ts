import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digest } from './portable';
import { issueRenewal, lookupRenewal, MAX_RENEWALS, RENEWAL_TTL_MS, ROTATION_GRACE_MS, rotateRenewal, type RenewalRow, type RenewalStore } from './renewal';

function memoryStore() {
  const rows = new Map<string, RenewalRow>();
  const store: RenewalStore = {
    byKey: key => [...rows.values()].find(row => row.key === key),
    byPrev: key => [...rows.values()].find(row => row.prev_key === key),
    count: () => rows.size,
    put: row => { rows.set(row.identity, row); },
    removeIdentity: identity => { rows.delete(identity); },
  };
  return { rows, store };
}
const code = (error: unknown) => (error as { code?: string }).code;
const A = 'aa'.repeat(32), B = 'bb'.repeat(32);

test('renewal tokens are random, stored only as digests and bound server-side to one identity', () => {
  const { rows, store } = memoryStore();
  const a = issueRenewal(store, A, 'session-a', '{}', 0);
  const b = issueRenewal(store, B, 'session-b', '{}', 0);
  assert.match(a, /^bgr_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.equal(rows.get(A)!.key, digest(a));
  assert.ok(![...rows.values()].some(row => JSON.stringify(row).includes(a)));
  assert.equal(lookupRenewal(store, a, 1).identity, A);
  assert.equal(lookupRenewal(store, b, 1).identity, B);
  for (const forged of ['bgr_' + 'A'.repeat(43), 'bgh_' + a.slice(4), digest(a)]) {
    assert.throws(() => lookupRenewal(store, forged, 1), e => code(e) === 'visit_ended');
  }
});

test('each use rotates; a racing tab gets 409 during the grace; replay after the grace ends renewal for everyone', () => {
  const { rows, store } = memoryStore();
  const first = issueRenewal(store, A, 's', '{}', 0);
  const row = lookupRenewal(store, first, 1000);
  const second = rotateRenewal(store, row, 1000);
  assert.notEqual(first, second);
  assert.throws(() => rotateRenewal(store, row, 1001), e => code(e) === 'renewed_elsewhere');
  assert.throws(() => lookupRenewal(store, first, 1000 + ROTATION_GRACE_MS - 1), e => code(e) === 'renewed_elsewhere');
  assert.equal(lookupRenewal(store, second, 2000).session_id, 's');
  assert.throws(() => lookupRenewal(store, first, 1000 + ROTATION_GRACE_MS + 1), e => code(e) === 'visit_ended');
  assert.equal(rows.size, 0);
  assert.throws(() => lookupRenewal(store, second, 3000), e => code(e) === 'visit_ended');
});

test('renewal slides for 30 days after the last use, then the browser becomes a new guest', () => {
  const { rows, store } = memoryStore();
  const token = issueRenewal(store, A, 's', '{}', 0);
  const next = rotateRenewal(store, lookupRenewal(store, token, RENEWAL_TTL_MS - 1), RENEWAL_TTL_MS - 1);
  assert.equal(lookupRenewal(store, next, 2 * RENEWAL_TTL_MS - 2).identity, A);
  assert.throws(() => lookupRenewal(store, next, 2 * RENEWAL_TTL_MS), e => code(e) === 'visit_ended');
  assert.equal(rows.size, 0);
});

test('stored renewals are capped', () => {
  const { store } = memoryStore();
  const full = { ...store, count: () => MAX_RENEWALS };
  assert.throws(() => issueRenewal(full, A, 's', '{}', 0), e => code(e) === 'renewal_capacity');
});
