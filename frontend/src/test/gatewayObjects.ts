import { DatabaseSync } from 'node:sqlite';
import { vi } from 'vitest';

type Sql = { exec(query: string, ...args: any[]): { toArray(): any[]; [Symbol.iterator](): Iterator<any> } };

/**
 * A Durable Object namespace for worker tests: one AgentGateway per name (the coordinator beta-v1 and the session
 * shards beta-v1/agents/<n>), each with its own in-memory SQLite. `all` runs a query on every object.
 */
export function gatewayObjects<G>(Gateway: new (ctx: any, env: any) => G, env: any, databases: DatabaseSync[]) {
  const objects = new Map<string, { gateway: G; sql: Sql }>();
  const open = (name: string) => {
    const db = new DatabaseSync(':memory:'); databases.push(db);
    const sql: Sql = { exec(query: string, ...args: any[]) {
      const rows = db.prepare(query).all(...args);
      return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
    } };
    const gateway = new Gateway({ storage: { sql, transactionSync: (fn: () => unknown) => fn(), setAlarm: vi.fn(), deleteAlarm: vi.fn(), sync: vi.fn() } }, env);
    const entry = { gateway, sql };
    objects.set(name, entry);
    return entry;
  };
  env.AGENT_GATEWAY = { idFromName: (name: string) => name, get: (name: string) => (objects.get(name) ?? open(name)).gateway };
  const home = open('beta-v1');
  const all = (query: string, ...args: any[]) => [...objects.values()].flatMap(o => o.sql.exec(query, ...args).toArray());
  const shards = () => [...objects.keys()].filter(name => name !== 'beta-v1');
  return { home, objects, all, shards };
}
