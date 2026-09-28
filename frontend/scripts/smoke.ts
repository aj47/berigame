/**
 * End-to-end smoke test against a locally running SpacetimeDB (`spacetime start`)
 * with the berigame module published. Run: npx tsx scripts/smoke.ts
 */
import { DbConnection, tables, type EventContext } from '../src/module_bindings';
import type { CombatEvent, Player } from '../src/module_bindings/types';
import {
  areaOf, chebyshev, EventKind, FIRST_SPAWN_GRACE_TICKS, FIRST_SPAWN_HP, getItemDef, HOTBAR_SIZE, inGrace, INVENTORY_SIZE, MAX_HP, MOVEMENT_STEPS_PER_TICK,
  Pending, PUNCH_DAMAGE, RESPAWN_GRACE_TICKS, STICK_ITEM_ID, TICK_MS,
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

async function rejection(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); return ''; } catch (e: any) { return String(e?.message ?? e); }
}

async function main() {
  const A = await connect('A');
  const B = await connect('B');
  check('both clients see the world row', tick(A) > 0 && tick(B) > 0, `tick=${tick(A)}`);
  await waitFor('both clients see each other online', () => [...A.conn.db.player.iter()].some((p) => p.identity.toHexString() === B.identity && p.online) && [...B.conn.db.player.iter()].some((p) => p.identity.toHexString() === A.identity && p.online));
  check('both clients see each other online', true);
  check(`A spawned at 25,25 tired: ${FIRST_SPAWN_HP}/${MAX_HP} HP`, me(A).x === 25 && me(A).z === 25 && me(A).hp === FIRST_SPAWN_HP && me(A).maxHp === MAX_HP);
  check('a new character is in first-spawn grace until +300 ticks', inGrace(me(A), tick(A)) && Math.abs(me(A).respawnTick + RESPAWN_GRACE_TICKS - (tick(A) + FIRST_SPAWN_GRACE_TICKS)) <= 20,
    `respawnTick=${me(A).respawnTick} tick=${tick(A)}`);
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

  // --- safety: the safe ring and newcomer grace -------------------------------
  await B.conn.reducers.setTarget({ x: 26, z: 25 });
  await waitFor('B at 26,25 (in the safe ring)', () => me(B).x === 26);
  check('nobody can attack into the safe ring', /safe ring/.test(await rejection(() => A.conn.reducers.attack({ target: me(B).identity }))));
  await B.conn.reducers.setTarget({ x: 28, z: 25 });
  await waitFor('B at 28,25', () => me(B).x === 28);
  check('nobody can attack a newcomer in grace', /protected/.test(await rejection(() => A.conn.reducers.attack({ target: me(B).identity }))));

  // --- the bramble hedge: a stickless player stops at ring 16 ------------------
  await B.conn.reducers.setTarget({ x: 2, z: 25 });
  await waitFor('B stops at the hedge', () => me(B).x === 9 && me(B).targetX === undefined, 15_000);
  check('without a stick, a walk to the Coast stops at (9,25) inside the hedge', me(B).x === 9 && me(B).z === 25 && areaOf(me(B)) === 'grove');
  await B.conn.reducers.setTarget({ x: 28, z: 25 });
  await waitFor('B back at 28,25', () => me(B).x === 28, 15_000);

  // --- harvest -----------------------------------------------------------------
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
  const waitError = await rejection(() => B.conn.reducers.startHarvest({ treeId: 4 }));
  check('harvesting a regrowing tree queues instead of failing', waitError === '', waitError);
  await waitFor('B waits beside tree 4', () => chebyshev(me(B), { x: 30, z: 25 }) <= 1 && me(B).pending === Pending.Harvest && me(B).harvestTreeId === 0, 6_000);
  check('B waits beside the regrowing tree with the harvest queued', true);
  await B.conn.reducers.cancel({});

  // --- eat -----------------------------------------------------------------------
  const hpBefore = me(A).hp;
  await A.conn.reducers.eatBerry({ slot: berry.slot });
  await waitFor('hp restored and berry consumed', () => me(A).hp === Math.min(MAX_HP, hpBefore + 5) && countOf(A, 'berry_blueberry') === 0, 3_000);
  check('eating test began below full health', hpBefore < MAX_HP);
  check('blueberry healed 5', me(A).hp === Math.min(MAX_HP, hpBefore + 5), `${hpBefore}->${me(A).hp}`);
  check('berry consumed', countOf(A, 'berry_blueberry') === 0);
  const eatEvent = A.events.find((event) => event.kind === EventKind.Eat && event.attacker.toHexString() === A.identity);
  check('eating while disengaged still delays the next swing', !!eatEvent && me(A).nextSwingTick >= eatEvent.tick + 3);

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
  const find = A.events.find((e) => e.kind === EventKind.ItemFound && e.attacker.toHexString() === A.identity && e.itemId === STICK_ITEM_ID);
  check('the stick find is announced as ItemFound', !!find);
  check('a stick ends first-spawn grace after 10 more ticks', !!find && me(A).respawnTick <= find.tick, `respawnTick=${me(A).respawnTick} find=${find?.tick}`);
  // No spare sticks: while you hold one, a finished harvest never finds another.
  const foundBefore = A.events.filter((e) => e.kind === EventKind.ItemFound).length;
  const extra = harvestsDone(A);
  const spareTree = [...A.conn.db.tree.iter()].sort((a, b) => a.cooldownUntilTick - b.cooldownUntilTick || chebyshev(me(A), a) - chebyshev(me(A), b))[0];
  await A.conn.reducers.startHarvest({ treeId: spareTree.id });
  await waitFor('one more harvest while holding the stick', () => harvestsDone(A) > extra, 60_000);
  check('no spare stick while holding one', rowsOf(A, STICK_ITEM_ID).length === 1 && A.events.filter((e) => e.kind === EventKind.ItemFound).length === foundBefore);

  let stickSlot = rowsOf(A, STICK_ITEM_ID)[0].slot;
  if (stickSlot >= HOTBAR_SIZE) {
    await A.conn.reducers.moveItem({ from: stickSlot, to: 0 });
    await waitFor('stick moved into quick slot 1', () => rowsOf(A, STICK_ITEM_ID).some((row) => row.slot === 0), 3_000);
    stickSlot = 0;
  }
  let wieldError = await rejection(() => A.conn.reducers.wieldItem({ slot: HOTBAR_SIZE }));
  check('wielding outside the quick slots is rejected', wieldError.length > 0, wieldError);
  const hotbarBerry = inv(A).find((row) => row.slot < HOTBAR_SIZE && isBerry(row.itemId));
  if (hotbarBerry) {
    wieldError = await rejection(() => A.conn.reducers.wieldItem({ slot: hotbarBerry.slot }));
    check('a berry cannot be wielded', wieldError.length > 0 && me(A).weapon === '', wieldError);
  }
  await A.conn.reducers.wieldItem({ slot: stickSlot });
  await waitFor('A wields the stick', () => me(A).weapon === STICK_ITEM_ID, 3_000);
  await waitFor('B sees the stick in A\'s hand', () => other(B, A.identity).weapon === STICK_ITEM_ID, 3_000);
  check('the wielded stick is public on the player row', true);
  await A.conn.reducers.unwield({});
  await waitFor('unwield returns to punching', () => me(A).weapon === '', 3_000);

  // --- the stick is the key: through the hedge to the Coast, and home again ------
  await A.conn.reducers.setTarget({ x: 2, z: 25 });
  const route: string[] = [];
  await waitFor('A reaches the Coast at (2,25)', () => {
    const p = me(A);
    const at = `${p.x},${p.z}`;
    if (route.at(-1) !== at) route.push(at);
    return p.x === 2 && p.z === 25;
  }, 30_000);
  check('a stick holder pushes through the hedge to the Coast', areaOf(me(A)) === 'coast', route.join(' '));
  await A.conn.reducers.dropItem({ slot: stickSlot, quantity: 1 });
  await waitFor('stick dropped on the Coast', () => rowsOf(A, STICK_ITEM_ID).length === 0, 3_000);
  await waitFor('B sees the stick on the Coast', () => [...B.conn.db.groundItem.iter()].some((g) => g.itemId === STICK_ITEM_ID && g.droppedBy.toHexString() === A.identity), 3_000);
  const coastStick = [...B.conn.db.groundItem.iter()].find((g) => g.itemId === STICK_ITEM_ID && g.droppedBy.toHexString() === A.identity)!;
  const fetchError = await rejection(() => B.conn.reducers.pickupItem({ id: coastStick.id }));
  check('a stickless player cannot fetch an item beyond the brambles', /brambles/.test(fetchError), fetchError);
  check('...and nothing is queued', me(B).pending === Pending.None);
  // A, standing on the Coast next to it, picks the key back up.
  await A.conn.reducers.pickupItem({ id: coastStick.id });
  await waitFor('A picks the stick back up', () => rowsOf(A, STICK_ITEM_ID).length === 1, 6_000);
  stickSlot = rowsOf(A, STICK_ITEM_ID)[0].slot;
  if (stickSlot >= HOTBAR_SIZE) {
    const free = [0, 1, 2].find((s) => !inv(A).some((row) => row.slot === s)) ?? 0;
    await A.conn.reducers.moveItem({ from: stickSlot, to: free });
    await waitFor('stick back in the quick bar', () => rowsOf(A, STICK_ITEM_ID)[0]?.slot === free, 3_000);
    stickSlot = free;
  }
  await A.conn.reducers.setTarget({ x: 29, z: 25 });
  await waitFor('A home at 29,25', () => me(A).x === 29 && me(A).z === 25, 30_000);

  // --- combat: wait for B's first-spawn grace (3:00) to end --------------------
  await B.conn.reducers.setTarget({ x: 31, z: 27 });
  await waitFor('B at 31,27', () => me(B).x === 31 && me(B).z === 27, 10_000);
  const graceEnds = me(B).respawnTick + RESPAWN_GRACE_TICKS;
  console.log(`      waiting ${Math.max(0, graceEnds - tick(A))} ticks for B's first-spawn grace to end`);
  await waitFor('B leaves first-spawn grace', () => tick(A) >= graceEnds, 200_000);
  const hpB0 = me(B).hp;
  await A.conn.reducers.attack({ target: me(B).identity });
  check('an accepted attack ends the attacker\'s grace', me(A).respawnTick === 0);
  await waitFor('A adjacent to B', () => chebyshev(me(A), me(B)) <= 1);
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
  const exch = exchanges(A, A.identity, B.identity).slice(nBefore, nBefore + 4);
  const attackersAlternate = exch.every((e, i) => i === 0 || e.attacker.toHexString() !== exch[i - 1].attacker.toHexString());
  const ticksApart = exch.every((e, i) => i === 0 || e.tick - exch[i - 1].tick === 2);
  check('exchanges alternate between A and B', attackersAlternate, exch.map((e) => e.attacker.toHexString().slice(4, 8)).join(','));
  check('exchanges are 2 ticks apart', ticksApart, exch.map((e) => e.tick).join(','));
  const hitByB = exch.find((e) => e.attacker.toHexString() === B.identity);
  check('B hits A back', !!hitByB, hitByB ? `dmg=${hitByB.damage}` : '');
  check(`every rally swing is a ${PUNCH_DAMAGE}-damage punch`, exch.every((e) => e.damage === PUNCH_DAMAGE && e.itemId === ''),
    exch.map((e) => `${e.damage}${e.itemId ? ':' + e.itemId : ''}`).join(','));
  check('no retired exchange kinds (1-3) arrive', ![...A.events, ...B.events].some((e) => e.kind >= 1 && e.kind <= 3));
  await B.conn.reducers.cancel({});

  // --- stick swing and death with real carried inventory -------------------------
  const carried = [...B.conn.db.inventorySlot.iter()].map(({ itemId, quantity }) => ({ itemId, quantity }));
  check('death test begins with a carried greenberry', carried.length === 1 && carried[0].itemId === 'berry_greenberry' && carried[0].quantity === 1);
  const lootBefore = countOf(A, carried[0]?.itemId ?? '');
  const stickHitsBefore = A.events.filter((e) => e.kind === EventKind.Hit && e.attacker.toHexString() === A.identity && e.itemId === STICK_ITEM_ID).length;
  await A.conn.reducers.wieldItem({ slot: stickSlot });
  await waitFor('A swings the stick at B', () => A.events.filter((e) => e.kind === EventKind.Hit && e.attacker.toHexString() === A.identity && e.itemId === STICK_ITEM_ID).length > stickHitsBefore, 20_000);
  const stickHit = A.events.filter((e) => e.kind === EventKind.Hit && e.attacker.toHexString() === A.identity && e.itemId === STICK_ITEM_ID)[stickHitsBefore];
  check(`a stick swing deals ${STICK_DAMAGE} and names the stick`, stickHit.damage === STICK_DAMAGE && stickHit.itemId === STICK_ITEM_ID, `dmg=${stickHit.damage} itemId=${stickHit.itemId}`);
  check('B received the stick Hit event', B.events.some((e) => e.tick === stickHit.tick && e.kind === EventKind.Hit && e.itemId === STICK_ITEM_ID));
  await waitFor('B dies and drops carried inventory', () => me(B).state === 1 && [...B.conn.db.inventorySlot.iter()].length === 0, 40_000);
  await waitFor('A sees the death drop', () => [...A.conn.db.groundItem.iter()].some((item) => item.droppedBy.toHexString() === B.identity && item.droppedOnDeath));
  const deathDrops = [...A.conn.db.groundItem.iter()].filter((item) => item.droppedBy.toHexString() === B.identity && item.droppedOnDeath);
  check('death drop preserves the exact carried item and quantity', deathDrops.length === 1 && deathDrops[0].itemId === carried[0]?.itemId && deathDrops[0].quantity === carried[0]?.quantity);
  check('death event identifies B', A.events.some((event) => event.kind === EventKind.Death && event.defender.toHexString() === B.identity));
  const killingBlow = A.events.filter((e) => e.kind === EventKind.Hit && e.defender.toHexString() === B.identity).at(-1);
  check('B died purely from HP reaching 0', !!killingBlow && killingBlow.defenderHp === 0, killingBlow ? `dmg=${killingBlow.damage} hp=${killingBlow.defenderHp}` : 'no hit');
  check('A stopped targeting the dead player', me(A).combatTarget === undefined);
  await waitFor('B respawns', () => me(B).state === 0 && me(B).hp === MAX_HP, 6_000);
  check('B respawned at spawn at full HP with an empty inventory', me(B).x === 25 && me(B).z === 25 && [...B.conn.db.inventorySlot.iter()].length === 0);
  check('a respawned player is protected (safe ring and 10-tick grace)', inGrace(me(B), tick(A))
    && (await rejection(() => A.conn.reducers.attack({ target: me(B).identity }))).length > 0);
  await A.conn.reducers.pickupItem({ id: deathDrops[0].id });
  await waitFor('A recovers death loot and B sees the pile disappear', () => !B.conn.db.groundItem.id.find(deathDrops[0].id) && countOf(A, carried[0].itemId) === lootBefore + carried[0].quantity);
  check('death loot is collectible by the other player', true);

  // --- a third, fresh player is protected ------------------------------------------
  const C = await connect('C');
  await waitFor('A sees C online', () => [...A.conn.db.player.iter()].some((p) => p.identity.toHexString() === C.identity && p.online));
  check(`C washes ashore at ${FIRST_SPAWN_HP} HP`, me(C).hp === FIRST_SPAWN_HP);
  check('C cannot be attacked in first-spawn grace', /protected|safe ring/.test(await rejection(() => A.conn.reducers.attack({ target: me(C).identity }))));
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
  const respawnTickBefore = me(A).respawnTick;
  A.conn.disconnect();
  await sleep(500);
  const A2 = await connect('A2', A.token);
  check('reconnect keeps identity', A2.identity === A.identity);
  check('reconnect keeps name, hp and grace state', me(A2).name === testName && me(A2).hp === other(B, A.identity).hp && me(A2).respawnTick === respawnTickBefore, `hp=${me(A2).hp}`);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  A2.conn.disconnect();
  B.conn.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('SMOKE ERROR', e); process.exit(1); });
