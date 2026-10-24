import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const HEX = 'ab'.repeat(32);
const conn = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock('spacetimedb/react', () => {
  const identity = { __identity__: 1n, toHexString: () => 'ab'.repeat(32) };
  const table = { iter: () => conn.rows, onInsert() {}, onDelete() {}, onUpdate() {}, removeOnInsert() {}, removeOnDelete() {}, removeOnUpdate() {} };
  const connection = { db: new Proxy({}, { get: (_t, key) => (key === 'frontierView' ? table : undefined) }) };
  return { useSpacetimeDB: () => ({ identity, getConnection: () => connection }) };
});
import { useLedger } from '../spacetime/hooks';

describe('useLedger', () => {
  it("parses your ledger row and ignores others' and other kinds", () => {
    conn.rows = [
      { key: 'a', kind: 'energy', source: `energy:${HEX}`, data: '{"day":1,"done":7}' },
      { key: 'b', kind: 'ledger', source: `ledger:${'cd'.repeat(32)}`, data: '{"id":"x","day":1,"done":7}' },
      { key: 'c', kind: 'ledger', source: `ledger:${HEX}`, data: `{"id":"${HEX}","day":20000,"done":2}` },
    ];
    expect(renderHook(() => useLedger()).result.current).toEqual({ day: 20000, done: 2 });
  });

  it('is undefined with no row or a malformed one', () => {
    conn.rows = [];
    expect(renderHook(() => useLedger()).result.current).toBeUndefined();
    conn.rows = [{ key: 'c', kind: 'ledger', source: `ledger:${HEX}`, data: 'not json' }];
    expect(renderHook(() => useLedger()).result.current).toBeUndefined();
  });
});
