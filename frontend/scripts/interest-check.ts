/**
 * Interest-management check against a local SpacetimeDB (owner-published
 * database, default `berigame-client`): three SDK clients with the browser's
 * own subscriptions (worldSubscription.ts + interestSubscription.ts). Places
 * them with owner SQL, moves the others, and checks that the observer receives
 * a nearby player's moves but not a far one's, follows its block when it moves,
 * and keeps a far friend's row through the identity query. Steps arrive as
 * player_pos updates; a walking neighbour's full player row is not re-sent
 * (the join on player_pos, shared/sim/interest.ts).
 *
 * Run: SPACETIME_DB=berigame-client npx tsx scripts/interest-check.ts
 */
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { DbConnection, tables } from '../src/module_bindings';
import { startInterest, type InterestConn, type InterestManager } from '../src/spacetime/interestSubscription';
import { WORLD_TABLES, worldQueries } from '../src/spacetime/worldSubscription';
import { playerView } from '../src/spacetime/playerView';

const URI = process.env.SPACETIME_URI ?? 'ws://127.0.0.1:3000';
const DB = process.env.SPACETIME_DB ?? 'berigame-client';
const CLI = process.env.SPACETIME_CLI ?? `${process.env.HOME}/.local/bin/spacetime`;
if (DB === 'berigame' || DB === 'berigame-tick') throw new Error('refusing to move players in a shared database');

interface Client { name: string; conn: DbConnection; hex: string; interest?: InterestManager; updates: Map<string, number>; rowUpdates: Map<string, number>; messages: number; emotes: string[] }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function sql(query: string): void {
  execFileSync(CLI, ['sql', DB, '--server', 'local', query], { cwd: tmpdir(), stdio: 'pipe' });
}

function connect(name: string, full: boolean): Promise<Client> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name}: connect timeout`)), 15_000);
    DbConnection.builder().withUri(URI).withDatabaseName(DB)
      .onConnectError((_c, e) => { clearTimeout(timer); reject(e); })
      .onConnect((conn, identity) => {
        const c: Client = { name, conn, hex: identity.toHexString(), updates: new Map(), rowUpdates: new Map(), messages: 0, emotes: [] };
        conn.db.emoteEvent.onInsert((_ctx, row) => c.emotes.push(row.player.toHexString()));
        const bump = (m: Map<string, number>, row: any) => { const h = row.identity.toHexString(); m.set(h, (m.get(h) ?? 0) + 1); };
        // Merged rows (steps included) and, separately, full player row updates.
        const view = playerView(conn);
        view.onUpdate((_ctx, _p, row) => { bump(c.updates, row); c.messages++; });
        view.onInsert((_ctx, row) => { bump(c.updates, row); c.messages++; });
        conn.db.player.onUpdate((_ctx, _p, row) => bump(c.rowUpdates, row));
        const queries = full
          ? [...WORLD_TABLES.map((n) => (tables as any)[n]), ...worldQueries()]
          : ['SELECT * FROM player WHERE identity = :sender', 'SELECT * FROM player_pos WHERE identity = :sender'];
        if (full) c.interest = startInterest(conn as unknown as InterestConn, c.hex, (q) => console.error(name, 'interest error', q));
        conn.subscriptionBuilder().onApplied(() => { clearTimeout(timer); resolve(c); }).onError((_x, e) => reject(e)).subscribe(queries);
      })
      .build();
  });
}

/** Both rows: while online the live position is player_pos (spacetimedb/src/lib/playerStore.ts). */
const place = (c: Client, x: number, z: number, region = 'bramblewild') => {
  sql(`UPDATE player SET x = ${x}, z = ${z}, region = '${region}' WHERE identity = 0x${c.hex}`);
  sql(`UPDATE player_pos SET x = ${x}, z = ${z}, region = '${region}' WHERE identity = 0x${c.hex}`);
};
const has = (obs: Client, other: Client) => [...playerView(obs.conn).iter()].some((p) => p.identity.toHexString() === other.hex);
const reset = (c: Client) => { c.updates.clear(); c.rowUpdates.clear(); c.messages = 0; };
const seen = (obs: Client, other: Client) => obs.updates.get(other.hex) ?? 0;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
}

async function wiggle(c: Client, x: number, z: number, ticks = 6): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await c.conn.reducers.setTarget({ x: x + (i % 2 ? 2 : -2), z }).catch(() => {});
    await sleep(700);
  }
}

async function main() {
  const a = await connect('observer', true);
  const b = await connect('near', false);
  const far = await connect('far', false);
  place(a, 40, 40); place(b, 44, 40); place(far, 200, 200);
  await sleep(2500);
  console.log('observer blocks', JSON.stringify(a.interest!.blocks()));
  console.log('observer subscriptions', JSON.stringify(a.interest!.snapshot(), null, 1));
  check('own row present', has(a, a));
  check('near player present', has(a, b));
  check('far player absent', !has(a, far));

  reset(a);
  await Promise.all([wiggle(b, 44, 40), wiggle(far, 200, 200)]);
  check('near moves received', seen(a, b) > 0, `${seen(a, b)} updates`);
  check('near moves did not re-send its player row', (a.rowUpdates.get(b.hex) ?? 0) === 0, `${a.rowUpdates.get(b.hex) ?? 0} player row updates`);
  check('far moves not received', seen(a, far) === 0, `${seen(a, far)} updates`);
  const firstWindow = a.messages;

  // Event tables are filtered by place too (x/z columns): a near emote arrives once, a far one never.
  a.emotes.length = 0;
  await b.conn.reducers.emote({ emote: 0 }).catch((e) => console.log('near emote failed', String(e)));
  await far.conn.reducers.emote({ emote: 0 }).catch((e) => console.log('far emote failed', String(e)));
  await sleep(1500);
  check('near emote received once', a.emotes.filter((h) => h === b.hex).length === 1, JSON.stringify(a.emotes.map((h) => h.slice(0, 8))));
  check('far emote not received', !a.emotes.includes(far.hex));

  // Walk the observer's block over to the far player: the old block is dropped once the new one is applied.
  place(a, 196, 200);
  await sleep(2500);
  check('after moving, far player present', has(a, far));
  check('after moving, old neighbour gone', !has(a, b));
  check('own row kept across the block change', has(a, a));
  reset(a);
  await Promise.all([wiggle(b, 44, 40), wiggle(far, 200, 200)]);
  check('new neighbour moves received', seen(a, far) > 0, `${seen(a, far)} updates`);
  check('old neighbour moves not received', seen(a, b) === 0, `${seen(a, b)} updates`);

  // A far friend stays visible by identity.
  await a.conn.reducers.addFriend({ target: b.conn.identity! }).catch((e) => console.log('add friend failed', String(e)));
  await sleep(1500);
  check('far friend row kept by identity', has(a, b), JSON.stringify(a.interest!.snapshot().friends));
  console.log(`player row messages on observer: window 1 ${firstWindow}, window 2 ${a.messages}`);

  // The Meadows seam: from Bramblewild's east edge the observer also holds the Meadows block.
  place(far, 6, 64, 'settlement');
  place(a, 250, 25);
  await sleep(2500);
  console.log('observer blocks at the seam', JSON.stringify(a.interest!.blocks()));
  check('Meadows player visible across the seam', has(a, far), JSON.stringify(a.interest!.snapshot().playersSeam));
  place(a, 40, 40);
  await sleep(2500);
  check('Meadows player dropped away from the seam', !has(a, far));

  // The party joins are accepted by the server for a normal (non-owner) client.
  const accepted = await new Promise<string>((resolve) => {
    a.conn.subscriptionBuilder().onApplied(() => resolve('ok')).onError((_c, e) => resolve(String(e)))
      .subscribe(['SELECT p.* FROM player p JOIN expedition_member m ON p.identity = m.identity WHERE m.expedition_id = 1',
        'SELECT p.* FROM player p JOIN spire_member m ON p.identity = m.identity WHERE m.run_id = 1',
        'SELECT q.* FROM player_pos q JOIN expedition_member m ON q.identity = m.identity WHERE m.expedition_id = 1',
        'SELECT q.* FROM player_pos q JOIN spire_member m ON q.identity = m.identity WHERE m.run_id = 1']);
  });
  check('party join queries accepted', accepted === 'ok', accepted);

  for (const c of [a, b, far]) { c.interest?.dispose(); c.conn.disconnect(); }
  console.log(failures ? `${failures} check(s) failed` : 'all interest checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
