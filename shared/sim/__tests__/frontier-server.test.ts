import { homeTarget } from "../frontier/homeMap";
import { describe, expect, it, vi } from "vitest";
import { Identity } from "../../../spacetimedb/node_modules/spacetimedb/dist/index.mjs";
import { adventureTables, testTable } from "./adventureHarness";
import { newProfile } from "../frontier/model";
import { DAY, PLOTS, WEEK, RESOURCE_PATCHES } from "../frontier/catalog";
vi.mock(
  "../../../spacetimedb/node_modules/spacetimedb/dist/server/index.mjs",
  () => ({
    t: new Proxy({}, { get: () => () => ({}) }),
    SenderError: class SenderError extends Error {},
  }),
);
vi.mock("../../../spacetimedb/src/schema", () => ({
  default: { reducer: (...args: unknown[]) => args.at(-1) },
}));
import {
  configureFrontier,
  frontierRepository,
  projectFrontier,
  tickFrontier,
  frontierWorld,
} from "../../../spacetimedb/src/lib/frontier";
import {
  setTradeCoins,
  confirmTradeCoins,
} from "../../../spacetimedb/src/reducers/trade";
import { frontierAction } from "../../../spacetimedb/src/reducers/frontier";
import { clearInteractions } from "../../../spacetimedb/src/lib/players";

const id = (n: number) => Identity.fromString(n.toString(16).padStart(64, "0"));
function harness() {
  const db = {
    ...adventureTables(),
    player: testTable("identity"),
    inventorySlot: testTable("id", true),
    playerGrant: testTable("identity"),
    accessPolicy: testTable(),
    world: testTable(),
    trade: testTable("id", true),
    socialEvent: testTable("id", true),
    tree: testTable(),
  };
  db.accessPolicy.insert({ id: 0, owner: id(1), requireAdmission: false });
  db.world.insert({ id: 0, tick: 10 });
  const ctx: any = {
    db,
    sender: id(1),
    timestamp: { microsSinceUnixEpoch: BigInt(10 * DAY) * 1000n },
  };
  const player = (n: number) =>
    db.player.insert({
      identity: id(n),
      region: "settlement",
      online: true,
      state: 0,
      x: 5,
      z: 64,
      hp: 30,
      maxHp: 30,
      weapon: "",
      hostile: false,
      lastInputTick: 0,
      inputsThisTick: 0,
      harvestTreeId: 0,
      pending: 0,
      name: `Player ${n}`,
    });
  player(1);
  player(2);
  const repo = frontierRepository(ctx);
  repo.put("config", { id: "world", enabled: true, pausedAt: 0, sequence: 0 });
  for (const n of [1, 2])
    repo.put("profile", { ...newProfile(id(n).toHexString()), coins: 100 });
  projectFrontier(ctx, repo);
  return { ctx, db, repo, player };
}

describe("frontier database boundary", () => {
  it('keeps the authoritative movement budget at one for berry cargo and two in combat', () => {
    const h = harness(), world = frontierWorld(h.ctx), actor = world.actors[0];
    expect(world.movementSteps!(actor)).toBe(3);
    const profile = newProfile(actor.id), now = Number(h.ctx.timestamp.microsSinceUnixEpoch / 1000n);
    profile.events.hostileUntil = now + 60_000;
    h.repo.put('profile', profile);
    expect(world.movementSteps!(actor)).toBe(2);
    expect(world.canLeaveHomeDistrict!(actor)).toBe(false);
    h.repo.put('profile', { ...profile, events: {}, nextAttack: now + 2400 });
    expect(world.movementSteps!(actor)).toBe(2);
    h.repo.put('profile', newProfile(actor.id));
    h.db.player.identity.update({ ...h.db.player.identity.find(id(1)), combatTarget: id(2) });
    expect(world.movementSteps!(actor)).toBe(2);
    h.db.expeditionMember.insert({ identity: id(1), expeditionId: 1n });
    h.db.expedition.insert({ id: 1n, stage: 'hauling', carrier: id(1) });
    expect(world.movementSteps!(actor)).toBe(1);
    expect(world.canLeaveHomeDistrict!(actor)).toBe(false);
  });
  it("completes timed gathering against the live inventory and persists its shared stump", () => {
    const h = harness(), node = RESOURCE_PATCHES.find(n => n.id === 'settlement-timber')!;
    const player = h.db.player.identity.find(id(1));
    h.db.player.identity.update({...player,x:node.x-1,z:node.z});
    (frontierAction as any)(h.ctx,{command:JSON.stringify({action:'gather',id:node.id})});
    expect([...h.db.inventorySlot.iter()]).toHaveLength(0);
    expect(JSON.parse(h.db.frontierObject.key.find(`resource:${node.id}`).data).harvest.by).toBe(id(1).toHexString());
    h.db.inventorySlot.insert({id:0n,owner:id(1),slot:0,itemId:'stone',quantity:7});
    h.ctx.timestamp.microsSinceUnixEpoch += 3000000n;
    tickFrontier(h.ctx);
    expect([...h.db.inventorySlot.iter()]).toEqual(expect.arrayContaining([
      expect.objectContaining({itemId:'stone',quantity:7}),expect.objectContaining({itemId:'timber',quantity:1}),
    ]));
    const resource = JSON.parse(h.db.frontierObject.key.find(`resource:${node.id}`).data);
    expect(resource.harvest).toBeUndefined();
    expect(resource.regrowsAt - resource.felledAt).toBe(12000);
    tickFrontier(h.ctx);
    expect([...h.db.inventorySlot.iter()].find((s:any)=>s.itemId==='timber')?.quantity).toBe(1);
  });
  it("releases frontier reservations through the same cancellation used by movement and disconnect", () => {
    const h = harness(), node = RESOURCE_PATCHES.find(n => n.id === 'settlement-timber')!;
    const player = h.db.player.identity.find(id(1));
    h.db.player.identity.update({...player,x:node.x-1,z:node.z});
    (frontierAction as any)(h.ctx,{command:JSON.stringify({action:'gather',id:node.id})});
    clearInteractions(h.ctx,h.db.player.identity.find(id(1)));
    expect(JSON.parse(h.db.frontierObject.key.find(`resource:${node.id}`).data).harvest).toBeUndefined();
    h.ctx.timestamp.microsSinceUnixEpoch += 3000000n;
    tickFrontier(h.ctx);
    expect([...h.db.inventorySlot.iter()]).toHaveLength(0);
  });
  it("revokes projected chest access immediately and preserves the personal vault on capture", () => {
    const h = harness(),
      a = id(1).toHexString(),
      b = id(2).toHexString();
    h.repo.put("claim", {
      id: PLOTS[0].id,
      owner: a,
      tier: 0,
      permissions: { [b]: 2 },
      paidUntil: WEEK,
      cooldownUntil: 0,
    });
    h.repo.put("container", {
      id: "chest",
      owner: a,
      claim: PLOTS[0].id,
      slots: [{ itemId: "timber", quantity: 8 }],
    });
    h.repo.put("container", {
      id: `vault-${a}`,
      owner: a,
      slots: [{ itemId: "iron_ore", quantity: 2 }],
    });
    projectFrontier(h.ctx, h.repo);
    expect(h.db.frontierView.key.find(`${b}:container:chest`)).toBeTruthy();
    let r = frontierRepository(h.ctx);
    r.put("claim", { ...r.get("claim", PLOTS[0].id)!, permissions: {} });
    projectFrontier(h.ctx, r);
    expect(h.db.frontierView.key.find(`${b}:container:chest`)).toBeUndefined();
    r = frontierRepository(h.ctx);
    r.put("claim", { ...r.get("claim", PLOTS[0].id)!, owner: b });
    projectFrontier(h.ctx, r);
    expect(h.db.frontierView.key.find(`${a}:container:chest`)).toBeUndefined();
    expect(h.db.frontierView.key.find(`${b}:container:chest`)).toBeTruthy();
    expect(
      h.db.frontierView.key.find(`${a}:container:vault-${a}`),
    ).toBeTruthy();
    expect(
      h.db.frontierView.key.find(`${b}:container:vault-${a}`),
    ).toBeUndefined();
  });

  it("disabling cancels a home island walk still on the Bramblewild side", () => {
    const h=harness(), p=h.db.player.identity.find(id(1)), target=homeTarget({x:95,z:25});
    h.db.player.identity.update({...p, region:'bramblewild',x:46,z:25,targetX:target.x,targetZ:target.z});
    configureFrontier(h.ctx,false,true);
    const result=h.db.player.identity.find(id(1));
    expect(result.x).toBe(46);expect(result.z).toBe(25);expect(result.targetX).toBeUndefined();
  });

  it("disabling safely returns players and boats, freezes tax and resumes without consuming hold time", () => {
    const h = harness();
    h.repo.put("claim", {
      id: PLOTS[0].id,
      owner: id(1).toHexString(),
      tier: 0,
      permissions: {},
      paidUntil: 11 * DAY,
      cooldownUntil: 0,
    });
    h.repo.put("boat", {
      id: "skiff",
      owner: id(1).toHexString(),
      region: "sea",
      x: 50,
      z: 50,
      lastPort: "reedwake",
      crew: [id(1).toHexString()],
      pilot: id(1).toHexString(),
      permissions: {},
      emptySince: 0,
    });
    configureFrontier(h.ctx, false, false);
    expect(h.db.player.identity.find(id(1)).region).toBe("bramblewild");
    expect(frontierRepository(h.ctx).get("boat", "skiff")?.crew).toEqual([]);
    h.ctx.timestamp.microsSinceUnixEpoch += BigInt(2 * DAY) * 1000n;
    configureFrontier(h.ctx, true, false);
    expect(frontierRepository(h.ctx).get("claim", PLOTS[0].id)?.paidUntil).toBe(
      13 * DAY,
    );
  });

  it("coin trades bind confirmations to both displayed offers and conserve balances", () => {
    const h = harness();
    // In Meadows town no attack can land, so the swap runs at once.
    for (const n of [1, 2]) h.db.player.identity.update({ ...h.db.player.identity.find(id(n)), x: 31, z: 64 });
    const t = h.db.trade.insert({
      a: id(1),
      b: id(2),
      accepted: true,
      aOffer: "",
      bOffer: "",
      aCoins: 0,
      bCoins: 0,
      aConfirmed: false,
      bConfirmed: false,
    });
    (setTradeCoins as any)(h.ctx, { tradeId: t.id, coins: 40 });
    const confirm = (aCoins: number) =>
      (confirmTradeCoins as any)(h.ctx, {
        tradeId: t.id,
        aOffer: "",
        bOffer: "",
        aCoins,
        bCoins: 0,
      });
    expect(() => confirm(0)).toThrow();
    confirm(40);
    h.ctx.sender = id(2);
    confirm(40);
    const r = frontierRepository(h.ctx);
    expect(r.get("profile", id(1).toHexString())?.coins).toBe(60);
    expect(r.get("profile", id(2).toHexString())?.coins).toBe(140);
    expect(h.db.trade.id.find(t.id)).toBeUndefined();
  });

  it("away from town a confirmed coin trade waits for the tick instead of swapping at once", () => {
    const h = harness();
    const t = h.db.trade.insert({
      a: id(1), b: id(2), accepted: true, aOffer: "", bOffer: "", aCoins: 0, bCoins: 0, aConfirmed: false, bConfirmed: false,
    });
    (setTradeCoins as any)(h.ctx, { tradeId: t.id, coins: 40 });
    const confirm = () => (confirmTradeCoins as any)(h.ctx, { tradeId: t.id, aOffer: "", bOffer: "", aCoins: 40, bCoins: 0 });
    confirm();
    h.ctx.sender = id(2);
    confirm();
    const row = h.db.trade.id.find(t.id);
    expect(row).toMatchObject({ aConfirmed: true, bConfirmed: true, swapTick: 13, aHp: 30, bHp: 30 });
    const r = frontierRepository(h.ctx);
    expect(r.get("profile", id(1).toHexString())?.coins).toBe(100);
    // Confirming again does not restart the wait.
    confirm();
    expect(h.db.trade.id.find(t.id)?.swapTick).toBe(13);
  });

  it.runIf(process.env.FRONTIER_LOAD_CHECK === "1")("bounds simulation work with 32 active characters, 48 full plots and 8 moving boats", () => {
    const h = harness();
    for (let n = 3; n <= 48; n++) h.player(n);
    for (let i = 0; i < 48; i++) {
      const plot = PLOTS[i],
        owner = id(i + 1).toHexString();
      h.repo.put("claim", {
        id: plot.id,
        owner,
        tier: 2,
        permissions: {},
        paidUntil: 20 * DAY,
        cooldownUntil: 0,
      });
      for (let k = 0; k < 128; k++)
        h.repo.put("building", {
          id: `${i}-${k}`,
          claim: plot.id,
          region: plot.region,
          x: plot.x + (k % 16),
          z: plot.z + Math.floor(k / 16),
          piece: k % 3 === 0 ? "wall" : "floor",
          rotation: 0,
          label: "",
        });
      const p = h.db.player.identity.find(id(i + 1));
      h.db.player.identity.update({
        ...p,
        online: i < 32,
        region: plot.region,
        x: 5,
        z: 64,
        targetX: 113,
        targetZ: 112,
      });
    }
    for (let i = 0; i < 8; i++) {
      const owner = id(i + 1).toHexString(),
        p = h.db.player.identity.find(id(i + 1));
      h.db.player.identity.update({
        ...p,
        region: "sea",
        x: 8,
        z: 64,
        targetX: undefined,
        targetZ: undefined,
      });
      h.repo.put("boat", {
        id: `boat-${i}`,
        owner,
        region: "sea",
        x: 8,
        z: 64,
        lastPort: "bramblewild",
        permissions: {},
        crew: [owner],
        pilot: owner,
        emptySince: 0,
        target: { x: 100, z: 15 },
      });
    }
    const samples: number[] = [];
    for (let i = 0; i < 40; i++) {
      h.ctx.timestamp.microsSinceUnixEpoch += 600000n;
      const start = performance.now();
      tickFrontier(h.ctx);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    console.log(
      `Frontier reducer adapter load: 32 players, 6144 pieces, 8 boats; p95 ${p95.toFixed(1)} ms (in-memory database, not hosted server)`,
    );
    expect(p95).toBeLessThan(300);
  }, 30000);
});
