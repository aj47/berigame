import { describe, expect, it, vi } from 'vitest';
import { subscribeSpire } from '../bosses/spireSubscription';
import { loadSpireScene } from '../bosses/spire/loadSpireScene';

function fakeConnection(rows: any[] = []) {
  const listeners = { insert: new Set<any>(), update: new Set<any>(), delete: new Set<any>() };
  const log: string[] = [];
  const handles: { query: string; unsubscribe: ReturnType<typeof vi.fn> }[] = [];
  const conn: any = {
    db: {
      spireMember: {
        iter: () => rows.values(),
        onInsert: (f: any) => listeners.insert.add(f), removeOnInsert: (f: any) => listeners.insert.delete(f),
        onUpdate: (f: any) => listeners.update.add(f), removeOnUpdate: (f: any) => listeners.update.delete(f),
        onDelete: (f: any) => listeners.delete.add(f), removeOnDelete: (f: any) => listeners.delete.delete(f),
      },
    },
    subscriptionBuilder: () => {
      const builder: any = {
        onError: () => builder,
        onApplied: () => builder,
        subscribe: (queries: string[]) => {
          const h = { query: queries[0], unsubscribe: vi.fn(() => log.push(`unsubscribe ${queries[0]}`)) };
          log.push(`subscribe ${queries[0]}`);
          handles.push(h);
          return h;
        },
      };
      return builder;
    },
  };
  const row = (hex: string, runId: bigint) => ({ identity: { toHexString: () => hex }, runId });
  const fire = {
    insert: (r: any) => listeners.insert.forEach((f) => f({}, r)),
    update: (prev: any, r: any) => listeners.update.forEach((f) => f({}, prev, r)),
    delete: (r: any) => listeners.delete.forEach((f) => f({}, r)),
  };
  return { conn, log, handles, row, fire, listeners };
}

describe('the per-run spire_fight subscription', () => {
  it('subscribes nothing without a membership and ignores other players', () => {
    const f = fakeConnection();
    subscribeSpire(f.conn, 'me', () => {});
    f.fire.insert(f.row('someone', 7n));
    expect(f.log).toEqual([]);
  });

  it('follows your run: subscribes the new run first, then drops the old one; none after leaving', () => {
    const f = fakeConnection();
    subscribeSpire(f.conn, 'me', () => {});
    f.fire.insert(f.row('me', 41n));
    expect(f.log).toEqual(['subscribe SELECT * FROM spire_fight WHERE run_id = 41']);
    f.fire.update(f.row('me', 41n), f.row('me', 41n));
    expect(f.log).toHaveLength(1);
    f.fire.update(f.row('me', 41n), f.row('me', 42n));
    expect(f.log.slice(1)).toEqual(['subscribe SELECT * FROM spire_fight WHERE run_id = 42', 'unsubscribe SELECT * FROM spire_fight WHERE run_id = 41']);
    f.fire.delete(f.row('me', 42n));
    expect(f.log.at(-1)).toBe('unsubscribe SELECT * FROM spire_fight WHERE run_id = 42');
    expect(f.handles).toHaveLength(2);
  });

  it('picks up an existing membership and cleans up on dispose', () => {
    const f = fakeConnection([{ identity: { toHexString: () => 'me' }, runId: 9n }]);
    const dispose = subscribeSpire(f.conn, 'me', () => {});
    expect(f.log).toEqual(['subscribe SELECT * FROM spire_fight WHERE run_id = 9']);
    dispose();
    expect(f.log.at(-1)).toBe('unsubscribe SELECT * FROM spire_fight WHERE run_id = 9');
    expect(f.listeners.insert.size + f.listeners.update.size + f.listeners.delete.size).toBe(0);
  });

  it('loads the Spire scene chunk once', () => {
    expect(loadSpireScene()).toBe(loadSpireScene());
  });
});
