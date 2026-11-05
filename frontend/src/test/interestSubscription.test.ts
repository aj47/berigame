import { describe, expect, it } from 'vitest';
import {
  CellSubscriptions, QuerySlot, cellGroups, globalEventQueries, identityLiteral, nextBlocks, startInterest, type InterestConn,
} from '../spacetime/interestSubscription';
import { GLOBAL_CELL, NODE_BLOCK, PLAYER_BLOCK, nodeCell, playerCell } from '../../../shared/sim/interest';
import { WORLD_TABLES, worldQueries } from '../spacetime/worldSubscription';
import { playerName } from '../spacetime/playerNames';

const ME = 'a'.repeat(64), FRIEND = 'b'.repeat(64), FOE = 'c'.repeat(64), STRANGER = 'd'.repeat(64), PARTNER = 'e'.repeat(64);
const id = (hex: string) => ({ toHexString: () => hex, __identity__: BigInt(`0x${hex}`) });

/** A connection whose subscriptions are applied by hand, recording every subscribe and unsubscribe. */
function fakeConn() {
  const log: string[] = [];
  const subs: { n: number; queries: string[]; applied?: () => void; ended: boolean }[] = [];
  const table = () => {
    const rows = new Map<string, any>();
    const cbs = { insert: new Set<any>(), update: new Set<any>(), delete: new Set<any>() };
    return {
      rows, cbs,
      iter: () => rows.values(),
      identity: { find: (who: any) => rows.get(who.toHexString()) },
      onInsert: (cb: any) => cbs.insert.add(cb), onUpdate: (cb: any) => cbs.update.add(cb), onDelete: (cb: any) => cbs.delete.add(cb),
      removeOnInsert: (cb: any) => cbs.insert.delete(cb), removeOnUpdate: (cb: any) => cbs.update.delete(cb), removeOnDelete: (cb: any) => cbs.delete.delete(cb),
      put(key: string, row: any) {
        const prev = rows.get(key);
        rows.set(key, row);
        if (prev) for (const cb of cbs.update) cb(undefined, prev, row); else for (const cb of cbs.insert) cb(undefined, row);
      },
      del(key: string) { const prev = rows.get(key); rows.delete(key); if (prev) for (const cb of cbs.delete) cb(undefined, prev); },
    };
  };
  const db = {
    player: table(), playerPos: table(), friend: table(), friendlyDuel: table(), trade: table(), expeditionMember: table(), spireMember: table(), chatMessage: table(),
  };
  const conn = {
    db,
    subscriptionBuilder() {
      let applied: (() => void) | undefined;
      const b: any = {
        onApplied(cb: any) { applied = () => cb({}); return b; },
        onError() { return b; },
        subscribe(queries: string[]) {
          const sub = { n: subs.length + 1, queries, applied, ended: false };
          subs.push(sub);
          log.push(`sub ${sub.n}`);
          return { unsubscribe() { sub.ended = true; log.push(`unsub ${sub.n}`); } };
        },
      };
      return b;
    },
  };
  const live = () => subs.filter((s) => !s.ended);
  const apply = (n?: number) => { for (const s of subs) if (n === undefined || s.n === n) s.applied?.(); };
  const last = () => subs[subs.length - 1];
  /** The live subscription of one cell group, by its first query. */
  const cellSub = (first: string) => subs.find((s) => s.queries[0] === first);
  const liveOf = (prefix: string) => live().filter((s) => s.queries[0].startsWith(prefix));
  return { conn: conn as unknown as InterestConn & typeof conn, db, log, subs, live, apply, last, cellSub, liveOf };
}

const player = (hex: string, at: { x: number; z: number; region?: string }, extra: Record<string, unknown> = {}) =>
  ({ identity: id(hex), name: `P-${hex.slice(0, 2)}`, online: true, region: 'bramblewild', combatTarget: undefined, ...at, ...extra });
/** A player_pos row: where a character stands while online (the server rewrites only this row for a step). */
const pos = (hex: string, at: { x: number; z: number; region?: string }) => ({ identity: id(hex), region: 'bramblewild', facing: 0, ...at });

describe('QuerySlot', () => {
  it('subscribes the new queries first and drops the old handle once they are applied', () => {
    const f = fakeConn();
    const slot = new QuerySlot(f.conn, () => {});
    slot.set(['q1']);
    f.apply(1);
    slot.set(['q1']);
    expect(f.log).toEqual(['sub 1']);
    slot.set(['q2']);
    expect(f.log).toEqual(['sub 1', 'sub 2']);
    f.apply(2);
    expect(f.log).toEqual(['sub 1', 'sub 2', 'unsub 1']);
  });

  it('collapses quick changes: the newest set drops every older handle when applied', () => {
    const f = fakeConn();
    const slot = new QuerySlot(f.conn, () => {});
    slot.set(['a']); f.apply(1);
    slot.set(['b']); slot.set(['c']);
    f.apply(2); // superseded: changes nothing
    expect(f.log).toEqual(['sub 1', 'sub 2', 'sub 3']);
    f.apply(3);
    expect(f.log.slice(3).sort()).toEqual(['unsub 1', 'unsub 2']);
    slot.set([]);
    expect(f.log.at(-1)).toBe('unsub 3');
  });
});

describe('interest plans', () => {
  it('keeps whole-table subscriptions off the spatial tables and always holds your own row', () => {
    const q = worldQueries();
    expect(WORLD_TABLES).not.toContain('player');
    expect(WORLD_TABLES).not.toContain('tree');
    expect(WORLD_TABLES).not.toContain('groundItem');
    expect(WORLD_TABLES).not.toContain('playerSkill');
    expect(WORLD_TABLES).not.toContain('adventureProfile');
    expect(WORLD_TABLES).not.toContain('mentorStat');
    expect(q).toContain('SELECT * FROM player WHERE identity = :sender');
    expect(q).toContain('SELECT * FROM player_pos WHERE identity = :sender');
    expect(WORLD_TABLES).not.toContain('playerPos');
    expect(q).toContain('SELECT * FROM player_skill WHERE identity = :sender');
    expect(q.some((s) => /FROM (player|player_pos|tree|ground_item)$/.test(s))).toBe(false);
  });

  it('splits positioned event tables into per-cell queries of your player block plus world-wide rows', () => {
    const groups = cellGroups(nextBlocks({ x: 20, z: 20 }));
    const c = playerCell('bramblewild', 20, 20);
    expect(groups.get(`local:${c}`)!.slice(2)).toEqual(['combat_event', 'dummy_event', 'emote_event', 'giant_event'].map((t) => `SELECT * FROM ${t} WHERE cell = ${c}`));
    expect(globalEventQueries(['combat_event', 'giant_event'])).toEqual([`SELECT * FROM combat_event WHERE cell = ${GLOBAL_CELL}`, `SELECT * FROM giant_event WHERE cell = ${GLOBAL_CELL}`]);
    const q = worldQueries();
    for (const t of ['combat_event', 'dummy_event', 'emote_event', 'giant_event']) {
      expect(q).not.toContain(`SELECT * FROM ${t}`);
      expect(q).toContain(`SELECT * FROM ${t} WHERE cell = 0`);
    }
    expect(worldQueries([])).toContain('SELECT * FROM combat_event');
    expect(WORLD_TABLES).toContain('bossEvent');
    // Events only for your own district: the seam's player cells carry none.
    const seam = cellGroups(nextBlocks({ x: 250, z: 25 }));
    const local = [...seam.keys()].filter((k) => k.startsWith('local:'));
    expect(local).toHaveLength(4); // 2 x 2: clamped at the east edge and z = 0
    expect(local.every((k) => seam.get(k)!.some((q) => q.includes('_event')))).toBe(true);
    const meadows = [...seam.keys()].filter((k) => k.startsWith('players:'));
    expect(meadows.length).toBeGreaterThan(0);
    expect(meadows.every((k) => !seam.get(k)!.some((q) => q.includes('_event')))).toBe(true);
  });

  it('holds the Meadows cells only near the seam, and Bramblewild nodes from the Meadows side', () => {
    const inland = cellGroups(nextBlocks({ x: 40, z: 40 }));
    expect([...inland.keys()].filter((k) => k.startsWith('local:'))).toHaveLength(9);
    expect([...inland.keys()].filter((k) => k.startsWith('players:'))).toHaveLength(0);
    const east = cellGroups(nextBlocks({ x: 250, z: 25 }));
    expect(east.has(`players:${playerCell('settlement', 0, 40)}`)).toBe(true);
    const meadows = cellGroups(nextBlocks({ region: 'settlement', x: 3, z: 64 }));
    // The Meadows have no nodes; their island side does.
    expect(meadows.has(`nodes:${nodeCell(250, 10)}`)).toBe(true);
    expect([...meadows.keys()].filter((k) => k.startsWith('nodes:')).every((k) => meadows.get(k)![0].startsWith('SELECT * FROM tree WHERE cell'))).toBe(true);
    expect(meadows.has(`local:${playerCell('settlement', 3, 64)}`)).toBe(true);
    expect(meadows.has(`players:${playerCell('bramblewild', 250, 10)}`)).toBe(true);
    expect(nextBlocks({ region: 'reedwake', x: 10, z: 10 }).seam).toBeUndefined();
    expect(nextBlocks({ region: 'reedwake', x: 10, z: 10 }).playersSeam).toBeUndefined();
    expect([...cellGroups(nextBlocks({ region: 'reedwake', x: 10, z: 10 })).keys()].filter((k) => k.startsWith('nodes:'))).toEqual([]);
  });

  it('sizes the player block smaller than the node block', () => {
    const b = nextBlocks({ x: 130, z: 130 });
    expect([b.home!.x0, b.home!.x1]).toEqual([54, 216]);
    expect([b.players!.x0, b.players!.x1]).toEqual([81, 162]);
    const c = playerCell('bramblewild', 130, 130);
    expect(cellGroups(b).get(`local:${c}`)!.slice(0, 2)).toEqual([
      `SELECT * FROM player_pos WHERE cell = ${c}`,
      `SELECT p.* FROM player p JOIN player_pos q ON p.identity = q.identity WHERE q.cell = ${c}`,
    ]);
  });

  it('only builds identity literals from real identities', () => {
    expect(identityLiteral(ME)).toBe(`0x${ME}`);
    expect(identityLiteral(`0x${ME.toUpperCase()}`)).toBe(`0x${ME}`);
    expect(identityLiteral("aa' OR 1=1")).toBeNull();
  });
});

describe('startInterest', () => {
  it('follows your blocks cell by cell: nothing while walking inside them, then only the new edge cells', () => {
    const f = fakeConn();
    const m = startInterest(f.conn, ME);
    expect(f.subs).toHaveLength(0); // nothing nearby until your row arrives
    f.db.player.put(ME, player(ME, { x: 20, z: 20 }));
    // Clamped at the corner: 2 x 2 player cells (players and events in one subscription each) and 2 x 2 node cells.
    expect(f.liveOf('SELECT * FROM player_pos WHERE cell')).toHaveLength(4);
    expect(f.live().filter((s) => s.queries.some((q) => q.startsWith('SELECT * FROM combat_event WHERE cell')))).toHaveLength(4);
    expect(f.liveOf('SELECT * FROM tree WHERE cell')).toHaveLength(4);
    const first = f.cellSub(`SELECT * FROM player_pos WHERE cell = ${playerCell('bramblewild', 0, 20)}`)!;
    const nodes = f.cellSub(`SELECT * FROM tree WHERE cell = ${nodeCell(0, 20)}`)!;
    f.apply();
    const count = f.subs.length;
    // Steps arrive as player_pos updates; the player row stays as it was. Within the slack past the chunk: nothing.
    const { chunk, slack = 0 } = PLAYER_BLOCK;
    f.db.playerPos.put(ME, pos(ME, { x: 20, z: 20 }));
    for (let x = 21; x < chunk + slack; x++) f.db.playerPos.put(ME, pos(ME, { x, z: 20 }));
    expect(f.subs).toHaveLength(count);
    // Past it the player block recentres on chunk 1 (columns 0..2): one new column of 2 cells; nothing goes.
    f.db.playerPos.put(ME, pos(ME, { x: chunk + slack, z: 20 }));
    expect(f.subs.length - count).toBe(2);
    expect(first.ended).toBe(false);
    expect(m.snapshot().players).toContain(`SELECT * FROM player_pos WHERE cell = ${playerCell('bramblewild', 2 * chunk, 20)}`);
    // On to chunk 2: column 3 comes, column 0 goes at once; the node cells stay.
    for (let x = chunk + slack; x <= 2 * chunk + slack; x++) f.db.playerPos.put(ME, pos(ME, { x, z: 20 }));
    expect(f.subs.length - count).toBe(4);
    expect(first.ended).toBe(true);
    expect(nodes.ended).toBe(false);
    expect(m.snapshot().players).toHaveLength(3 * 2 * 2);
    // Further on, the node block follows too (and keeps its first column: radius 1 around node chunk 1).
    f.db.playerPos.put(ME, pos(ME, { x: NODE_BLOCK.chunk + (NODE_BLOCK.slack ?? 0), z: 20 }));
    expect(m.snapshot().nodes).toContain(`SELECT * FROM tree WHERE cell = ${nodeCell(2 * NODE_BLOCK.chunk, 20)}`);
    expect(nodes.ended).toBe(false);
    f.db.playerPos.put(ME, pos(ME, { x: 2 * NODE_BLOCK.chunk + (NODE_BLOCK.slack ?? 0), z: 20 }));
    expect(nodes.ended).toBe(true);
    // Offline (the player_pos row goes): the player row's saved position counts again.
    f.db.playerPos.del(ME);
    expect(m.blocks().players!.x0).toBe(0);
  });

  it('switches region: Reedwake holds only its players, and leaving the seam drops the Meadows cells', () => {
    const f = fakeConn();
    const m = startInterest(f.conn, ME);
    f.db.player.put(ME, player(ME, { x: 250, z: 25 }));
    f.apply();
    expect(m.snapshot().players).toContain(`SELECT * FROM player_pos WHERE cell = ${playerCell('settlement', 0, 40)}`);
    f.db.player.put(ME, player(ME, { region: 'reedwake', x: 10, z: 10 }));
    expect(m.snapshot().nodes).toEqual([]); // no nodes off the island
    expect(m.snapshot().players).toHaveLength(4 * 2); // 2 x 2 at the corner
    expect(m.snapshot().players).toContain(`SELECT * FROM player_pos WHERE cell = ${playerCell('reedwake', 0, 0)}`);
    // Only Reedwake's cells are left, players and events in one subscription each.
    expect(f.live()).toHaveLength(4);
  });

  it('crosses the seam keeping every player cell: the two districts only swap roles', () => {
    const f = fakeConn();
    const m = startInterest(f.conn, ME);
    f.db.player.put(ME, player(ME, { x: 255, z: 25 }));
    f.apply();
    const players = new Set(m.snapshot().players);
    const before = f.subs.length;
    // One step east: Bramblewild (255, 25) is the Meadows' (-1, 64), so (0, 64) there.
    f.db.player.put(ME, player(ME, { region: 'settlement', x: 0, z: 64 }));
    expect(m.snapshot().nodes).toContain(`SELECT * FROM tree WHERE cell = ${nodeCell(255, 25)}`);
    expect(m.snapshot().players).toContain(`SELECT * FROM player_pos WHERE cell = ${playerCell('settlement', 0, 64)}`);
    expect(m.snapshot().players).toContain(`SELECT * FROM player_pos WHERE cell = ${playerCell('bramblewild', 255, 25)}`);
    // Both sides were held already: what is new is one column of Meadows cells (the block recentred on its
    // own grid); the rest only change kind (your events follow you into the Meadows), make-before-break.
    const added = f.subs.slice(before);
    expect(added.filter((s) => !players.has(s.queries[0])).length).toBeLessThanOrEqual(5);
    const swapped = added.filter((s) => players.has(s.queries[0]));
    expect(swapped.length).toBeGreaterThan(0);
    const oldSub = f.subs.slice(0, before).find((s) => !s.ended && s.queries[0] === swapped[0].queries[0])!;
    expect(oldSub).toBeDefined(); // still held until the new one is applied
    f.apply(swapped[0].n);
    expect(oldSub.ended).toBe(true);
  });

  it('keeps your target, duel and trade partners, friends and party by identity', () => {
    const f = fakeConn();
    const m = startInterest(f.conn, ME);
    f.db.player.put(ME, player(ME, { x: 40, z: 40 }));
    f.db.friend.put('1', { owner: id(ME), friend: id(FRIEND) });
    const byId = (h: string) => [`SELECT * FROM player WHERE identity = 0x${h}`, `SELECT * FROM player_pos WHERE identity = 0x${h}`];
    expect(m.snapshot().friends).toEqual([...byId(FRIEND), `SELECT * FROM mentor_stat WHERE identity = 0x${FRIEND}`]);
    f.db.player.put(ME, player(ME, { x: 40, z: 40 }, { combatTarget: id(FOE) }));
    expect(m.snapshot().focus).toEqual(byId(FOE));
    f.db.trade.put('t', { a: id(ME), b: id(PARTNER) });
    f.db.friendlyDuel.put('d', { a: id(STRANGER), b: id(ME), stage: 'countdown' });
    expect(m.snapshot().focus).toEqual([FOE, STRANGER, PARTNER].sort().flatMap(byId));
    f.db.player.put(ME, player(ME, { x: 40, z: 40 }));
    f.db.trade.del('t'); f.db.friendlyDuel.del('d');
    expect(m.snapshot().focus).toEqual([]);
    f.db.expeditionMember.put(ME, { identity: id(ME), expeditionId: 7n });
    f.db.spireMember.put(ME, { identity: id(ME), runId: 3n });
    expect(m.snapshot().party).toEqual([
      'SELECT p.* FROM player p JOIN expedition_member m ON p.identity = m.identity WHERE m.expedition_id = 7',
      'SELECT q.* FROM player_pos q JOIN expedition_member m ON q.identity = m.identity WHERE m.expedition_id = 7',
      'SELECT p.* FROM player p JOIN spire_member m ON p.identity = m.identity WHERE m.run_id = 3',
      'SELECT q.* FROM player_pos q JOIN spire_member m ON q.identity = m.identity WHERE m.run_id = 3',
    ]);
    f.db.spireMember.del(ME);
    expect(m.snapshot().party).toHaveLength(2);
  });

  it('looks an unseen chat sender up once, and never one whose row it has seen', () => {
    const f = fakeConn();
    const m = startInterest(f.conn, ME);
    f.db.player.put(FRIEND, player(FRIEND, { x: 1, z: 1 }, { name: 'Willow' }));
    expect(playerName(FRIEND)).toBe('Willow');
    f.db.chatMessage.put('1', { sender: id(FRIEND) });
    expect(m.snapshot().names).toEqual([]);
    f.db.chatMessage.put('2', { sender: id(STRANGER) });
    const lookup = f.last();
    expect(lookup.queries).toEqual([`SELECT * FROM player WHERE identity = 0x${STRANGER}`]);
    f.db.player.put(STRANGER, player(STRANGER, { x: 200, z: 200 }, { name: 'Far Away' }));
    f.apply(lookup.n);
    expect(lookup.ended).toBe(true);
    expect(playerName(STRANGER)).toBe('Far Away');
    f.db.chatMessage.put('3', { sender: id(STRANGER) });
    expect(m.snapshot().names).toEqual([]);
  });

  it('is ready once every nearby cell is applied, and disposes every handle', () => {
    const f = fakeConn();
    const m = startInterest(f.conn, ME);
    let ready = 0;
    m.whenReady(() => ready++);
    expect(ready).toBe(1); // no row yet: nothing to wait for
    f.db.player.put(ME, player(ME, { x: 40, z: 40 }));
    m.whenReady(() => ready++);
    expect(ready).toBe(1);
    const nearby = f.live().filter((s) => /WHERE cell/.test(s.queries[0]));
    for (const s of nearby.slice(1)) f.apply(s.n);
    expect(ready).toBe(1); // one cell is not applied yet
    f.apply(nearby[0].n);
    expect(ready).toBe(2);
    m.dispose();
    expect(f.live()).toHaveLength(0);
    expect(f.db.player.cbs.insert.size).toBe(0);
    expect(f.db.playerPos.cbs.update.size).toBe(0);
  });

  it('CellSubscriptions keeps held groups, subscribes new ones and drops the rest at once', () => {
    const f = fakeConn();
    const cells = new CellSubscriptions(f.conn, () => {});
    cells.set(new Map([['a', ['qa']], ['b', ['qb']]]));
    expect(f.log).toEqual(['sub 1', 'sub 2']);
    expect(cells.applied).toBe(false);
    f.apply();
    expect(cells.applied).toBe(true);
    cells.set(new Map([['b', ['qb']], ['c', ['qc']]]));
    expect(f.log.slice(2)).toEqual(['unsub 1', 'sub 3']);
    expect(cells.queries()).toEqual(['qb', 'qc']);
    cells.dispose();
    expect(f.live()).toHaveLength(0);
  });

});
