/**
 * Live check of the economy rules (docs/design/ECONOMY.md) against a locally
 * running SpacetimeDB with the berigame module published:
 * energy is spent and shown only to its owner, the Grove vault deposits and
 * withdraws, a trade in the safe ring swaps at once while one outside waits
 * TRADE_SWAP_TICKS, and time logged out (not time online) makes you rested.
 * Run: npx tsx scripts/economy-check.ts   (SPACETIME_URI, SPACETIME_DB as for smoke.ts)
 */
import { DbConnection, tables } from '../src/module_bindings';
import type { Player } from '../src/module_bindings/types';
import {
  ENERGY_REGEN_MS, ENERGY_START_MAX, NodeKind, TICK_MS, TRADE_SWAP_TICKS, chebyshev, energyRestedLine, vaultId,
} from '../../shared/sim';

const URI = process.env.SPACETIME_URI ?? 'ws://127.0.0.1:3000';
const DB = process.env.SPACETIME_DB ?? 'berigame';

interface Client { name: string; conn: DbConnection; identity: string; token: string }

function connect(name: string, token?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name}: connect timeout`)), 10_000);
    DbConnection.builder().withUri(URI).withDatabaseName(DB).withToken(token)
      .onConnectError((_ctx, err) => { clearTimeout(timer); reject(err); })
      .onConnect((c, identity, tok) => {
        c.subscriptionBuilder()
          .onApplied(() => { clearTimeout(timer); resolve({ name, conn: c, identity: identity.toHexString(), token: tok }); })
          .onError((_ctx, err) => { clearTimeout(timer); reject(err); })
          .subscribe([tables.world, tables.player, tables.tree, tables.inventorySlot, tables.frontierView, tables.trade]);
      })
      .build();
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(label: string, pred: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { if (pred()) return; await sleep(50); }
  throw new Error(`timeout waiting for: ${label}`);
}
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
}
const me = (c: Client): Player => [...c.conn.db.player.iter()].find((p) => p.identity.toHexString() === c.identity)!;
const count = (c: Client, itemId: string) => [...c.conn.db.inventorySlot.iter()]
  .filter((r) => r.owner.toHexString() === c.identity && r.itemId === itemId).reduce((n, r) => n + r.quantity, 0);
const energy = (c: Client) => {
  const row = [...c.conn.db.frontierView.iter()].find((r) => r.kind === 'energy' && r.source === `energy:${c.identity}`);
  return row ? JSON.parse(row.data) as { points: number } : undefined;
};
const vault = (c: Client) => {
  const row = [...c.conn.db.frontierView.iter()].find((r) => r.kind === 'container' && r.source === `container:${vaultId(c.identity)}`);
  return row ? (JSON.parse(row.data).slots as ({ itemId: string; quantity: number } | null)[]).filter(Boolean) : [];
};
const tick = (c: Client) => c.conn.db.world.id.find(0)?.tick ?? 0;
async function walk(c: Client, x: number, z: number) {
  await c.conn.reducers.setTarget({ x, z });
  await waitFor(`${c.name} at ${x},${z}`, () => me(c).x === x && me(c).z === z, 30_000);
}
/** Harvest the nearest ready berry tree once; returns the item it gave. */
async function harvestOnce(c: Client): Promise<{ itemId: string; gained: number }> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const p = me(c), T = tick(c);
    const tree = [...c.conn.db.tree.iter()].filter((t) => t.kind === NodeKind.Berry && t.harvester === undefined && t.cooldownUntilTick <= T)
      .sort((a, b) => chebyshev(p, a) - chebyshev(p, b))[0];
    if (!tree) { await sleep(TICK_MS); continue; }
    const before = count(c, tree.itemId), spentBefore = energy(c)?.points;
    try { await c.conn.reducers.startHarvest({ treeId: tree.id }); } catch { await sleep(TICK_MS); continue; }
    try {
      await waitFor('harvest finishes', () => energy(c)?.points !== spentBefore && count(c, tree.itemId) !== before, 20_000);
      return { itemId: tree.itemId, gained: count(c, tree.itemId) - before };
    } catch { await c.conn.reducers.cancel({}); }
  }
  throw new Error(`${c.name}: no harvest`);
}

async function main() {
  console.log('economy check against', URI, DB);
  let A = await connect('A');
  const B = await connect('B');

  // --- energy -------------------------------------------------------------------
  const first = await harvestOnce(A);
  const line = energyRestedLine(ENERGY_START_MAX);
  const afterFirst = energy(A)!.points;
  check('a new character pays normally at the rested line', first.gained === 1, `gained ${first.gained}`);
  check('the harvest spent its seconds from a new meter at the rested line', afterFirst <= line - 3 && afterFirst >= line - 4, `points ${afterFirst}, line ${line}`);
  check('energy is shown only to its owner', ![...B.conn.db.frontierView.iter()].some((r) => r.kind === 'energy'));

  // --- the Grove vault ----------------------------------------------------------
  await walk(A, 25, 24);
  await A.conn.reducers.vaultDeposit({ itemId: first.itemId, quantity: 1 });
  await waitFor('vault shows the deposit', () => vault(A).some((s) => s!.itemId === first.itemId));
  check('a deposit in the safe ring is instant and the vault is visible to its owner', count(A, first.itemId) === 0 && vault(A).length === 1);
  check('nobody else sees your vault', ![...B.conn.db.frontierView.iter()].some((r) => r.kind === 'container'));
  await A.conn.reducers.vaultWithdraw({ itemId: first.itemId, quantity: 1 });
  await waitFor('berry back in the bag', () => count(A, first.itemId) === 1);
  check('a withdrawal in the safe ring is instant', vault(A).length === 0);

  // --- trades: instant in the ring, delayed outside -----------------------------
  const trade = async (where: { x: number; z: number }) => {
    await walk(A, where.x, where.z);
    await walk(B, where.x + 1, where.z);
    await A.conn.reducers.requestTrade({ target: me(B).identity });
    await waitFor('request arrives', () => [...B.conn.db.trade.iter()].length === 1);
    const id = [...B.conn.db.trade.iter()][0].id;
    await B.conn.reducers.respondTrade({ tradeId: id, accept: true });
    await A.conn.reducers.setTradeOffer({ tradeId: id, offer: `${first.itemId}:1` });
    await waitFor('offer set', () => B.conn.db.trade.id.find(id)?.aOffer === `${first.itemId}:1`);
    await A.conn.reducers.confirmTrade({ tradeId: id, aOffer: `${first.itemId}:1`, bOffer: '' });
    const confirmedAt = tick(A);
    await B.conn.reducers.confirmTrade({ tradeId: id, aOffer: `${first.itemId}:1`, bOffer: '' });
    return { id, confirmedAt };
  };
  const instant = await trade({ x: 24, z: 25 });
  await waitFor('instant swap', () => count(B, first.itemId) === 1, 3_000);
  check('in the safe ring the swap runs at once', !A.conn.db.trade.id.find(instant.id));
  // B hands it back outside the ring: the swap waits.
  await walk(B, 30, 31);
  await walk(A, 31, 31);
  await B.conn.reducers.requestTrade({ target: me(A).identity });
  await waitFor('request arrives', () => [...A.conn.db.trade.iter()].length === 1);
  const id = [...A.conn.db.trade.iter()][0].id;
  await A.conn.reducers.respondTrade({ tradeId: id, accept: true });
  await B.conn.reducers.setTradeOffer({ tradeId: id, offer: `${first.itemId}:1` });
  await waitFor('offer set', () => A.conn.db.trade.id.find(id)?.aOffer === `${first.itemId}:1`);
  await B.conn.reducers.confirmTrade({ tradeId: id, aOffer: `${first.itemId}:1`, bOffer: '' });
  await A.conn.reducers.confirmTrade({ tradeId: id, aOffer: `${first.itemId}:1`, bOffer: '' });
  await waitFor('swap scheduled', () => (A.conn.db.trade.id.find(id)?.swapTick ?? 0) > 0, 3_000);
  const swapTick = A.conn.db.trade.id.find(id)!.swapTick;
  check('outside the ring both confirmations schedule the swap instead of running it', count(A, first.itemId) === 0, `swapTick ${swapTick}, now ${tick(A)}`);
  await waitFor('delayed swap', () => count(A, first.itemId) === 1, 10_000);
  check(`the swap runs ${TRADE_SWAP_TICKS} ticks later`, tick(A) >= swapTick && !A.conn.db.trade.id.find(id));

  // --- rested: online time does not, time logged out does -----------------------
  const before = energy(A)!.points;
  const token = A.token;
  A.conn.disconnect();
  const away = 5 * ENERGY_REGEN_MS + 2_000;
  console.log(`      logged out for ${away / 1000} s`);
  await sleep(away);
  A = await connect('A', token);
  await waitFor('meter settled on reconnect', () => (energy(A)?.points ?? 0) > before, 10_000);
  const settled = energy(A)!.points;
  check('time logged out refills the meter, above the rested line', settled >= before + 5 && settled > line, `${before} -> ${settled}, line ${line}`);
  const rested = await harvestOnce(A);
  check('a rested harvest pays double', rested.gained === 2, `gained ${rested.gained}`);

  A.conn.disconnect();
  B.conn.disconnect();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall economy checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
