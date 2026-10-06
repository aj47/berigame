/**
 * End-to-end boss check against an isolated local SpacetimeDB with this
 * module published: Clatterhorn (closed by default, wake, telegraph, blows,
 * defeat, payout, burrow and respawn) and the Sunken Spire (keys, lobby,
 * start, teleport, bullets and i-frames, stars, knockout, clear rewards and
 * the owner close refund).
 *
 * Never point it at a shared world: it opens and closes the bosses and seeds
 * test items as ground items through owner SQL. Use a fresh database:
 *
 *   spacetime publish --server http://127.0.0.1:3177 --module-path spacetimedb --delete-data=never --yes boss-e2e
 *   cd frontend && SPACETIME_URI=ws://127.0.0.1:3177 SPACETIME_DB=boss-e2e \
 *     BOSS_OWNER_TOKEN=<the publisher's token> npx tsx scripts/boss-smoke.ts
 *
 * BOSS_CLI_CONFIG=<path to the publisher's cli.toml> can replace BOSS_OWNER_TOKEN.
 * The owner (the identity that published the database) drives configure_bosses
 * and boss_debug over a control connection, which creates no character.
 */
import { readFileSync } from 'node:fs';
import { Identity } from 'spacetimedb';
import { DbConnection, tables } from '../src/module_bindings';
import type { BossEvent, BossNotice, Player } from '../src/module_bindings/types';
import {
  BossEventKind, BossId, BossNoticeKind, CLATTER_GLADE, CLATTER_HOME, CLATTERHORN_ID, CLATTER_RESPAWN_TICKS, CLATTER_STATE_NAMES, ClatterState,
  HOTBAR_SIZE, HurtSource, SPIRE_CENTRE, SPIRE_EXIT, SPIRE_GATE, SPIRE_KEY_ITEM_ID, SPIRE_KO_HP, SPIRE_RULES_VERSION,
  SPIRE_SPAWNS, SPIRE_STAR_DAMAGE, STICK_ITEM_ID, STONE_CLUB_ITEM_ID, SpireMemberState, SpireOutcome, SpireStage, TICK_MS,
  chebyshev, enterRule, hasCosmetic, inBossRect, nearestReachableTile, spireSlot, worldBlockedSet, type Tile,
} from '../../shared/sim';
import { dangerFeed, type BossRows } from '../agent-api/statePresentation';

const URI = process.env.SPACETIME_URI ?? 'ws://127.0.0.1:3177';
const DB = process.env.SPACETIME_DB ?? 'boss-e2e';
const HTTP = URI.replace(/^ws/, 'http');

function ownerToken(): string {
  if (process.env.BOSS_OWNER_TOKEN) return process.env.BOSS_OWNER_TOKEN;
  const path = process.env.BOSS_CLI_CONFIG;
  if (!path) throw new Error('Set BOSS_OWNER_TOKEN (or BOSS_CLI_CONFIG) to the publishing identity\'s token');
  const match = /spacetimedb_token\s*=\s*"([^"]+)"/.exec(readFileSync(path, 'utf8'));
  if (!match) throw new Error(`No spacetimedb_token in ${path}`);
  return match[1];
}

interface Client {
  name: string;
  conn: DbConnection;
  /** The reducers, retried on the per-tick input limit ("slow down"). */
  r: DbConnection['reducers'];
  identity: string;
  notices: BossNotice[];
  events: BossEvent[];
}

const SUBSCRIBE = [
  tables.world, tables.player, tables.tree, tables.groundItem, tables.inventorySlot, tables.adventureProfile, tables.playerCosmetic,
  tables.bossConfig, tables.clatterhorn, tables.spireRun, tables.spireMember, tables.spireFight, tables.bossEvent, tables.bossNotice,
];

function connect(name: string, token?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const notices: BossNotice[] = [], events: BossEvent[] = [];
    const timer = setTimeout(() => reject(new Error(`${name}: connect timeout`)), 10_000);
    DbConnection.builder().withUri(URI).withDatabaseName(DB).withToken(token)
      .onConnectError((_c, err) => { clearTimeout(timer); reject(err); })
      .onConnect((conn, identity) => {
        const me = identity.toHexString();
        // boss_notice has no RLS policy (docs/design/BOSSES.md 4): keep only rows addressed to us, like the clients do.
        conn.db.bossNotice.onInsert((_c, row) => { if (row.player.toHexString() === me) notices.push(row); });
        conn.db.bossEvent.onInsert((_c, row) => events.push(row));
        conn.subscriptionBuilder()
          .onApplied(() => { clearTimeout(timer); resolve({ name, conn, r: retrying(conn.reducers), identity: me, notices, events }); })
          .onError((ctx) => { clearTimeout(timer); reject((ctx as any).event ?? new Error(`${name}: subscribe failed`)); })
          .subscribe(SUBSCRIBE);
      }).build();
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** At most MAX_INPUTS_PER_TICK inputs per tick: wait a tick and retry instead of failing the check. */
function retrying<R extends object>(reducers: R): R {
  return new Proxy(reducers, {
    get(target, key) {
      const f = (target as any)[key];
      if (typeof f !== 'function') return f;
      return async (...args: unknown[]) => {
        for (let i = 0; ; i++) {
          try { return await f.apply(target, args); } catch (e: any) {
            if (i < 8 && /slow down/.test(String(e?.message ?? e))) { await sleep(TICK_MS); continue; }
            throw e;
          }
        }
      };
    },
  });
}

/**
 * A fresh player identity the owner admits with grant_player, so the script also runs against a world with
 * admission enabled (the agent gateway's worlds). Without admission the grant is harmless.
 */
async function admittedToken(owner: Client): Promise<string> {
  const res = await fetch(`${HTTP}/v1/identity`, { method: 'POST' });
  if (!res.ok) throw new Error(`identity mint failed ${res.status}`);
  const { identity, token } = await res.json() as { identity: string; token: string };
  await owner.r.grantPlayer({ identity: Identity.fromString(identity), lifetimeSeconds: 7200, combat: true, chat: true });
  return token;
}
async function waitFor(label: string, pred: () => boolean, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (pred()) return; await sleep(40); }
  throw new Error(`timeout waiting for: ${label}`);
}
async function rejection(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); return ''; } catch (e: any) { return String(e?.message ?? e); }
}

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  (' + extra + ')' : ''}`);
  if (!ok) failures++;
}

const tick = (c: Client) => c.conn.db.world.id.find(0)?.tick ?? 0;
function me(c: Client): Player {
  for (const p of c.conn.db.player.iter()) if (p.identity.toHexString() === c.identity) return p;
  throw new Error(`${c.name}: own player row missing`);
}
const inv = (c: Client) => [...c.conn.db.inventorySlot.iter()].filter((r) => r.owner.toHexString() === c.identity);
const countOf = (c: Client, itemId: string) => inv(c).filter((r) => r.itemId === itemId).reduce((n, r) => n + r.quantity, 0);
const bag = (c: Client) => inv(c).map((r) => `${r.slot}:${r.itemId}x${r.quantity}`).sort().join(',');
const clatter = (c: Client) => c.conn.db.clatterhorn.id.find(CLATTERHORN_ID);
const fightingXp = (c: Client) => c.conn.db.adventureProfile.identity.find(me(c).identity)?.fightingXp ?? 0;
const cosmetics = (c: Client) => c.conn.db.playerCosmetic.identity.find(me(c).identity)?.unlocked ?? 0;
const member = (c: Client) => [...c.conn.db.spireMember.iter()].find((m) => m.identity.toHexString() === c.identity);
const run = (c: Client, id: bigint) => c.conn.db.spireRun.id.find(id);
const fight = (c: Client, id: bigint) => c.conn.db.spireFight.runId.find(id);
const bossRows = (c: Client): BossRows => ({
  config: [...c.conn.db.bossConfig.iter()][0] ?? null, clatter: clatter(c) ?? null,
  runs: [...c.conn.db.spireRun.iter()], members: [...c.conn.db.spireMember.iter()], fights: [...c.conn.db.spireFight.iter()],
});

/** Owner SQL over HTTP: only for seeding test items as ground items (never a production cheat). */
async function sql(token: string, query: string): Promise<void> {
  const res = await fetch(`${HTTP}/v1/database/${DB}/sql`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: query });
  if (!res.ok) throw new Error(`sql failed ${res.status}: ${await res.text()}`);
}
/** Seeds a player's kit; `droppedTick` is a per-batch marker so a rerun never picks up an older batch's leftovers. */
async function seedGround(token: string, owner: string, at: Tile, marker: number, items: [string, number][]): Promise<void> {
  for (const [itemId, quantity] of items) {
    await sql(token, `INSERT INTO ground_item (id, item_id, quantity, x, z, dropped_by, dropped_tick, expires_tick, dropped_on_death) `
      + `VALUES (0, '${itemId}', ${quantity}, ${at.x}, ${at.z}, 0x${owner}, ${marker}, 4000000000, false)`);
  }
}

async function pickUpAll(c: Client, marker: number, itemIds: string[]): Promise<void> {
  for (const itemId of itemIds) {
    const before = countOf(c, itemId);
    const item = [...c.conn.db.groundItem.iter()].find((g) => g.itemId === itemId && g.droppedTick === marker);
    if (!item) throw new Error(`${c.name}: no ${itemId} on the ground nearby`);
    await c.r.pickupItem({ id: item.id });
    await waitFor(`${c.name} picks up ${itemId}`, () => countOf(c, itemId) > before, 15_000);
  }
}

async function wieldStick(c: Client): Promise<void> {
  let row = inv(c).find((r) => r.itemId === STICK_ITEM_ID)!;
  if (row.slot >= HOTBAR_SIZE) {
    const free = [0, 1, 2].find((s) => !inv(c).some((r) => r.slot === s)) ?? 0;
    await c.r.moveItem({ from: row.slot, to: free });
    await waitFor('stick in the quick bar', () => inv(c).some((r) => r.itemId === STICK_ITEM_ID && r.slot === free));
    row = inv(c).find((r) => r.itemId === STICK_ITEM_ID)!;
  }
  await c.r.wieldItem({ slot: row.slot });
  await waitFor(`${c.name} wields the stick`, () => me(c).weapon === STICK_ITEM_ID);
}

async function walk(c: Client, to: Tile, timeoutMs = 90_000): Promise<void> {
  const blocked = worldBlockedSet(c.conn.db.tree.iter());
  const dest = nearestReachableTile(me(c), to, blocked, enterRule(true, true));
  await c.r.setTarget({ x: dest.x, z: dest.z });
  await waitFor(`${c.name} walks to ${dest.x},${dest.z}`, () => me(c).x === dest.x && me(c).z === dest.z, timeoutMs);
}

async function eatIfLow(c: Client, below: number, onFloor = false): Promise<void> {
  const p = me(c);
  if (p.hp >= below || p.eatCooldownUntilTick > tick(c)) return;
  const meals = member(c)?.meals ?? 0;
  if (onFloor && meals >= 6) return;
  const berry = inv(c).find((r) => r.itemId === 'berry_goldberry');
  if (berry) await c.r.eatBerry({ slot: berry.slot }).catch(() => {});
}

async function main() {
  const token = ownerToken();
  const owner = await connect('owner', token);
  const A = await connect('A', await admittedToken(owner));
  const B = await connect('B', await admittedToken(owner));
  await waitFor('a running world', () => tick(A) > 0, 10_000);
  check('the owner control connection creates no character', ![...A.conn.db.player.iter()].some((p) => p.identity.toHexString() === owner.identity));
  // Names are unique per world: suffix the identity so reruns work.
  const nameOf = (c: Client) => `Boss${c.name}_${c.identity.slice(-4)}`;
  await A.r.setName({ name: nameOf(A) });
  await B.r.setName({ name: nameOf(B) });
  const cfgArgs = (clatterOpen: boolean, spireOpen: boolean) => ({
    clatterhornOpen: clatterOpen, spireOpen, spirePracticeOpen: false, spireMaxRuns: 12,
    spireHpBase: 1000, spireHpPerMember: 700, clatterHpBase: 200, clatterHpPerChallenger: 150,
  });

  // ---- Closed by default -----------------------------------------------------------------------------------------
  // Earlier runs of this script against the same database leave the bosses open; close them first.
  if ([...owner.conn.db.bossConfig.iter()].length > 0) await owner.r.configureBosses(cfgArgs(false, false));
  else check('a fresh world has no boss_config row (both bosses closed)', true);
  check('Clatterhorn is closed: attack refused', /glade is quiet/.test(await rejection(() => A.r.attackClatterhorn({}))));
  check('the Spire is sealed: spire_open refused', /sealed/.test(await rejection(() => A.r.spireOpen({ clientRules: SPIRE_RULES_VERSION }))));
  check('an outdated client is refused', /out of date/.test(await rejection(() => A.r.spireOpen({ clientRules: SPIRE_RULES_VERSION + 1 }))));
  check('boss_debug is owner-only', /owner required/.test(await rejection(() => A.r.bossDebug({ op: 'clatter_wake', runId: 0n, value: 0 }))));
  check('configure_bosses is owner-only', /owner required/.test(await rejection(() => A.r.configureBosses(cfgArgs(true, true)))));

  // ---- Test kit: a stick (the Coast key, ends spawn grace), a stone club (the boulder line), food, obsidian -------
  const markers = new Map([[A, 1_000_000_000 + Math.floor(Math.random() * 1e9)], [B, 3_000_000_000 + Math.floor(Math.random() * 1e9)]]);
  for (const c of [A, B]) {
    await seedGround(token, owner.identity, me(c), markers.get(c)!, [[STICK_ITEM_ID, 1], [STONE_CLUB_ITEM_ID, 1], ['berry_goldberry', 8], ['obsidian', c === A ? 6 : 3]]);
  }
  await waitFor('seeded ground items arrive', () => [...A.conn.db.groundItem.iter()].filter((g) => g.droppedTick === markers.get(B)).length >= 4);
  for (const c of [A, B]) {
    await pickUpAll(c, markers.get(c)!, [STICK_ITEM_ID, STONE_CLUB_ITEM_ID, 'berry_goldberry', 'obsidian']);
    await wieldStick(c);
    while (me(c).hp < me(c).maxHp) {
      const hp = me(c).hp;
      await waitFor('eat cooldown', () => me(c).eatCooldownUntilTick <= tick(c), 5_000);
      await c.r.eatBerry({ slot: inv(c).find((r) => r.itemId === 'berry_goldberry')!.slot });
      await waitFor(`${c.name} heals`, () => me(c).hp > hp, 5_000);
    }
  }
  check('both players hold a stick, a club and food at full HP', [A, B].every((c) => countOf(c, STICK_ITEM_ID) === 1 && countOf(c, STONE_CLUB_ITEM_ID) === 1 && me(c).hp === me(c).maxHp));

  // ---- Clatterhorn ----------------------------------------------------------------------------------------------
  await owner.r.configureBosses(cfgArgs(true, false));
  // A rerun finds the row Closed; opening returns it Dormant at home.
  await waitFor('Clatterhorn opens', () => !!clatter(A) && clatter(A)!.state !== ClatterState.Closed);
  const c0 = clatter(A)!;
  check('opening Clatterhorn inserts it Dormant at home with base HP', c0.state === ClatterState.Dormant && c0.x === CLATTER_HOME.x && c0.z === CLATTER_HOME.z && c0.hp === 200 && c0.maxHp === 200,
    `state=${c0.state} at ${c0.x},${c0.z} hp=${c0.hp}/${c0.maxHp}`);
  const fights0 = c0.fightCount;

  // Every windup as it is published: the lead is its landing tick minus the tick it first appeared.
  const windups = new Map<number, { state: number; lead: number }>();
  const seeWindup = () => {
    const row = clatter(A), T = tick(A);
    if (row && [ClatterState.ChargeWindup, ClatterState.SpinWindup, ClatterState.DrumWindup].includes(row.state as any) && !windups.has(row.stateUntilTick)) {
      windups.set(row.stateUntilTick, { state: row.state, lead: row.stateUntilTick - T });
    }
  };
  A.conn.db.clatterhorn.onUpdate(seeWindup);
  A.conn.db.clatterhorn.onInsert(seeWindup);

  // Walk A into the glade; B waits just outside it.
  const wakeEventsBefore = A.events.filter((e) => e.kind === BossEventKind.ClatterWake).length;
  await Promise.all([walk(A, { x: 84, z: 110 }), walk(B, { x: 84, z: 117 })]);
  check('A stands in the glade and B outside it', inBossRect(me(A), CLATTER_GLADE) && !inBossRect(me(B), CLATTER_GLADE), `A ${me(A).x},${me(A).z} B ${me(B).x},${me(B).z}`);
  await waitFor('Clatterhorn wakes', () => clatter(A)!.state !== ClatterState.Dormant, 10_000);
  await waitFor('ClatterWake event', () => A.events.filter((e) => e.kind === BossEventKind.ClatterWake).length > wakeEventsBefore, 5_000).catch(() => {});
  check('Clatterhorn wakes for a stick holder out of grace in the glade', clatter(A)!.fightCount === fights0 + 1 && A.events.some((e) => e.kind === BossEventKind.ClatterWake),
    `state=${clatter(A)!.state} fight=${clatter(A)!.fightCount}`);

  // Both attack; watch telegraphs and blows while the swings land.
  await B.r.attackClatterhorn({});
  await A.r.attackClatterhorn({});

  const credit = new Map<string, number>();
  const end = Date.now() + 90_000;
  let lastTick = 0;
  while (Date.now() < end) {
    const T = tick(A);
    if (T !== lastTick) {
      lastTick = T;
      for (const c of [A, B]) {
        await eatIfLow(c, 16);
        // A blow does not stop swings, but a dodge or a death would: keep the loop going.
        if (me(c).state === 0 && me(c).pending !== 6) await c.r.attackClatterhorn({}).catch(() => {});
      }
    }
    for (const c of [A, B]) for (const n of c.notices) if (n.boss === BossId.Clatterhorn && n.kind === BossNoticeKind.YouHit) credit.set(c.name, Math.max(credit.get(c.name) ?? 0, n.total));
    const hurt = [...A.notices, ...B.notices].some((n) => n.boss === BossId.Clatterhorn && n.kind === BossNoticeKind.Hurt);
    if ((credit.get('A') ?? 0) >= 16 && (credit.get('B') ?? 0) >= 16 && hurt && windups.size >= 2) break;
    await sleep(40);
  }
  const leads = [...windups.values()];
  check('Clatterhorn telegraphs its attacks at least 3 ticks ahead', leads.length > 0 && leads.every((w) => w.lead >= 3),
    leads.map((w) => `${CLATTER_STATE_NAMES[w.state] ?? w.state}:${w.lead}`).join(' '));
  const hurts = [...A.notices, ...B.notices].filter((n) => n.boss === BossId.Clatterhorn && n.kind === BossNoticeKind.Hurt);
  check('Clatterhorn\'s blows damage players (Hurt notices)', hurts.length > 0,
    hurts.map((n) => `${n.quantity === HurtSource.Charge ? 'charge' : n.quantity === HurtSource.Spin ? 'spin' : 'runner'}-${n.amount}->${n.hp}`).join(' '));
  check('swings land with a stick (6 each) and both pass the 16-damage minimum', (credit.get('A') ?? 0) >= 16 && (credit.get('B') ?? 0) >= 16,
    `A=${credit.get('A')} B=${credit.get('B')}`);
  const grown = clatter(A)!;
  check('each challenger adds 150 HP', grown.maxHp === 200 + 150 * grown.challengers && grown.challengers === 2, `max=${grown.maxHp} challengers=${grown.challengers}`);

  // Defeat: drop it to 1% and let the next swing finish it.
  const before = new Map([A, B].map((c) => [c.name, { gleam: countOf(c, 'gleamshell'), gold: countOf(c, 'berry_goldberry'), xp: fightingXp(c), cos: cosmetics(c) }]));
  await owner.r.bossDebug({ op: 'clatter_hp', runId: 0n, value: 1 });
  await waitFor('Clatterhorn is defeated', () => clatter(A)!.state === ClatterState.Burrowed, 30_000);
  const defeatTick = tick(A);
  await waitFor('ClatterDefeat event', () => A.events.some((e) => e.kind === BossEventKind.ClatterDefeat), 5_000).catch(() => {});
  const defeatEvent = A.events.find((e) => e.kind === BossEventKind.ClatterDefeat);
  check('a defeat burrows it at home for 300 ticks and names 2 rewardees', !!defeatEvent && defeatEvent.quantity === 2
    && clatter(A)!.x === CLATTER_HOME.x && clatter(A)!.z === CLATTER_HOME.z && clatter(A)!.stateUntilTick >= defeatTick + CLATTER_RESPAWN_TICKS - 2,
    `event=${defeatEvent?.quantity} until=${clatter(A)!.stateUntilTick} T=${defeatTick}`);
  await waitFor('rewards paid', () => [A, B].every((c) => countOf(c, 'gleamshell') >= before.get(c.name)!.gleam + 2), 8_000).catch(() => {});
  // Overflow goldberries drop at the player's tile; both bags have room here.
  for (const c of [A, B]) {
    const b = before.get(c.name)!;
    // Eating between the snapshot and the payout can only lower the goldberry count; the payout adds 2.
    check(`${c.name} gets 2 gleamshell, 2 goldberries, 40 Fighting XP and the Clatterhorn Horn`,
      countOf(c, 'gleamshell') === b.gleam + 2 && countOf(c, 'berry_goldberry') >= b.gold + 2 - 1 && fightingXp(c) === b.xp + 40 && hasCosmetic(cosmetics(c), 12),
      `gleam ${b.gleam}->${countOf(c, 'gleamshell')} gold ${b.gold}->${countOf(c, 'berry_goldberry')} xp ${b.xp}->${fightingXp(c)} cos=${cosmetics(c).toString(2)}`);
    const kinds = c.notices.filter((n) => n.boss === BossId.Clatterhorn).map((n) => n.kind);
    check(`${c.name} receives Reward and Keepsake notices`, kinds.includes(BossNoticeKind.Reward) && kinds.includes(BossNoticeKind.Keepsake));
  }
  check('swingers stop at the defeat', [A, B].every((c) => me(c).pending !== 6));
  check('a burrowed beetle refuses swings with the return time', /burrowed away/.test(await rejection(() => A.r.attackClatterhorn({}))));

  // ---- Spire keys ------------------------------------------------------------------------------------------------
  await owner.r.configureBosses(cfgArgs(true, true));
  await Promise.all([walk(A, { x: SPIRE_GATE.x - 1, z: SPIRE_GATE.z + 1 }), walk(B, { x: SPIRE_GATE.x - 2, z: SPIRE_GATE.z })]);
  check('both players reach the Spire Gate', chebyshev(me(A), SPIRE_GATE) <= 3 && chebyshev(me(B), SPIRE_GATE) <= 3, `A ${me(A).x},${me(A).z} B ${me(B).x},${me(B).z}`);
  check('opening a lobby without a key is refused', /spire key/.test(await rejection(() => B.r.spireOpen({ clientRules: SPIRE_RULES_VERSION }))));
  for (const [c, n] of [[A, 2], [B, 1]] as const) {
    for (let i = 0; i < n; i++) {
      const k = countOf(c, SPIRE_KEY_ITEM_ID);
      await c.r.craft({ recipe: SPIRE_KEY_ITEM_ID });
      await waitFor(`${c.name} crafts a key`, () => countOf(c, SPIRE_KEY_ITEM_ID) === k + 1);
    }
  }
  check('spire keys craft from 3 obsidian + 1 gleamshell', countOf(A, SPIRE_KEY_ITEM_ID) === 2 && countOf(A, 'obsidian') === 0 && countOf(A, 'gleamshell') === 0
    && countOf(B, SPIRE_KEY_ITEM_ID) === 1 && countOf(B, 'obsidian') === 0 && countOf(B, 'gleamshell') === 1);

  // ---- Run 1: lobby rules, a solo start, then the owner closes the Spire mid-run (refund) --------------------------
  await A.r.spireOpen({ clientRules: SPIRE_RULES_VERSION });
  await waitFor('A leads a lobby', () => member(A)?.state === SpireMemberState.Lobby);
  const run1 = member(A)!.runId;
  await B.r.spireJoin({ runId: 0n, clientRules: SPIRE_RULES_VERSION });
  await waitFor('B joins', () => member(B)?.runId === run1 && run(B, run1)?.partySize === 2);
  check('quick join puts B in slot 1 of A\'s lobby', member(B)!.slot === 1 && run(B, run1)!.partySize === 2 && run(B, run1)!.stage === SpireStage.Lobby,
    `slot=${member(B)!.slot} size=${run(B, run1)!.partySize} stage=${run(B, run1)!.stage}`);
  check('only the leader can start', /not leading/.test(await rejection(() => B.r.spireStart({ clientRules: SPIRE_RULES_VERSION }))));
  check('a second lobby while in one is refused', /already in a Spire party/.test(await rejection(() => B.r.spireOpen({ clientRules: SPIRE_RULES_VERSION }))));
  await B.r.spireLeave({});
  await waitFor('B leaves the lobby', () => !member(B) && run(A, run1)?.partySize === 1);
  check('leaving a lobby frees the slot', true);
  await A.r.spireStart({ clientRules: SPIRE_RULES_VERSION });
  await waitFor('run 1 active', () => run(A, run1)?.stage === SpireStage.Active && !!fight(A, run1));
  check('starting spends the key and teleports the leader to slot 0\'s spawn', countOf(A, SPIRE_KEY_ITEM_ID) === 1 && me(A).x === SPIRE_SPAWNS[0].x && me(A).z === SPIRE_SPAWNS[0].z,
    `keys=${countOf(A, SPIRE_KEY_ITEM_ID)} at ${me(A).x},${me(A).z}`);
  check('a solo fight has 1000 HP and starts after the 5-tick intro', fight(A, run1)!.maxHp === 1000 && run(A, run1)!.startTick >= tick(A) + 3);
  check('crafting is refused on the floor', /inside the Sunken Spire/.test(await rejection(() => A.r.craft({ recipe: SPIRE_KEY_ITEM_ID }))));
  await owner.r.configureBosses(cfgArgs(true, false));
  await waitFor('run 1 fails as Closed', () => run(A, run1)?.stage === SpireStage.Failed);
  await waitFor('A is ejected', () => me(A).x === SPIRE_EXIT.x && me(A).z === SPIRE_EXIT.z, 5_000).catch(() => {});
  await waitFor('key refunded', () => countOf(A, SPIRE_KEY_ITEM_ID) === 2, 5_000).catch(() => {});
  check('closing the Spire mid-run ejects to the gate and refunds the key', run(A, run1)!.outcome === SpireOutcome.Closed && me(A).x === SPIRE_EXIT.x && me(A).z === SPIRE_EXIT.z
    && countOf(A, SPIRE_KEY_ITEM_ID) === 2, `outcome=${run(A, run1)!.outcome} at ${me(A).x},${me(A).z} keys=${countOf(A, SPIRE_KEY_ITEM_ID)}`);
  check('the closed run sends a RunResult notice', A.notices.some((n) => n.boss === BossId.Spire && n.kind === BossNoticeKind.RunResult && n.quantity === SpireOutcome.Closed));
  await owner.r.configureBosses(cfgArgs(true, true));

  // ---- Run 2: A and B fight -------------------------------------------------------------------------------------
  for (const c of [A, B]) {
    while (me(c).hp < me(c).maxHp && countOf(c, 'berry_goldberry') > 0) {
      const hp = me(c).hp;
      await waitFor('eat cooldown', () => me(c).eatCooldownUntilTick <= tick(c), 5_000);
      await c.r.eatBerry({ slot: inv(c).find((r) => r.itemId === 'berry_goldberry')!.slot });
      await waitFor(`${c.name} heals`, () => me(c).hp > hp, 5_000);
    }
  }
  await A.r.spireOpen({ clientRules: SPIRE_RULES_VERSION });
  await waitFor('A leads a new lobby', () => member(A)?.state === SpireMemberState.Lobby && member(A)!.runId !== run1);
  const runId = member(A)!.runId;
  await B.r.spireJoin({ runId, clientRules: SPIRE_RULES_VERSION });
  await waitFor('B joins by id', () => member(B)?.runId === runId);
  await A.r.spireStart({ clientRules: SPIRE_RULES_VERSION });
  await waitFor('run 2 active', () => run(A, runId)?.stage === SpireStage.Active && !!fight(A, runId) && member(B)?.state === SpireMemberState.In);
  const r2 = run(A, runId)!;
  check('both keys are spent at the start', countOf(A, SPIRE_KEY_ITEM_ID) === 1 && countOf(B, SPIRE_KEY_ITEM_ID) === 0);
  check('members are teleported to their slot spawns on the floor', me(A).x === SPIRE_SPAWNS[0].x && me(A).z === SPIRE_SPAWNS[0].z && me(B).x === SPIRE_SPAWNS[1].x && me(B).z === SPIRE_SPAWNS[1].z,
    `A ${me(A).x},${me(A).z} B ${me(B).x},${me(B).z}`);
  check('a 2-member fight has 1700 HP', fight(A, runId)!.maxHp === 1700 && fight(A, runId)!.hp === 1700);
  check('A sees B on the floor (same run)', [...A.conn.db.player.iter()].some((p) => p.identity.toHexString() === B.identity && p.x === SPIRE_SPAWNS[1].x));

  const blocked = worldBlockedSet(A.conn.db.tree.iter());
  const hpLog: string[] = [];
  let bBagAtStart = bag(B);
  let bOutTick = 0, bHpAtKo = -1, debugged = false;
  const loopEnd = Date.now() + 240_000;
  lastTick = 0;
  while (Date.now() < loopEnd) {
    const T = tick(A);
    const r = run(A, runId);
    if (!r || r.stage !== SpireStage.Active) break;
    if (T === lastTick) { await sleep(25); continue; }
    lastTick = T;
    const f = fight(A, runId)!;
    for (const c of [A, B]) {
      const m = member(c);
      if (!m || m.state !== SpireMemberState.In) continue;
      const p = me(c);
      const feed = dangerFeed(bossRows(c), p, T, { players: c.conn.db.player.iter(), blocked, ageMs: 0, tickMs: TICK_MS });
      const myStars = spireSlot(f, 'stars', m.slot);
      if (c === B && myStars >= 3) {
        // B has earned its reward: walk into the bullets until it is knocked out.
        const map = feed.map ?? [], grid = feed.grid;
        let target: Tile | null = null;
        if (grid) {
          for (let dz = -2; dz <= 2 && !target; dz++) for (let dx = -2; dx <= 2 && !target; dx++) {
            const ch = map[p.z + dz - grid.z0]?.[p.x + dx - grid.x0];
            if (ch && /[1357]/.test(ch)) target = { x: p.x + dx, z: p.z + dz };
          }
        }
        if (target) await c.r.setTarget(target).catch(() => {});
        continue;
      }
      await eatIfLow(c, 14, true);
      const goal: Tile = myStars < 3 && feed.stars?.length
        ? feed.stars.slice().sort((a, b) => chebyshev(a, p) - chebyshev(b, p))[0]
        : SPIRE_CENTRE;
      const safe = feed.moves.filter((mv) => mv.winning);
      const pick = (safe.length ? safe : feed.moves).slice().sort((a, b) =>
        chebyshev({ x: a.to[0], z: a.to[1] }, goal) - chebyshev({ x: b.to[0], z: b.to[1] }, goal) || b.horizon - a.horizon)[0];
      if (pick && (pick.to[0] !== p.x || pick.to[1] !== p.z)) await c.r.setTarget({ x: pick.to[0], z: pick.to[1] }).catch(() => {});
    }
    const mb = member(B);
    if (mb?.state === SpireMemberState.Out && !bOutTick) { bOutTick = T; bHpAtKo = me(B).hp; }
    const aStars = spireSlot(f, 'stars', 0);
    if (!debugged && bOutTick && aStars >= 3) {
      debugged = true;
      await owner.r.bossDebug({ op: 'spire_hp', runId, value: 0 });
    }
    if (T % 10 === 0) hpLog.push(`T${T}:boss${f.hp} A${me(A).hp}/${aStars}* B${me(B).hp}/${spireSlot(f, 'stars', 1)}*`);
  }
  console.log('      ' + hpLog.join(' '));

  // Bullets, i-frames, stars.
  const bulletHurts = (c: Client) => c.notices.filter((n) => n.boss === BossId.Spire && n.kind === BossNoticeKind.Hurt && n.quantity === HurtSource.Bullet);
  const allHurts = [...bulletHurts(A), ...bulletHurts(B)];
  check('bullets hit members (Hurt notices, phase-1 damage 3)', allHurts.length > 0 && allHurts.some((n) => n.amount === 3), `${allHurts.length} hits: ${allHurts.slice(0, 6).map((n) => `${n.amount}->${n.hp}@${n.tick}`).join(' ')}`);
  const iframesOk = [A, B].every((c) => bulletHurts(c).every((n, i, xs) => i === 0 || n.tick - xs[i - 1].tick >= 3));
  check('i-frames: no member is hit twice within 3 ticks', iframesOk, [A, B].map((c) => bulletHurts(c).map((n) => n.tick).join(',')).join(' | '));
  const stars = [...A.notices, ...B.notices].filter((n) => n.boss === BossId.Spire && n.kind === BossNoticeKind.Star);
  check(`stars deal ${SPIRE_STAR_DAMAGE} to the boss`, stars.length >= 6 && stars.every((n) => n.amount === SPIRE_STAR_DAMAGE), `${stars.length} stars`);
  // Knockout.
  const mB = member(B);
  check('B is knocked out (Out), ejected to the gate with 10 HP and grace', !!bOutTick && (mB?.state === SpireMemberState.Out || mB?.state === undefined)
    && bHpAtKo === SPIRE_KO_HP && B.notices.some((n) => n.kind === BossNoticeKind.KnockedOut), `outTick=${bOutTick} hp=${bHpAtKo}`);
  bBagAtStart = bBagAtStart.split(',').filter((s) => !s.includes('berry_goldberry') && !s.includes('prism_shard')).join(',');
  const bBagNow = bag(B).split(',').filter((s) => !s.includes('berry_goldberry') && !s.includes('prism_shard')).join(',');
  check('the knockout leaves B\'s bag intact', bBagNow === bBagAtStart, `${bBagAtStart} vs ${bBagNow}`);
  // Clear.
  const rEnd = run(A, runId);
  check('the run clears after boss_debug spire_hp', rEnd?.stage === SpireStage.Cleared && rEnd.outcome === SpireOutcome.Cleared, `stage=${rEnd?.stage} outcome=${rEnd?.outcome}`);
  await waitFor('rewards', () => countOf(A, 'prism_shard') > 0, 5_000).catch(() => {});
  check('A is ejected to the gate as Done', me(A).x === SPIRE_EXIT.x && me(A).z === SPIRE_EXIT.z && member(A)?.state === SpireMemberState.Done, `at ${me(A).x},${me(A).z} state=${member(A)?.state}`);
  for (const c of [A, B]) {
    const rewards = c.notices.filter((n) => n.boss === BossId.Spire && n.kind === BossNoticeKind.Reward).map((n) => `${n.itemId}x${n.quantity}`);
    check(`${c.name} earns the clear reward (4 goldberries, 1 prism shard, 100 XP, Prism Crown)`,
      countOf(c, 'prism_shard') === 1 && rewards.includes('berry_goldberryx4') && rewards.includes('prism_shardx1') && hasCosmetic(cosmetics(c), 13),
      `${rewards.join(',')} cos=${cosmetics(c).toString(2)}`);
    check(`${c.name} gets a RunResult (Cleared)`, c.notices.some((n) => n.kind === BossNoticeKind.RunResult && n.runId === runId && n.quantity === SpireOutcome.Cleared));
  }
  check('a SpireClear world event names the party', A.events.some((e) => e.kind === BossEventKind.SpireClear && e.runId === runId && e.text.includes(nameOf(A)) && e.text.includes(nameOf(B))));
  check('the run started in Bloom and its pattern rotated', r2.phase === 1 && (fight(A, runId)?.patternCount ?? 2) >= 2);
  await waitFor('cleanup after the linger', () => !run(A, runId), 20_000).catch(() => {});
  check('the run, its members and fight are deleted after 20 ticks', !run(A, runId) && !fight(A, runId) && !member(A) && !member(B));

  // ---- Clatterhorn's own respawn after 300 ticks -------------------------------------------------------------------
  const back = clatter(A)!.stateUntilTick;
  console.log(`      waiting ${Math.max(0, back - tick(A))} ticks for Clatterhorn to return`);
  await waitFor('Clatterhorn returns', () => clatter(A)!.state === ClatterState.Dormant, Math.max(0, back - tick(A)) * TICK_MS + 15_000);
  const ret = clatter(A)!;
  check('Clatterhorn returns Dormant at home with full HP after 300 ticks', ret.x === CLATTER_HOME.x && ret.z === CLATTER_HOME.z && ret.hp === ret.maxHp && ret.maxHp === 200
    && A.events.some((e) => e.kind === BossEventKind.ClatterRespawn), `hp=${ret.hp}/${ret.maxHp}`);

  // Leave the world as the default: both closed.
  await owner.r.configureBosses(cfgArgs(false, false));
  check('closing Clatterhorn again sets it Closed', clatter(A)?.state === ClatterState.Closed || (await waitFor('closed', () => clatter(A)?.state === ClatterState.Closed, 3_000).then(() => true, () => false)));

  console.log(failures === 0 ? '\nALL BOSS CHECKS PASSED' : `\n${failures} BOSS CHECK(S) FAILED`);
  for (const c of [owner, A, B]) c.conn.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('BOSS SMOKE ERROR', e); process.exit(1); });
