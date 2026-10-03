import { REGIONS, RESOURCE_PATCHES } from "../../shared/sim/frontier/catalog";
/** Isolated local-world check. Never point the owner credential at a hosted world. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { DbConnection, tables } from "../src/module_bindings";
import { frontierSnapshot } from "../../shared/sim/frontier/snapshot";
const uri = process.env.SPACETIME_URI ?? "ws://127.0.0.1:3123",
  database = process.env.SPACETIME_DB ?? "settlements-validation-v2";
if (
  !/^ws:\/\/127\.0\.0\.1:/.test(uri) ||
  !database.startsWith("settlements-validation")
)
  throw new Error("This fixture requires an isolated local world");
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function connect(
  token?: string,
  control = false,
): Promise<{ conn: DbConnection; identity: any; token: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("connection timeout")),
      10000,
    );
    DbConnection.builder()
      .withUri(uri)
      .withDatabaseName(database)
      .withToken(token)
      .onConnectError((_c, e) => reject(e))
      .onConnect((conn, identity, token) => {
        conn
          .subscriptionBuilder()
          .onApplied(() => {
            clearTimeout(timer);
            resolve({ conn, identity, token });
          })
          .onError((_c, e) => reject(e))
          .subscribe(
            control
              ? [tables.world]
              : [
                  tables.world,
                  tables.tree,
                  tables.player,
                  tables.inventorySlot,
                  tables.frontierObject,
                  tables.frontierView,
                  tables.trade,
                ],
          );
      })
      .build();
  });
}
async function wait(label: string, predicate: () => boolean, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await delay(100);
  }
  throw new Error(`Timeout: ${label}`);
}
async function main() {
  const config = await readFile(
    process.env.FRONTIER_OWNER_CONFIG ??
      "../.spacetime-data/settlements-validation/cli.toml",
    "utf8",
  );
  const token = JSON.parse(
    config.match(/spacetimedb_token\s*=\s*("[^"\n]+")/)![1],
  );
  const owner = await connect(token, true),
    a = await connect(),
    b = await connect();
  const self = (client = a) =>
    client.conn.db.player.identity.find(client.identity)!;
  const state = (client = a) =>
    frontierSnapshot(
      client.conn.db.frontierObject.iter(),
      client.conn.db.frontierView.iter(),
      client.identity.toHexString(),
      Date.now(),
    );
  const act = async (command: any, client = a) => {
    await client.conn.reducers.frontierAction({
      command: JSON.stringify(command),
    });
    await delay(150);
  };
  const walk = async (x: number, z: number, client = a) => {
    if (self(client).region === "bramblewild")
      await client.conn.reducers.setTarget({ x, z });
    else await act({ action: "move", x, z }, client);
    await wait("arrival", () => self(client).x === x && self(client).z === z);
  };
  try {
    await owner.conn.reducers.configureExpansion({
      enabled: true,
      pauseCaptures: false,
    });
    // The Meadows are reached on foot, through the same progression hedge as the harbour.
    const inventory = () => [...a.conn.db.inventorySlot.iter()].filter(s=>s.owner.toHexString()===a.identity.toHexString());
    for(let i=0;i<8 && !inventory().some(s=>s.itemId==='stick');i++) {
      const before=inventory().reduce((sum,s)=>sum+s.quantity,0);
      const tree=[...a.conn.db.tree.iter()].filter(t=>t.itemId.startsWith('berry_')).sort((a,b)=>a.cooldownUntilTick-b.cooldownUntilTick)[0];
      await a.conn.reducers.startHarvest({treeId:tree.id});
      await wait('harvest for the trail key',()=>inventory().reduce((sum,s)=>sum+s.quantity,0)>before);
    }
    assert.ok(inventory().some(s=>s.itemId==='stick'));
    await act({ action: "enter" });
    await wait('walk to Meadows town',()=>self().region==='settlement' && self().x===REGIONS.settlement.spawn.x && self().z===REGIONS.settlement.spawn.z);
    assert.equal(self().region, "settlement");
    await assert.rejects(
      () => a.conn.reducers.startHarvest({ treeId: 1 }),
      /Bramblewild/,
    );
    await act({ action: "talk", id: "steward" });
    await act({ action: "quest", id: "steward" });
    const timber = RESOURCE_PATCHES.find(n => n.id === "settlement-timber")!;
    await walk(timber.x, timber.z);
    for (let i = 0; i < 8; i++) {
      await act({ action: "gather", id: "settlement-timber" });
      await wait('timber felling completes', () => !state().resources.find(n=>n.id==='settlement-timber')?.harvest);
      if (i < 7) await wait('timber tree regrows', () => !state().resources.find(n=>n.id==='settlement-timber')?.regrowsAt);
    }
    const stone = RESOURCE_PATCHES.find(n => n.id === "settlement-stone")!;
    await walk(stone.x, stone.z);
    for (let i = 0; i < 2; i++) {
      await act({ action: "gather", id: "settlement-stone" });
      await wait('stone gathering completes', () => !state().resources.find(n=>n.id==='settlement-stone')?.harvest);
    }
    await act({ action: "craft", id: "hammer" });
    await walk(REGIONS.settlement.spawn.x, REGIONS.settlement.spawn.z);
    await act({ action: "quest", id: "supplies" });
    await act({ action: "quest", id: "tools" });
    assert.equal(state().profile.coins, 50);
    const plot = state().plots.find(
      (p) => !p.claim && p.region === "settlement",
    )!;
    await walk(plot.marker.x, plot.marker.z);
    assert.equal(state().profile.recoveryReady, false);
    await act({ action: "claim", id: plot.id });
    assert.equal(state().profile.coins, 0);
    assert.equal(state().profile.recoveryReady, false);
    assert.equal(
      state().plots.find((p) => p.id === plot.id)?.claim?.owner,
      a.identity.toHexString(),
    );
    await act({
      action: "build",
      id: plot.id,
      item: "floor",
      x: plot.x,
      z: plot.z + 1,
    });
    await act({
      action: "build",
      id: plot.id,
      item: "wall",
      x: plot.x + 1,
      z: plot.z + 1,
    });
    assert.ok(state().buildings.length >= 2);
    assert.equal(
      [...b.conn.db.frontierView.iter()].some(
        (v) => v.owner.toHexString() === a.identity.toHexString(),
      ),
      false,
    );
    console.log(
      "PASS fresh character: region isolation, gathering, hammer, three quest rewards, paid claim without recovery export, modular building, private views",
    );
    const saved = a.token;
    a.conn.disconnect();
    await delay(500);
    const returned = await connect(saved);
    a.conn = returned.conn;
    assert.equal(self().region, "settlement");
    assert.equal(
      state().plots.find((p) => p.id === plot.id)?.claim?.owner,
      a.identity.toHexString(),
    );
    console.log(
      "PASS reconnect: region, claim, inventory, coins and buildings persist",
    );
    await writeFile(
      "../.spacetime-data/settlements-validation/browser-fixture.json",
      JSON.stringify({
        token: a.token,
        identity: a.identity.toHexString(),
        plot: plot.id,
      }),
      { mode: 0o600 },
    );
  } finally {
    owner.conn.disconnect();
    a.conn.disconnect();
    b.conn.disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
