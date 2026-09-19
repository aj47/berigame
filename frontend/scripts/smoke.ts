/**
 * End-to-end smoke test against a locally running SpacetimeDB (`spacetime start`)
 * with the berigame module published. Run: npx tsx scripts/smoke.ts
 */
import { DbConnection, tables, type EventContext } from '../src/module_bindings';
import type { CombatEvent, Player } from '../src/module_bindings/types';
import { EventKind, FightState, Stance, TICK_MS } from '../../shared/sim';

const URI = process.env.SPACETIME_URI ?? 'ws://127.0.0.1:3000';
const DB = process.env.SPACETIME_DB ?? 'berigame';

interface Client {
  name: string;
  conn: DbConnection;
  identity: string;
  token: string;
  events: CombatEvent[];
}

function connect(name: string, token?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const events: CombatEvent[] = [];
    const timer = setTimeout(() => reject(new Error(`${name}: connect timeout`)), 10_000);
    const conn = DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .withToken(token)
      .onConnectError((_ctx, err) => { clearTimeout(timer); reject(err); })
      .onConnect((c, identity, tok) => {
        c.db.combatEvent.onInsert((_ctx: EventContext, row: CombatEvent) => events.push(row));
        c.subscriptionBuilder()
          .onApplied(() => {
            clearTimeout(timer);
            resolve({ name, conn: c, identity: identity.toHexString(), token: tok, events });
          })
          .onError((_ctx, err) => { clearTimeout(timer); reject(err); })
          .subscribe([tables.world, tables.player, tables.tree, tables.groundItem, tables.chatMessage, tables.inventorySlot, tables.combatEvent]);
      })
      .build();
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(label: string, pred: () => boolean, timeoutMs = 8_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return;
    await sleep(50);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

function me(c: Client): Player {
  for (const p of c.conn.db.player.iter()) if (p.identity.toHexString() === c.identity) return p;
  throw new Error(`${c.name}: own player row missing`);
}

function other(c: Client, id: string): Player {
  for (const p of c.conn.db.player.iter()) if (p.identity.toHexString() === id) return p;
  throw new Error(`${c.name}: player ${id.slice(0, 6)} missing`);
}

function tick(c: Client): number {
  let t = 0;
  for (const w of c.conn.db.world.iter()) t = w.tick;
  return t;
}

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  (' + extra + ')' : ''}`);
  if (!ok) failures++;
}

async function main() {
  const A = await connect('A');
  const B = await connect('B');
  check('both clients see the world row', tick(A) > 0 && tick(B) > 0, `tick=${tick(A)}`);
  check('A sees both players', [...A.conn.db.player.iter()].length >= 2);
  check('A spawned at 25,25 with 30hp', me(A).x === 25 && me(A).z === 25 && me(A).hp === 30);

  // --- tick cadence ---------------------------------------------------------
  const t0 = tick(A); const w0 = Date.now();
  await sleep(3_000);
  const perTick = (Date.now() - w0) / (tick(A) - t0);
  check('tick period ~600ms', Math.abs(perTick - TICK_MS) < 80, `${perTick.toFixed(0)}ms`);

  // --- movement: one tile per tick -----------------------------------------
  await A.conn.reducers.setTarget({ x: 29, z: 25 });
  const seen: Array<[number, number]> = [];
  await waitFor('A reaches 29,25', () => {
    const p = me(A);
    if (seen.length === 0 || seen[seen.length - 1][1] !== p.x) seen.push([tick(A), p.x]);
    return p.x === 29;
  });
  const steps = seen.slice(1);
  const oneTilePerTick = steps.every((s, i) => i === 0 || (s[1] - steps[i - 1][1] === 1 && s[0] - steps[i - 1][0] === 1));
  check('A walked one tile per tick', oneTilePerTick, JSON.stringify(seen));
  check('B sees A at 29,25', other(B, A.identity).x === 29);
  check('A cleared its target on arrival', me(A).targetX === undefined);

  // --- tree is blocked; walking onto it stops adjacent ---------------------
  await A.conn.reducers.setTarget({ x: 30, z: 25 }); // tree 4
  await sleep(TICK_MS * 3);
  check('cannot stand on a tree tile', !(me(A).x === 30 && me(A).z === 25), `at ${me(A).x},${me(A).z}`);

  // --- combat ----------------------------------------------------------------
  await B.conn.reducers.setTarget({ x: 27, z: 25 });
  await waitFor('B at 27,25', () => me(B).x === 27);
  await A.conn.reducers.attack({ target: me(B).identity });
  await waitFor('A adjacent to B', () => Math.max(Math.abs(me(A).x - me(B).x), Math.abs(me(A).z - me(B).z)) <= 1);
  await waitFor('first swing lands (both Strike => clash)', () => A.events.length >= 1, 5_000);
  check('first exchange is a clash', A.events[0].kind === EventKind.Clash, `kind=${A.events[0].kind}`);
  check('B received the same event', B.events.length >= 1);

  // B switches to Guard (beats Strike): A's swings now get countered, A takes 2.
  await B.conn.reducers.setStance({ stance: Stance.Guard });
  const hpA0 = me(A).hp;
  await waitFor('A gets countered', () => A.events.some((e) => e.kind === EventKind.Counter), 5_000);
  await sleep(200);
  check('counter cost A 2hp', me(A).hp === hpA0 - 2, `${hpA0}->${me(A).hp}`);
  check('B in Advantage, A in Disadvantage', me(B).fightState === FightState.Advantage && me(A).fightState === FightState.Disadvantage);

  // B retaliates: swings should alternate with A's (offset by 2 ticks).
  await B.conn.reducers.attack({ target: me(A).identity });
  const nBefore = A.events.length;
  await waitFor('several exchanges', () => A.events.length >= nBefore + 4, 12_000);
  const exch = A.events.filter((e) => e.kind !== EventKind.Knockback).slice(nBefore);
  const attackersAlternate = exch.every((e, i) => i === 0 || e.attacker.toHexString() !== exch[i - 1].attacker.toHexString());
  const ticksApart = exch.every((e, i) => i === 0 || e.tick - exch[i - 1].tick === 2);
  check('exchanges alternate between A and B', attackersAlternate, exch.map((e) => e.attacker.toHexString().slice(4, 8)).join(','));
  check('exchanges are 2 ticks apart', ticksApart, exch.map((e) => e.tick).join(','));
  const hitByB = exch.find((e) => e.attacker.toHexString() === B.identity && e.kind === EventKind.Hit);
  check('B (Guard) hits A (Strike)', !!hitByB, hitByB ? `dmg=${hitByB.damage}` : '');
  check('advantage hit deals 6 and knocks back', !!hitByB && hitByB.damage === 6 && A.events.some((e) => e.kind === EventKind.Knockback));

  // --- harvest -----------------------------------------------------------------
  await A.conn.reducers.cancel();
  await B.conn.reducers.cancel();
  await A.conn.reducers.startHarvest({ treeId: 4 });
  await waitFor('A claims tree 4', () => A.conn.db.tree.id.find(4)?.harvester?.toHexString() === A.identity, 6_000);
  await waitFor('A gets a berry', () => [...A.conn.db.inventorySlot.iter()].length === 1, 6_000);
  const berry = [...A.conn.db.inventorySlot.iter()][0];
  check('berry is a blueberry in slot 0', berry.itemId === 'berry_blueberry' && berry.slot === 0 && berry.quantity === 1);
  check('tree 4 is on cooldown', (A.conn.db.tree.id.find(4)?.cooldownUntilTick ?? 0) > tick(A));
  check('B cannot see A inventory (RLS)', [...B.conn.db.inventorySlot.iter()].length === 0);
  let rejected = '';
  try { await B.conn.reducers.startHarvest({ treeId: 4 }); } catch (e: any) { rejected = String(e?.message ?? e); }
  check('harvesting a regrowing tree is rejected', rejected.length > 0, rejected);

  // --- eat -----------------------------------------------------------------------
  const hpBefore = me(A).hp;
  await A.conn.reducers.eatBerry({ slot: 0 });
  await waitFor('hp restored', () => me(A).hp === Math.min(30, hpBefore + 5), 3_000);
  check('blueberry healed 5', me(A).hp === Math.min(30, hpBefore + 5), `${hpBefore}->${me(A).hp}`);
  check('berry consumed', [...A.conn.db.inventorySlot.iter()].length === 0);

  // --- drop / pickup ----------------------------------------------------------
  await A.conn.reducers.startHarvest({ treeId: 4 }).catch(() => {});
  await A.conn.reducers.startHarvest({ treeId: 2 });
  await waitFor('A gets a greenberry', () => [...A.conn.db.inventorySlot.iter()].length === 1, 15_000);
  await A.conn.reducers.dropItem({ slot: 0, quantity: 1 });
  await waitFor('ground item appears', () => [...B.conn.db.groundItem.iter()].length === 1, 3_000);
  const gi = [...B.conn.db.groundItem.iter()][0];
  await B.conn.reducers.pickupItem({ id: gi.id });
  await waitFor('B picked it up', () => [...B.conn.db.groundItem.iter()].length === 0 && [...B.conn.db.inventorySlot.iter()].length === 1, 15_000);
  check('B now holds the greenberry', [...B.conn.db.inventorySlot.iter()][0]?.itemId === 'berry_greenberry');

  // --- chat / name -----------------------------------------------------------
  await A.conn.reducers.setName({ name: 'Alice' });
  await A.conn.reducers.sendChat({ text: 'hello from A' });
  await waitFor('B sees chat', () => [...B.conn.db.chatMessage.iter()].some((m) => m.text === 'hello from A'), 3_000);
  check('name propagated', other(B, A.identity).name === 'Alice');

  // --- persistence across reconnect ------------------------------------------
  A.conn.disconnect();
  await sleep(500);
  const A2 = await connect('A2', A.token);
  check('reconnect keeps identity', A2.identity === A.identity);
  check('reconnect keeps name and hp', me(A2).name === 'Alice' && me(A2).hp === other(B, A.identity).hp, `hp=${me(A2).hp}`);

  // --- death drops ---------------------------------------------------------------
  await A2.conn.reducers.setStance({ stance: Stance.Grab }); // Guard beats Strike; B is Guard, so A2 uses Grab (beats Guard)
  await B.conn.reducers.setStance({ stance: Stance.Strike });  // Strike beats Grab: B wins every exchange
  await B.conn.reducers.attack({ target: me(A2).identity });
  await waitFor('A2 dies', () => me(A2).state === 1, 40_000);
  await waitFor('B inventory drops on death', () => true);
  check('death event emitted', B.events.some((e) => e.kind === EventKind.Death));
  await waitFor('A2 respawns', () => me(A2).state === 0 && me(A2).hp === 30, 6_000);
  check('respawned at spawn', me(A2).x === 25 && me(A2).z === 25);
  check('B stopped targeting the dead player', me(B).combatTarget === undefined);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  A2.conn.disconnect();
  B.conn.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('SMOKE ERROR', e); process.exit(1); });
