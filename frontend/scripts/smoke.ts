/**
 * End-to-end smoke test against a locally running SpacetimeDB (`spacetime start`)
 * with the berigame module published. Run: npx tsx scripts/smoke.ts
 */
import { DbConnection, tables, type EventContext } from '../src/module_bindings';
import type { CombatEvent, Player } from '../src/module_bindings/types';
import {
  chebyshev, EventKind, getItemDef, HOTBAR_SIZE, INVENTORY_SIZE, MOVEMENT_STEPS_PER_TICK, PUNCH_DAMAGE, STICK_ITEM_ID, TICK_MS,
} from '../../shared/sim';

const STICK_DAMAGE = getItemDef(STICK_ITEM_ID)!.weaponDamage;

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

/** Every swing is a Hit now; there are no clashes, counters or knockbacks. */
function exchanges(c: Client, first: string, second: string): CombatEvent[] {
  return c.events.filter((event) => event.kind === EventKind.Hit &&
    [first, second].includes(event.attacker.toHexString()) && [first, second].includes(event.defender.toHexString()));
}

/** Own inventory rows. A harvest can add two rows at once (berry + stick), so callers filter by itemId. */
function inv(c: Client) {
  return [...c.conn.db.inventorySlot.iter()].filter((row) => row.owner.toHexString() === c.identity);
}
const rowsOf = (c: Client, itemId: string) => inv(c).filter((row) => row.itemId === itemId);
const countOf = (c: Client, itemId: string) => rowsOf(c, itemId).reduce((n, row) => n + row.quantity, 0);
const isBerry = (itemId: string) => (getItemDef(itemId)?.healthRestore ?? 0) > 0;
const harvestsDone = (c: Client) => c.events.filter((e) => e.kind === EventKind.HarvestDone && e.attacker.toHexString() === c.identity).length;

/**
 * Harvest the nearest ready tree again and again until the STICK_DROP_CHANCE
 * roll turns up a stick. Six trees with a 50-tick regrow, so allow minutes.
 */
async function findStick(c: Client, timeoutMs = 420_000): Promise<number> {
  const start = Date.now();
  let harvests = 0;
  while (rowsOf(c, STICK_ITEM_ID).length === 0) {
    if (Date.now() - start > timeoutMs) throw new Error(`${c.name}: no stick after ${harvests} harvests`);
    const p = me(c);
    const T = tick(c);
    const tree = [...c.conn.db.tree.iter()].filter((t) => t.harvester === undefined && t.cooldownUntilTick <= T)
      .sort((a, b) => chebyshev(p, a) - chebyshev(p, b) || a.id - b.id)[0];
    if (!tree) { await sleep(TICK_MS); continue; }
    const before = harvestsDone(c);
    try { await c.conn.reducers.startHarvest({ treeId: tree.id }); } catch { await sleep(TICK_MS); continue; }
    try { await waitFor('stick-hunt harvest completes', () => harvestsDone(c) > before, 20_000); harvests++; }
    catch { await c.conn.reducers.cancel({}); }
  }
  return harvests;
}

async function availableTree(c: Client, treeId: number): Promise<void> {
  await waitFor(`tree ${treeId} available`, () => {
    const tree = c.conn.db.tree.id.find(treeId);
    return !!tree && tree.harvester === undefined && tree.cooldownUntilTick <= tick(c);
  }, 40_000);
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
  await waitFor('both clients see each other online', () => [...A.conn.db.player.iter()].some((p) => p.identity.toHexString() === B.identity && p.online) && [...B.conn.db.player.iter()].some((p) => p.identity.toHexString() === A.identity && p.online));
  check('both clients see each other online', true);
  check('A spawned at 25,25 with 30hp', me(A).x === 25 && me(A).z === 25 && me(A).hp === 30);
  check('a new player fights with bare fists', me(A).weapon === '' && me(B).weapon === '');

  // --- tick cadence ---------------------------------------------------------
  const t0 = tick(A); const w0 = Date.now();
  await sleep(3_000);
  const perTick = (Date.now() - w0) / (tick(A) - t0);
  check('tick period ~600ms', Math.abs(perTick - TICK_MS) < 80, `${perTick.toFixed(0)}ms`);

  // --- movement: two legal tile steps per tick -----------------------------------------
  await A.conn.reducers.setTarget({ x: 29, z: 25 });
  const seen: Array<[number, number]> = [];
  await waitFor('A reaches 29,25', () => {
    const p = me(A);
    if (seen.length === 0 || seen[seen.length - 1][1] !== p.x) seen.push([tick(A), p.x]);
    return p.x === 29;
  });
  const steps = seen.slice(1);
  const twoStepsPerTick = steps.length === 2 && steps.every((s, i) =>
    s[1] - seen[i][1] === MOVEMENT_STEPS_PER_TICK && (i === 0 || s[0] - seen[i][0] === 1));
  check('A traversed four open cardinal tiles in two consecutive movement ticks', twoStepsPerTick, JSON.stringify(seen));
  check('B sees A at 29,25', other(B, A.identity).x === 29);
  check('A cleared its target on arrival', me(A).targetX === undefined);

  // --- tree is blocked; walking onto it stops adjacent ---------------------
  await A.conn.reducers.setTarget({ x: 30, z: 25 }); // tree 4
  await sleep(TICK_MS * 3);
  check('cannot stand on a tree tile', !(me(A).x === 30 && me(A).z === 25), `at ${me(A).x},${me(A).z}`);

  // --- combat ----------------------------------------------------------------
  await B.conn.reducers.setTarget({ x: 27, z: 25 });
  await waitFor('B at 27,25', () => me(B).x === 27);
  // Read B's HP before attacking: A can step into range and land the first punch in the same tick.
  const hpB0 = me(B).hp;
  await A.conn.reducers.attack({ target: me(B).identity });
  await waitFor('A adjacent to B', () => Math.max(Math.abs(me(A).x - me(B).x), Math.abs(me(A).z - me(B).z)) <= 1);
  await waitFor('first swing lands', () => exchanges(A, A.identity, B.identity).length >= 1, 5_000);
  const first = exchanges(A, A.identity, B.identity)[0];
  check('first exchange is a bare-handed Hit by A', first.kind === EventKind.Hit && first.attacker.toHexString() === A.identity && first.itemId === '',
    `kind=${first.kind} itemId=${JSON.stringify(first.itemId)}`);
  check(`a punch deals ${PUNCH_DAMAGE}`, first.damage === PUNCH_DAMAGE && first.defenderHp === hpB0 - PUNCH_DAMAGE, `dmg=${first.damage} hp=${hpB0}->${first.defenderHp}`);
  await waitFor('B receives the same exchange', () => exchanges(B, A.identity, B.identity).some((event) => event.tick === first.tick));
  check('B received the same event', true);

  // Re-selecting Attack every tick cannot speed up the four-tick rally.
  const spamStart = tick(A);
  for (let offset = 1; offset <= 9; offset++) {
    await waitFor('next spam-test tick', () => tick(A) >= spamStart + offset, 2_000);
    await A.conn.reducers.attack({ target: me(B).identity });
  }
  const spamSwings = exchanges(A, A.identity, B.identity).filter((event) => event.attacker.toHexString() === A.identity);
  check('repeated Attack preserves four-tick swing spacing', spamSwings.length >= 3 && spamSwings.slice(1).every((event, i) => event.tick - spamSwings[i].tick === 4), spamSwings.map((event) => event.tick).join(','));

  // B retaliates: swings should alternate with A's (offset by 2 ticks), every one a punch.
  await B.conn.reducers.attack({ target: me(A).identity });
  const nBefore = exchanges(A, A.identity, B.identity).length;
  await waitFor('several exchanges', () => exchanges(A, A.identity, B.identity).length >= nBefore + 4, 12_000);
  const exch = exchanges(A, A.identity, B.identity).slice(nBefore);
  const attackersAlternate = exch.every((e, i) => i === 0 || e.attacker.toHexString() !== exch[i - 1].attacker.toHexString());
  const ticksApart = exch.every((e, i) => i === 0 || e.tick - exch[i - 1].tick === 2);
  check('exchanges alternate between A and B', attackersAlternate, exch.map((e) => e.attacker.toHexString().slice(4, 8)).join(','));
  check('exchanges are 2 ticks apart', ticksApart, exch.map((e) => e.tick).join(','));
  const hitByB = exch.find((e) => e.attacker.toHexString() === B.identity);
  check('B hits A back', !!hitByB, hitByB ? `dmg=${hitByB.damage}` : '');
  check(`every rally swing is a ${PUNCH_DAMAGE}-damage punch`, exch.every((e) => e.damage === PUNCH_DAMAGE && e.itemId === ''),
    exch.map((e) => `${e.damage}${e.itemId ? ':' + e.itemId : ''}`).join(','));
  check('no retired exchange kinds (1-3) arrive', ![...A.events, ...B.events].some((e) => e.kind >= 1 && e.kind <= 3));

  // --- harvest -----------------------------------------------------------------
  await A.conn.reducers.cancel({});
  await B.conn.reducers.cancel({});
  await availableTree(A, 4);
  await A.conn.reducers.startHarvest({ treeId: 4 });
  await waitFor('A claims tree 4', () => A.conn.db.tree.id.find(4)?.harvester?.toHexString() === A.identity, 6_000);
  await waitFor('A gets a berry', () => countOf(A, 'berry_blueberry') === 1, 6_000);
  const berry = rowsOf(A, 'berry_blueberry')[0];
  check('berry is a blueberry in slot 0', berry.itemId === 'berry_blueberry' && berry.slot === 0 && berry.quantity === 1);
  const bonusStick = rowsOf(A, STICK_ITEM_ID).length > 0;
  check('a harvest adds only a berry and at most one bonus stick', inv(A).length === (bonusStick ? 2 : 1), inv(A).map((r) => r.itemId).join(','));
  check('an ItemFound event accompanies exactly the bonus stick',
    A.events.some((e) => e.kind === EventKind.ItemFound && e.attacker.toHexString() === A.identity && e.itemId === STICK_ITEM_ID) === bonusStick);
  check('tree 4 is on cooldown', (A.conn.db.tree.id.find(4)?.cooldownUntilTick ?? 0) > tick(A));
  check('B cannot see A inventory (RLS)', [...B.conn.db.inventorySlot.iter()].length === 0);
  let rejected = '';
  try { await B.conn.reducers.startHarvest({ treeId: 4 }); } catch (e: any) { rejected = String(e?.message ?? e); }
  check('harvesting a regrowing tree is rejected', rejected.length > 0, rejected);

  // --- eat -----------------------------------------------------------------------
  const hpBefore = me(A).hp;
  await A.conn.reducers.eatBerry({ slot: berry.slot });
  await waitFor('hp restored and berry consumed', () => me(A).hp === Math.min(30, hpBefore + 5) && countOf(A, 'berry_blueberry') === 0, 3_000);
  check('eating test began below full health', hpBefore < 30);
  check('blueberry healed 5', me(A).hp === Math.min(30, hpBefore + 5), `${hpBefore}->${me(A).hp}`);
  check('berry consumed', countOf(A, 'berry_blueberry') === 0);
  const eatEvent = A.events.find((event) => event.kind === EventKind.Eat && event.attacker.toHexString() === A.identity);
  const recovery = me(A).nextSwingTick;
  check('eating while disengaged still delays the next swing', !!eatEvent && recovery >= eatEvent.tick + 3);
  await A.conn.reducers.attack({ target: me(B).identity });
  check('re-entering combat preserves eating recovery', me(A).nextSwingTick === recovery);
  await A.conn.reducers.cancel({});

  // --- drop / pickup ----------------------------------------------------------
  await availableTree(A, 2);
  await A.conn.reducers.startHarvest({ treeId: 2 });
  await waitFor('A gets a greenberry', () => countOf(A, 'berry_greenberry') === 1, 15_000);
  await A.conn.reducers.dropItem({ slot: rowsOf(A, 'berry_greenberry')[0].slot, quantity: 1 });
  await waitFor('our ground item appears', () => [...B.conn.db.groundItem.iter()].some((item) => item.droppedBy.toHexString() === A.identity && item.itemId === 'berry_greenberry'), 3_000);
  const gi = [...B.conn.db.groundItem.iter()].find((item) => item.droppedBy.toHexString() === A.identity && item.itemId === 'berry_greenberry')!;
  await B.conn.reducers.pickupItem({ id: gi.id });
  await waitFor('B picked it up', () => !B.conn.db.groundItem.id.find(gi.id) && [...B.conn.db.inventorySlot.iter()].length === 1, 15_000);
  check('B now holds the greenberry', [...B.conn.db.inventorySlot.iter()][0]?.itemId === 'berry_greenberry');

  // --- stick: found by harvesting, wielded from a quick slot, seen by everyone ---
  const stickHarvests = await findStick(A);
  check('harvesting eventually finds a stick', rowsOf(A, STICK_ITEM_ID).length > 0, `${stickHarvests} extra harvest(s)`);
  check('the stick find is announced as ItemFound', A.events.some((e) => e.kind === EventKind.ItemFound && e.attacker.toHexString() === A.identity && e.itemId === STICK_ITEM_ID));
  let stickSlot = rowsOf(A, STICK_ITEM_ID)[0].slot;
  if (stickSlot >= HOTBAR_SIZE) {
    await A.conn.reducers.moveItem({ from: stickSlot, to: 0 });
    await waitFor('stick moved into quick slot 1', () => rowsOf(A, STICK_ITEM_ID).some((row) => row.slot === 0), 3_000);
    stickSlot = 0;
  }
  let wieldError = '';
  try { await A.conn.reducers.wieldItem({ slot: HOTBAR_SIZE }); } catch (e: any) { wieldError = String(e?.message ?? e); }
  check('wielding outside the quick slots is rejected', wieldError.length > 0, wieldError);
  const hotbarBerry = inv(A).find((row) => row.slot < HOTBAR_SIZE && isBerry(row.itemId));
  if (hotbarBerry) {
    wieldError = '';
    try { await A.conn.reducers.wieldItem({ slot: hotbarBerry.slot }); } catch (e: any) { wieldError = String(e?.message ?? e); }
    check('a berry cannot be wielded', wieldError.length > 0 && me(A).weapon === '', wieldError);
  }
  await A.conn.reducers.wieldItem({ slot: stickSlot });
  await waitFor('A wields the stick', () => me(A).weapon === STICK_ITEM_ID, 3_000);
  await waitFor('B sees the stick in A\'s hand', () => other(B, A.identity).weapon === STICK_ITEM_ID, 3_000);
  check('the wielded stick is public on the player row', true);
  await A.conn.reducers.unwield({});
  await waitFor('unwield returns to punching', () => me(A).weapon === '', 3_000);
  await A.conn.reducers.wieldItem({ slot: stickSlot });
  await waitFor('A wields the stick again', () => me(A).weapon === STICK_ITEM_ID, 3_000);

  // A fresh third player takes one stick swing, so B keeps its HP for the death test.
  const C = await connect('C');
  await waitFor('A sees C online', () => [...A.conn.db.player.iter()].some((p) => p.identity.toHexString() === C.identity && p.online));
  const hpC0 = me(C).hp;
  const stickHitsBefore = A.events.filter((e) => e.kind === EventKind.Hit && e.attacker.toHexString() === A.identity && e.defender.toHexString() === C.identity).length;
  await A.conn.reducers.attack({ target: me(C).identity });
  await waitFor('A swings the stick at C', () => A.events.filter((e) => e.kind === EventKind.Hit && e.attacker.toHexString() === A.identity && e.defender.toHexString() === C.identity).length > stickHitsBefore, 20_000);
  await A.conn.reducers.cancel({});
  const stickHit = A.events.filter((e) => e.kind === EventKind.Hit && e.attacker.toHexString() === A.identity && e.defender.toHexString() === C.identity)[stickHitsBefore];
  check(`a stick swing deals ${STICK_DAMAGE} and names the stick`, stickHit.damage === STICK_DAMAGE && stickHit.itemId === STICK_ITEM_ID, `dmg=${stickHit.damage} itemId=${stickHit.itemId}`);
  await waitFor('C sees its HP drop by the stick damage', () => me(C).hp === hpC0 - STICK_DAMAGE, 3_000);
  check('C received the stick Hit event', C.events.some((e) => e.tick === stickHit.tick && e.kind === EventKind.Hit && e.itemId === STICK_ITEM_ID));
  C.conn.disconnect();
  let spare = INVENTORY_SIZE - 1;
  while (spare >= HOTBAR_SIZE && inv(A).some((row) => row.slot === spare)) spare--;
  await A.conn.reducers.moveItem({ from: stickSlot, to: spare });
  await waitFor('moving the stick out of the quick slots puts it away', () => me(A).weapon === '' && rowsOf(A, STICK_ITEM_ID).some((row) => row.slot === spare), 3_000);
  check('the server unwields a stick moved out of the quick slots', true);

  // --- chat / name -----------------------------------------------------------
  const testName = `Test_${A.identity.slice(-10)}`;
  const testChat = `hello from ${testName}`;
  await A.conn.reducers.setName({ name: testName });
  await A.conn.reducers.sendChat({ text: testChat });
  await waitFor('B sees chat', () => [...B.conn.db.chatMessage.iter()].some((m) => m.text === testChat), 3_000);
  check('name propagated', other(B, A.identity).name === testName);

  // --- persistence across reconnect ------------------------------------------
  A.conn.disconnect();
  await sleep(500);
  const A2 = await connect('A2', A.token);
  check('reconnect keeps identity', A2.identity === A.identity);
  check('reconnect keeps name and hp', me(A2).name === testName && me(A2).hp === other(B, A.identity).hp, `hp=${me(A2).hp}`);

  // --- death with real carried inventory, visible drops, and recovery ---------
  const carried = [...B.conn.db.inventorySlot.iter()].map(({ itemId, quantity }) => ({ itemId, quantity }));
  check('death test begins with a carried greenberry', carried.length === 1 && carried[0].itemId === 'berry_greenberry' && carried[0].quantity === 1);
  check('A2 punches for the death test', me(A2).weapon === '');
  const lootBefore = countOf(A2, carried[0]?.itemId ?? '');
  await A2.conn.reducers.attack({ target: me(B).identity });
  await waitFor('B dies and drops carried inventory', () => me(B).state === 1 && [...B.conn.db.inventorySlot.iter()].length === 0, 40_000);
  await waitFor('A2 sees the death drop', () => [...A2.conn.db.groundItem.iter()].some((item) => item.droppedBy.toHexString() === B.identity && item.droppedOnDeath));
  const deathDrops = [...A2.conn.db.groundItem.iter()].filter((item) => item.droppedBy.toHexString() === B.identity && item.droppedOnDeath);
  check('death drop preserves the exact carried item and quantity', deathDrops.length === 1 && deathDrops[0].itemId === carried[0]?.itemId && deathDrops[0].quantity === carried[0]?.quantity);
  check('death event identifies B', A2.events.some((event) => event.kind === EventKind.Death && event.defender.toHexString() === B.identity));
  const killingBlow = A2.events.filter((e) => e.kind === EventKind.Hit && e.defender.toHexString() === B.identity).at(-1);
  check('B died purely from HP reaching 0', !!killingBlow && killingBlow.defenderHp === 0 && killingBlow.damage === PUNCH_DAMAGE, killingBlow ? `dmg=${killingBlow.damage} hp=${killingBlow.defenderHp}` : 'no hit');
  check('A2 stopped targeting the dead player', me(A2).combatTarget === undefined);
  await waitFor('B respawns', () => me(B).state === 0 && me(B).hp === 30, 6_000);
  check('B respawned at spawn with an empty inventory', me(B).x === 25 && me(B).z === 25 && [...B.conn.db.inventorySlot.iter()].length === 0);
  await A2.conn.reducers.pickupItem({ id: deathDrops[0].id });
  await waitFor('A2 recovers death loot and B sees the pile disappear', () => !B.conn.db.groundItem.id.find(deathDrops[0].id) && countOf(A2, carried[0].itemId) === lootBefore + carried[0].quantity);
  check('death loot is collectible by the other player', true);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  A2.conn.disconnect();
  B.conn.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('SMOKE ERROR', e); process.exit(1); });
