import { beforeEach, describe, expect, it } from 'vitest';
import { LEGACY_TOKEN_KEY, readSessionToken, resetSessionToken, sessionTokenKey, visiblyInvalidToken } from '../spacetime/sessionToken';

const entries = new Map<string, string>();
const localStorage: Storage = {
  get length() { return entries.size; },
  clear: () => entries.clear(),
  getItem: (key) => entries.get(key) ?? null,
  setItem: (key, value) => { entries.set(key, value); },
  removeItem: (key) => { entries.delete(key); },
  key: (index) => [...entries.keys()][index] ?? null,
};
beforeEach(() => localStorage.clear());
describe('scoped anonymous character credentials', () => {
  it('isolates both server and database without exposing the credential in the key', () => {
    const a = sessionTokenKey('ws://localhost:3000', 'first');
    const b = sessionTokenKey('ws://localhost:3000', 'second');
    const c = sessionTokenKey('wss://game.example', 'first');
    expect(new Set([a, b, c]).size).toBe(3);
    localStorage.setItem(a, 'saved-character');
    expect(readSessionToken(localStorage, 'ws://localhost:3000', 'first')).toBe('saved-character');
    expect(readSessionToken(localStorage, 'ws://localhost:3000', 'second')).toBeUndefined();
    expect(readSessionToken(localStorage, 'wss://game.example', 'first')).toBeUndefined();
  });
  it('migrates a legacy local identity once, preserving its original copy', () => {
    localStorage.setItem(LEGACY_TOKEN_KEY, 'legacy-character');
    expect(readSessionToken(localStorage, 'ws://localhost:3000', 'berigame-graphics-review')).toBe('legacy-character');
    expect(localStorage.getItem(LEGACY_TOKEN_KEY)).toBe('legacy-character');
    expect(readSessionToken(localStorage, 'ws://localhost:3000', 'other-world')).toBeUndefined();
    expect(readSessionToken(localStorage, 'ws://127.0.0.1:3000', 'berigame-graphics-review')).toBeUndefined();
  });
  it('never sends an unscoped legacy credential to a different server', () => {
    localStorage.setItem(LEGACY_TOKEN_KEY, 'legacy-character');
    expect(readSessionToken(localStorage, 'wss://game.example', 'berigame')).toBeUndefined();
    expect(readSessionToken(localStorage, 'ws://localhost:4000', 'berigame')).toBeUndefined();
  });
  it('explicit reset backs up the current credential without resurrecting legacy or changing another world', () => {
    localStorage.setItem(LEGACY_TOKEN_KEY, 'legacy-character');
    readSessionToken(localStorage, 'ws://localhost:3000', 'berigame');
    const key = sessionTokenKey('ws://localhost:3000', 'berigame');
    const other = sessionTokenKey('ws://localhost:3000', 'other');
    localStorage.setItem(other, 'other-character');
    resetSessionToken(localStorage, key);
    const backup = [...entries.keys()].find((name) => name.startsWith(`${key}:backup:`));
    expect(backup).toBeDefined();
    expect(localStorage.getItem(backup!)).toBe('legacy-character');
    expect(readSessionToken(localStorage, 'ws://localhost:3000', 'berigame')).toBeUndefined();
    expect(localStorage.getItem(other)).toBe('other-character');
  });
  it('keeps the active credential when backup storage fails', () => {
    let removed = false;
    const storage = { getItem: () => 'saved-character', setItem: () => { throw new Error('quota'); }, removeItem: () => { removed = true; } } as unknown as Storage;
    expect(() => resetSessionToken(storage, 'key')).toThrow('quota');
    expect(removed).toBe(false);
  });
  it('invalidity hints never remove tokens, including merely expired tokens', () => {
    const token = (exp: number) => `e30.${btoa(JSON.stringify({ exp })).replace(/=/g, '')}.signature`;
    expect(visiblyInvalidToken('malformed')).toBe(true);
    expect(visiblyInvalidToken(token(Date.now() / 1000 - 60))).toBe(true);
    expect(visiblyInvalidToken(token(Date.now() / 1000 + 60))).toBe(false);
    localStorage.setItem('saved', 'malformed');
    visiblyInvalidToken(localStorage.getItem('saved')!);
    expect(localStorage.getItem('saved')).toBe('malformed');
  });
});
