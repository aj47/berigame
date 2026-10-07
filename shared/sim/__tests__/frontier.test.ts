import { homePoint, homePath, HOME_JOIN, isHomeTarget, homeDestination } from "../frontier/homeMap";
import { regionLand } from "../frontier/regions";
import { enterRule } from '../areas';
import { describe, expect, it } from "vitest";
import {
  advance,
  damage,
  maxHealth,
  perform,
  seedCreatures,
  validateCommand,
  wildStep,
} from "../frontier/engine";
import { FRONTIER, DAY, PLOTS, PORTS, WEEK, RESOURCE_PATCHES, REGIONS, SPECIES } from "../frontier/catalog";
import { distance } from "../frontier/regions";
import {
  claimStatus,
  newProfile,
  questProgress,
  type Actor,
  type EntityMap,
  type Kind,
  type Repository,
  type World,
} from "../frontier/model";
import { regionalPath } from "../frontier/regions";
import { frontierSnapshot } from "../frontier/snapshot";
function harness() {
  let data: Record<string, any> = {};
  const repo: Repository = {
    get: (k, id) => structuredClone(data[`${k}:${id}`]),
    all: (k) =>
      Object.entries(data)
        .filter(([key]) => key.startsWith(k + ":"))
        .map(([, v]) => structuredClone(v)),
    put: (k, v) => {
      data[`${k}:${v.id}`] = structuredClone(v);
    },
    remove: (k, id) => {
      delete data[`${k}:${id}`];
    },
  };
  const actor = (id: string): Actor => ({
    id,
    region: "settlement",
    ...REGIONS.settlement.spawn,
    online: true,
    alive: true,
    hp: 30,
    weapon: "",
    combat: false,
    hostile: false,
    bag: Array(28).fill(null),
  });
  const a = actor("a"),
    b = actor("b");
  const w: World = { repo, actors: [a, b], now: 10 * DAY, save: () => {} };
  repo.put("config", { id: "world", enabled: true, pausedAt: 0, sequence: 0 });
  for (const a of w.actors) {
    const p = newProfile(a.id);
    p.coins = 1000;
    p.quests = ["steward", "supplies", "tools"];
    repo.put("profile", p);
  }
  const act = (c: unknown, who = a) => {
    const original = structuredClone(data),
      actors = structuredClone(w.actors);
    try {
      perform(w, who, c);
    } catch (e) {
      data = original;
      w.actors.forEach((a, i) => Object.assign(a, actors[i]));
      throw e;
    }
  };
  const atPlot = (who = a) =>
    Object.assign(who, { ...PLOTS[0], ...PLOTS[0].marker, id: who.id });
  const buy = () => {
    atPlot();
    act({ action: "claim", id: PLOTS[0].id });
  };
  const supplies = (
    who = a,
    items: Record<string, number> = { timber: 50, stone: 50, fibre: 50 },
  ) => {
    who.bag = Array(28).fill(null);
    Object.entries(items).forEach(
      ([itemId, quantity], i) => (who.bag[i] = { itemId, quantity }),
    );
  };
  return { repo, w, a, b, act, atPlot, buy, supplies };
}
describe("settlements ownership and transactions", () => {
  it("charges once, prevents duplicate ownership, and rolls back a rejected competing purchase", () => {
    const h = harness();
    h.buy();
    expect(h.repo.get("profile", "a")?.coins).toBe(950);
    h.atPlot(h.b);
    expect(() => h.act({ action: "claim", id: PLOTS[0].id }, h.b)).toThrow(
      "already",
    );
    expect(h.repo.get("profile", "b")?.coins).toBe(1000);
    Object.assign(h.a, PLOTS[1].marker);
    expect(() => h.act({ action: "claim", id: PLOTS[1].id })).toThrow(
      "already",
    );
  });
  it("buys land without an optional recovery export and still charges the deed and first week", () => {
    const h = harness();
    expect(h.repo.get("profile", "a")?.recoveryReady).toBe(false);
    h.buy();
    expect(h.repo.get("claim", PLOTS[0].id)?.owner).toBe("a");
    expect(h.repo.get("profile", "a")?.coins).toBe(950);
    expect(h.repo.get("profile", "a")?.recoveryReady).toBe(false);
  });
  it("still requires completed deed quests before buying land", () => {
    const h = harness();
    h.atPlot();
    h.repo.put("profile", {
      ...h.repo.get("profile", "a")!,
      quests: ["steward", "supplies"],
    });
    expect(() => h.act({ action: "claim", id: PLOTS[0].id })).toThrow(
      "Earn your deed",
    );
    expect(h.repo.get("profile", "a")?.coins).toBe(1000);
    expect(h.repo.get("claim", PLOTS[0].id)).toBeUndefined();
  });
  it("rolls back money if plot upgrade materials are missing", () => {
    const h = harness();
    h.buy();
    const before = h.repo.get("profile", "a")!.coins;
    expect(() => h.act({ action: "upgrade", id: PLOTS[0].id })).toThrow(
      "materials",
    );
    expect(h.repo.get("profile", "a")!.coins).toBe(before);
    expect(h.repo.get("claim", PLOTS[0].id)?.tier).toBe(0);
  });
  it("handles exact expiry and grace boundaries and bounds prepayment", () => {
    const h = harness();
    h.buy();
    const c = h.repo.get("claim", PLOTS[0].id)!;
    expect(claimStatus(c, c.paidUntil - 1)).toBe("protected");
    expect(claimStatus(c, c.paidUntil)).toBe("grace");
    expect(claimStatus(c, c.paidUntil + FRONTIER.grace)).toBe("vulnerable");
    expect(() => h.act({ action: "tax", id: c.id, quantity: 4 })).toThrow(
      "four weeks",
    );
    h.act({ action: "tax", id: c.id, quantity: 3 });
    expect(h.repo.get("claim", c.id)?.paidUntil).toBe(h.w.now + 4 * WEEK);
  });
  it("announces a challenge, refunds it when the owner cures tax, and preserves structures", () => {
    const h = harness();
    h.buy();
    h.supplies();
    h.act({ action: "build", id: PLOTS[0].id, item: "wall", x: 12, z: 9 });
    h.w.now += WEEK + FRONTIER.grace;
    h.atPlot(h.b);
    h.act({ action: "challenge", id: PLOTS[0].id }, h.b);
    expect(h.repo.get("profile", "b")?.coins).toBe(970);
    h.act({ action: "tax", id: PLOTS[0].id, quantity: 1 });
    expect(h.repo.get("profile", "b")?.coins).toBe(1000);
    expect(h.repo.get("claim", PLOTS[0].id)?.challenge).toBeUndefined();
    expect(h.repo.all("building")).toHaveLength(1);
  });
  it("requires deed quests for a challenge but makes recovery export optional", () => {
    const h = harness();
    h.buy();
    h.w.now += WEEK + FRONTIER.grace;
    h.atPlot(h.b);
    const challenger = h.repo.get("profile", "b")!;
    expect(challenger.recoveryReady).toBe(false);
    h.repo.put("profile", { ...challenger, quests: [] });
    expect(() => h.act({ action: "challenge", id: PLOTS[0].id }, h.b)).toThrow(
      "Earn your deed",
    );
    expect(h.repo.get("profile", "b")?.coins).toBe(1000);
    expect(h.repo.get("claim", PLOTS[0].id)?.challenge).toBeUndefined();
    h.repo.put("profile", challenger);
    h.act({ action: "challenge", id: PLOTS[0].id }, h.b);
    expect(h.repo.get("claim", PLOTS[0].id)?.challenge?.by).toBe("b");
    expect(h.repo.get("profile", "b")?.coins).toBe(970);
    expect(h.repo.get("profile", "b")?.recoveryReady).toBe(false);
  });
  it("requires the entire hold interval and transfers ordinary storage without transferring the vault", () => {
    const h = harness();
    h.buy();
    h.supplies();
    h.act({ action: "build", id: PLOTS[0].id, item: "chest", x: 12, z: 9 });
    const chest = h.repo.all("container")[0];
    chest.slots[0] = { itemId: "timber", quantity: 3 };
    h.repo.put("container", chest);
    h.repo.put("container", {
      id: "vault-a",
      owner: "a",
      slots: [{ itemId: "stone", quantity: 9 }, ...Array(5).fill(null)],
    });
    h.w.now += WEEK + FRONTIER.grace;
    h.atPlot(h.b);
    h.act({ action: "challenge", id: PLOTS[0].id }, h.b);
    const contest = h.repo.get("claim", PLOTS[0].id)!.challenge!;
    h.a.online = false;
    h.w.now = contest.opens;
    advance(h.w);
    for (let i = 0; i < 199; i++) {
      h.w.now += 600;
      advance(h.w);
    }
    h.w.now += 599;
    advance(h.w);
    expect(h.repo.get("claim", PLOTS[0].id)?.owner).toBe("a");
    h.w.now++;
    advance(h.w);
    expect(h.repo.get("claim", PLOTS[0].id)?.owner).toBe("b");
    expect(h.repo.get("container", chest.id)?.owner).toBe("b");
    expect(h.repo.get("container", "vault-a")?.owner).toBe("a");
    advance(h.w);
    expect(h.repo.get("claim", PLOTS[0].id)?.paidUntil).toBe(h.w.now + WEEK);
  });
  it("interrupts capture when a registered defender reaches the marker", () => {
    const h = harness();
    h.buy();
    h.w.now += WEEK + FRONTIER.grace;
    h.atPlot(h.b);
    h.act({ action: "challenge", id: PLOTS[0].id }, h.b);
    h.act({ action: "join_contest", id: PLOTS[0].id, target: "defend" });
    h.w.now += DAY;
    advance(h.w);
    expect(h.repo.get("claim", PLOTS[0].id)?.challenge?.heldSince).toBe(0);
  });
});
describe("construction, quests and progression", () => {
  it("rejects construction outside the parcel and duplicate furniture while leaving wall interiors usable", () => {
    const h = harness();
    h.buy();
    h.supplies();
    expect(() =>
      h.act({ action: "build", id: PLOTS[0].id, item: "wall", x: 20, z: 8 }),
    ).toThrow("Outside");
    h.act({ action: "build", id: PLOTS[0].id, item: "wall", x: 12, z: 9 });
    h.act({ action: "build", id: PLOTS[0].id, item: "chest", x: 12, z: 9 });
    expect(() =>
      h.act({ action: "build", id: PLOTS[0].id, item: "chest", x: 12, z: 9 }),
    ).toThrow("occupied");
  });
  it("rejects a last wall that traps a visitor", () => {
    const h = harness();
    h.buy();
    h.supplies();
    Object.assign(h.b, { x: 14, z: 10 });
    for (const rotation of [1, 2, 3])
      h.act({ action: "build", id: PLOTS[0].id, item: "wall", x: 14, z: 10, rotation });
    expect(() =>
      h.act({ action: "build", id: PLOTS[0].id, item: "wall", x: 14, z: 10, rotation: 0 }),
    ).toThrow("trap");
  });
  it("builds a floor, several distinct sides, and a roof on one tile to complete the shelter quest", () => {
    const h = harness(); h.buy(); h.supplies();
    for (const item of ['floor', 'wall', 'roof']) h.act({ action: 'build', id: PLOTS[0].id, item, x: 12, z: 9 });
    h.act({ action: 'build', id: PLOTS[0].id, item: 'door', x: 12, z: 9, rotation: 1 });
    expect(h.repo.all('building')).toHaveLength(4);
    expect(h.repo.all('building').find(b => b.piece === 'wall')).toMatchObject({ edge: true, rotation: 0 });
    expect(h.repo.get('profile', 'a')?.events.shelter).toBeGreaterThanOrEqual(1);
    expect(() => h.act({ action: 'build', id: PLOTS[0].id, item: 'window', x: 12, z: 10, rotation: 2 })).toThrow('occupied');
    // The south wall leaves the floor reachable from its other sides.
    expect(() => h.act({ action: 'move', x: 12, z: 9 })).not.toThrow();
  });
  it("rotates placed furniture in place and lays a rug beneath it", () => {
    const h = harness(); h.buy(); h.supplies();
    h.act({ action: 'build', id: PLOTS[0].id, item: 'floor', x: 13, z: 10 });
    h.act({ action: 'build', id: PLOTS[0].id, item: 'rug', x: 13, z: 10 });
    h.act({ action: 'build', id: PLOTS[0].id, item: 'chair', x: 13, z: 10, rotation: 1 });
    expect(() => h.act({ action: 'build', id: PLOTS[0].id, item: 'stool', x: 13, z: 10 })).toThrow('occupied');
    const chair = h.repo.all('building').find(b => b.piece === 'chair')!;
    for (const rotation of [2, 3, 0]) {
      h.act({ action: 'move_building', id: chair.id, x: 13, z: 10, rotation });
      expect(h.repo.get('building', chair.id)).toMatchObject({ x: 13, z: 10, rotation, edge: false });
    }
    expect(h.repo.all('building')).toHaveLength(3);
  });
  it("preserves centered saved walls and moves them explicitly onto a selected side", () => {
    const h = harness(); h.buy(); h.supplies();
    const legacy = { id: 'old-wall', claim: PLOTS[0].id, region: 'settlement' as const, x: 12, z: 9, piece: 'wall', rotation: 0, label: '' };
    h.repo.put('building', legacy);
    expect(() => h.act({ action: 'move', x: 12, z: 9 })).toThrow();
    h.act({ action: 'build', id: PLOTS[0].id, item: 'roof', x: 12, z: 9 });
    expect(h.repo.get('building', legacy.id)).toEqual(legacy);
    h.act({ action: 'move_building', id: legacy.id, x: 12, z: 9, rotation: 2 });
    expect(h.repo.get('building', legacy.id)).toMatchObject({ edge: true, rotation: 2 });
    expect(() => h.act({ action: 'move', x: 12, z: 9 })).not.toThrow();
  });
  it('keeps an edge doorway private for outside visitors, lets helpers enter, and always lets occupants leave', () => {
    const h = harness(); h.buy(); h.supplies();
    for (const rotation of [0, 1, 2]) h.act({ action: 'build', id: PLOTS[0].id, item: 'wall', x: 12, z: 9, rotation });
    h.act({ action: 'build', id: PLOTS[0].id, item: 'door', x: 12, z: 9, rotation: 3 });
    Object.assign(h.b, { x: 11, z: 9 });
    expect(() => h.act({ action: 'move', x: 12, z: 9 }, h.b)).toThrow('No walkable route');
    expect(() => h.act({ action: 'move', x: 12, z: 9 })).not.toThrow();
    const land = h.repo.get('claim', PLOTS[0].id)!;
    h.repo.put('claim', { ...land, permissions: { b: 1 } });
    h.act({ action: 'move', x: 12, z: 9 }, h.b);
    advance(h.w);
    expect({ x: h.b.x, z: h.b.z }).toEqual({ x: 12, z: 9 });
    h.repo.put('claim', { ...land, permissions: {} });
    h.act({ action: 'move', x: 11, z: 9 }, h.b);
    h.w.now += 600; advance(h.w);
    expect({ x: h.b.x, z: h.b.z }).toEqual({ x: 11, z: 9 });
  });
  it("requires storage permissions, preserves a full bag, and rejects dismantling nonempty chests", () => {
    const h = harness();
    h.buy();
    h.supplies();
    h.act({ action: "build", id: PLOTS[0].id, item: "chest", x: 12, z: 9 });
    const c = h.repo.all("container")[0];
    h.act({
      action: "container",
      id: c.id,
      item: "timber",
      quantity: 3,
      target: "deposit",
    });
    h.atPlot(h.b);
    expect(() =>
      h.act(
        {
          action: "container",
          id: c.id,
          item: "timber",
          quantity: 1,
          target: "withdraw",
        },
        h.b,
      ),
    ).toThrow("permission");
    h.act({ action: "permit", id: PLOTS[0].id, target: "b", permissions: 2 });
    h.b.bag = Array.from({ length: 28 }, () => ({
      itemId: "stone",
      quantity: 99,
    }));
    expect(() =>
      h.act(
        {
          action: "container",
          id: c.id,
          item: "timber",
          quantity: 1,
          target: "withdraw",
        },
        h.b,
      ),
    ).toThrow("room");
    expect(h.repo.get("container", c.id)?.slots[0]?.quantity).toBe(3);
    expect(() => h.act({ action: "dismantle", id: c.id })).toThrow("Empty");
  });
  it("requires authoritative quest progress and prevents duplicate rewards", () => {
    const h = harness();
    const p = newProfile("a");
    h.repo.put("profile", p);
    expect(() => h.act({ action: "quest", id: "steward" })).toThrow(
      "objective",
    );
    h.act({ action: "talk", id: "steward" });
    h.act({ action: "quest", id: "steward" });
    expect(h.repo.get("profile", "a")?.coins).toBe(10);
    expect(() => h.act({ action: "quest", id: "steward" })).toThrow();
  });
  it("caps repeatable coin issuance across orders and resets at UTC midnight", () => {
    const h = harness();
    h.supplies(h.a, { timber: 99 });
    for (let i = 0; i < 6; i++) h.act({ action: "order", id: "timber" });
    expect(() => h.act({ action: "order", id: "timber" })).toThrow("allowance");
    h.w.now += DAY;
    h.act({ action: "order", id: "timber" });
    expect(h.repo.get("profile", "a")?.repeatCoins).toBe(10);
  });
  it("retains learned XP while switching only two disciplines with a cooldown", () => {
    const h = harness();
    h.act({ action: "specialize", disciplines: [0, 2] });
    expect(() => h.act({ action: "specialize", disciplines: [1, 3] })).toThrow(
      "24 hours",
    );
    h.w.now += DAY;
    h.act({ action: "specialize", disciplines: [1, 3] });
    expect(h.repo.get("profile", "a")?.active).toEqual([1, 3]);
    expect(h.repo.get("profile", "a")?.coins).toBe(980);
    expect(() => h.act({ action: "specialize", disciplines: [1, 1] })).toThrow(
      "different",
    );
  });
  it("rejects unknown and malformed commands before applying them", () => {
    expect(() => validateCommand({ action: "tax", quantity: NaN })).toThrow();
    expect(() => validateCommand({ action: "claim", coins: 999 })).toThrow(
      "Unknown",
    );
    expect(() => validateCommand({ action: "admin" })).toThrow("Unknown");
  });
  it("scopes movement and interactions to the region", () => {
    const h = harness();
    h.a.region = "reedwake";
    h.a.x = 113;
    h.a.z = 12;
    expect(() => h.act({ action: "gather", id: "settlement-timber" })).toThrow(
      "beside",
    );
    const path = regionalPath(
      "reedwake",
      { x: 5, z: 64 },
      { x: 113, z: 12 },
      () => false,
    );
    expect(path?.at(-1)).toEqual({ x: 113, z: 12 });
    expect(
      regionalPath("reedwake", { x: 5, z: 64 }, { x: 128, z: 12 }, () => false),
    ).toBeNull();
  });
});

describe("timed frontier gathering", () => {
  const timber = RESOURCE_PATCHES.find(n => n.id === 'settlement-timber')!;
  const begin = () => {
    const h = harness();
    Object.assign(h.a, { x: timber.x - 1, z: timber.z });
    h.act({ action:'gather',id:timber.id });
    return h;
  };
  it("awards timber only after chopping, exposes the reservation, then regrows the stump", () => {
    const h = begin(), start = h.w.now;
    expect(h.a.bag.every(slot => slot === null)).toBe(true);
    expect(h.repo.get('profile','a')?.events['gather:timber']).toBeUndefined();
    expect(h.repo.get('resource',timber.id)?.harvest).toMatchObject({by:'a',startedAt:start,completesAt:start+3000});
    h.w.now += 2999;
    advance(h.w);
    expect(h.a.bag.every(slot => slot === null)).toBe(true);
    h.w.now++;
    advance(h.w);
    expect(h.a.bag[0]).toEqual({itemId:'timber',quantity:1});
    expect(h.repo.get('resource',timber.id)).toMatchObject({felledAt:h.w.now,regrowsAt:h.w.now+12000});
    expect(h.repo.get('resource',timber.id)?.harvest).toBeUndefined();
    expect(h.repo.get('profile','a')?.events['gather:timber']).toBe(1);
    advance(h.w);
    expect(h.a.bag[0]?.quantity).toBe(1);
    expect(() => h.act({action:'gather',id:timber.id})).toThrow('regrowing');
    h.w.now += 12000;
    advance(h.w);
    expect(h.repo.get('resource',timber.id)?.regrowsAt).toBeUndefined();
    h.act({action:'gather',id:timber.id});
    expect(h.repo.get('resource',timber.id)?.harvest?.by).toBe('a');
  });
  it("reserves one tree for one player and preserves the first harvest on competing clicks", () => {
    const h = begin();
    Object.assign(h.b,{x:timber.x+1,z:timber.z});
    expect(() => h.act({action:'gather',id:timber.id},h.b)).toThrow('Someone');
    expect(() => h.act({action:'gather',id:timber.id})).toThrow('Already');
    expect(h.repo.get('resource',timber.id)?.harvest?.by).toBe('a');
    h.w.now += 3000;
    advance(h.w);
    expect(h.a.bag[0]?.quantity).toBe(1);
    expect(h.b.bag.every(slot => slot === null)).toBe(true);
  });
  it.each(['move','stop','disconnect','death','damage','input'])("cancels safely on %s without items or a felled tree", reason => {
    const h = begin();
    if (reason === 'move') h.act({action:'move',x:timber.x-2,z:timber.z});
    if (reason === 'stop') h.act({action:'stop'});
    if (reason === 'disconnect') h.a.online = false;
    if (reason === 'death') h.a.alive = false;
    if (reason === 'damage') h.a.hp--;
    if (reason === 'input') h.a.inputStamp = 'new-action';
    h.w.now += 3000;
    advance(h.w);
    expect(h.a.bag.every(slot => slot === null)).toBe(true);
    expect(h.repo.get('resource',timber.id)?.harvest).toBeUndefined();
    expect(h.repo.get('resource',timber.id)?.felledAt).toBeUndefined();
  });
  it("advances timber quests by the doubled axe yield and keeps ordinary gathering timed", () => {
    const h = harness();
    h.repo.put('profile', { ...newProfile('a'), quests:['steward'], events:{'gather:timber':3} });
    h.supplies(h.a,{axe:1});
    Object.assign(h.a,{x:timber.x-1,z:timber.z});
    h.act({action:'gather',id:timber.id});
    expect(h.repo.get('resource',timber.id)?.harvest).toMatchObject({tool:'axe',quantity:2});
    h.w.now += 3000;
    advance(h.w);
    expect(h.a.bag.find(slot => slot?.itemId === 'timber')?.quantity).toBe(2);
    expect(questProgress(h.repo.get('profile','a')!).find(q=>q.id==='supplies')?.progress).toBe(5);
    const stone = RESOURCE_PATCHES.find(n => n.id === 'settlement-stone')!;
    Object.assign(h.a,{x:stone.x-1,z:stone.z});
    h.act({action:'gather',id:stone.id});
    expect(h.a.bag.some(slot => slot?.itemId === 'stone')).toBe(false);
    h.w.now += 3000;
    advance(h.w);
    expect(h.a.bag.find(slot => slot?.itemId === 'stone')?.quantity).toBe(1);
    expect(h.repo.get('resource',stone.id)?.regrowsAt).toBeUndefined();
  });
  it("lets two newcomers cut different trees at the same time with starter hatchets", () => {
    const h = harness(), other = RESOURCE_PATCHES.find(n => n.id === 'settlement-timber-2')!;
    Object.assign(h.a,{x:timber.x-1,z:timber.z});
    Object.assign(h.b,{x:other.x-1,z:other.z});
    h.act({action:'gather',id:timber.id});
    h.act({action:'gather',id:other.id},h.b);
    expect(h.repo.get('resource',timber.id)?.harvest).toMatchObject({by:'a',tool:'hatchet',quantity:1});
    expect(h.repo.get('resource',other.id)?.harvest).toMatchObject({by:'b',tool:'hatchet',quantity:1});
    h.w.now += FRONTIER.gatherDuration;
    advance(h.w);
    for (const actor of [h.a,h.b]) expect(actor.bag[0]).toEqual({itemId:'timber',quantity:1});
    for (const node of [timber,other]) expect(h.repo.get('resource',node.id)?.regrowsAt).toBe(h.w.now+FRONTIER.timberRegrow);
  });
  it("checks inventory capacity again at completion without losing a resource or partially awarding", () => {
    const h = begin();
    h.a.bag = Array.from({length:28},()=>({itemId:'axe',quantity:1}));
    h.w.now += 3000;
    advance(h.w);
    expect(h.a.bag.every(slot => slot?.itemId === 'axe')).toBe(true);
    expect(h.repo.get('resource',timber.id)?.felledAt).toBeUndefined();
    expect(h.repo.get('resource',timber.id)?.harvest).toBeUndefined();
    expect(h.repo.get('profile','a')?.events['gather:timber']).toBeUndefined();
    expect(h.repo.get('profile','a')?.notes.at(-1)).toContain('bag is full');
  });
});
describe("creatures and a complete crewed crossing", () => {
  it("requires observation, food and time to tame; ownership survives resting", () => {
    const h = harness();
    seedCreatures(h.w);
    const c = h.repo.all("creature").find((c) => c.species === "burrowbun")!;
    Object.assign(h.a, { region: c.region, x: c.x, z: c.z });
    h.supplies(h.a, { taming_feed: 2 });
    expect(() => h.act({ action: "tame", id: c.id })).toThrow("Observe");
    h.act({ action: "observe", id: c.id });
    h.act({ action: "tame", id: c.id });
    expect(() => h.act({ action: "tame", id: c.id })).toThrow("time");
    h.w.now += 6000;
    h.act({ action: "tame", id: c.id });
    expect(h.repo.get("creature", c.id)?.owner).toBe("a");
  });
  it("seeds three of every species at home, on land and off every plot", () => {
    const h = harness();
    seedCreatures(h.w);
    const inPlot = (c: { region: string; x: number; z: number }) => PLOTS.some(p => p.region === c.region
      && c.x >= p.x - 1 && c.x < p.x + 16 && c.z >= p.z - 1 && c.z < p.z + 16);
    expect(SPECIES.filter(s => s.tameable).length).toBeGreaterThanOrEqual(10);
    for (const species of SPECIES) {
      const wild = h.repo.all("creature").filter(c => c.species === species.id);
      expect(wild, species.id).toHaveLength(3);
      for (const c of wild) {
        expect(regionLand(c.region as any, c), species.id).toBe(true);
        expect(inPlot(c), species.id).toBe(false);
        expect(distance(c, species.home)).toBeLessThanOrEqual(species.roam);
      }
    }
  });
  it("brings stray wild creatures home and wanders without leaving land or entering plots", () => {
    const h = harness();
    seedCreatures(h.w);
    const bun = h.repo.all("creature").find(c => c.species === "burrowbun")!;
    h.repo.put("creature", { ...bun, x: 115, z: 100 });
    seedCreatures(h.w);
    const home = SPECIES.find(s => s.id === "burrowbun")!;
    expect(distance(h.repo.get("creature", bun.id)!, home.home)).toBeLessThanOrEqual(home.roam);
    for (const species of SPECIES) {
      let c = { ...h.repo.all("creature").find(n => n.species === species.id)! };
      for (let t = 0; t < 400; t++) {
        const next = wildStep(c, h.w.now + t * 3000);
        if (next) c = { ...c, ...next };
        expect(regionLand(c.region as any, c), species.id).toBe(true);
        expect(PLOTS.some(p => p.region === c.region && c.x >= p.x - 1 && c.x < p.x + 16 && c.z >= p.z - 1 && c.z < p.z + 16)).toBe(false);
        expect(distance(c, species.home), species.id).toBeLessThanOrEqual(species.roam);
      }
    }
  });
  it("lets an active companion keep pace with its owner and helps with each new ability", () => {
    const h = harness();
    seedCreatures(h.w);
    const c = h.repo.all("creature").find((c) => c.species === "thistlefox")!;
    Object.assign(h.a, { region: c.region, x: c.x, z: c.z });
    h.supplies(h.a, { taming_feed: 2, harness: 1 });
    h.act({ action: "observe", id: c.id });
    h.act({ action: "tame", id: c.id });
    h.w.now += 6000;
    h.act({ action: "tame", id: c.id });
    const p = h.repo.get("profile", "a")!;
    p.xp[3] = 1000; p.active = [3];
    h.repo.put("profile", p);
    h.act({ action: "train", id: c.id });
    h.w.now += 6000;
    h.act({ action: "ability" });
    expect(h.a.bag.some(s => s?.itemId?.startsWith("berry_"))).toBe(true);
    // Walk away three tiles per tick; the fox stays at heel instead of trailing a tile every three seconds.
    for (let i = 0; i < 4; i++) {
      h.a.x -= 3;
      h.w.now += 600;
      advance(h.w);
      expect(distance(h.repo.get("creature", c.id)!, h.a)).toBeLessThanOrEqual(3);
    }
  });
  it("boards a passenger, navigates, docks and moves all crew with cargo intact", () => {
    const h = harness();
    Object.assign(h.a, PORTS[0]);
    h.a.region = "bramblewild";
    h.supplies(h.a, { skiff_hull: 1, sail: 1, timber: 5 });
    h.act({ action: "boat" });
    const boat = h.repo.all("boat")[0];
    h.act({
      action: "container",
      id: boat.id,
      item: "timber",
      quantity: 5,
      target: "deposit",
    });
    h.act({ action: "board", id: boat.id });
    h.act({ action: "pilot" });
    Object.assign(h.b, { region: "bramblewild", x: 46, z: 29 });
    expect(() => h.act({ action: "board", id: boat.id }, h.b)).toThrow(
      "permission",
    );
    h.act({ action: "boat_permit", id: boat.id, target: "b", permissions: 3 });
    h.act({ action: "board", id: boat.id }, h.b);
    h.act({ action: "sail", ...PORTS[1].sea });
    for (let i = 0; i < 220; i++) {
      h.w.now += 600;
      advance(h.w);
    }
    h.act({ action: "dock", id: "reedwake" });
    expect(h.a.region).toBe("reedwake");
    expect(h.b.region).toBe("reedwake");
    expect(h.repo.get("container", boat.id)?.slots[0]?.quantity).toBe(5);
    expect(h.repo.get("profile", "b")?.discoveries).toContain("reedwake");
  });
  it("stops without its pilot and returns an empty boat after five minutes", () => {
    const h = harness();
    Object.assign(h.a, { region: "bramblewild", x: 46, z: 29 });
    h.supplies(h.a, { skiff_hull: 1, sail: 1 });
    h.act({ action: "boat" });
    const boat = h.repo.all("boat")[0];
    h.act({ action: "board", id: boat.id });
    h.act({ action: "pilot" });
    h.act({ action: "sail", ...PORTS[1].sea });
    h.a.online = false;
    advance(h.w);
    const at = h.repo.get("boat", boat.id)!;
    h.w.now += 299999;
    advance(h.w);
    expect(h.repo.get("boat", boat.id)?.x).toBe(at.x);
    h.w.now++;
    advance(h.w);
    expect(h.repo.get("boat", boat.id)?.region).toBe("bramblewild");
    expect(h.a.region).toBe("bramblewild");
  });
});

describe("frontier combat bounds and recovery", () => {
  it("caps progression and equipment without losing fractional damage across swings", () => {
    const h = harness(),
      p = h.repo.get("profile", h.a.id)!;
    p.active = [0, 2];
    p.xp[0] = 1000;
    p.events.vest = 1;
    h.supplies(h.a, { iron_club: 1, padded_vest: 1 });
    h.a.weapon = "iron_club";
    expect(maxHealth(p, h.a)).toBe(36);
    const swings = Array.from({ length: 10 }, () => damage(p, h.a));
    expect(swings.reduce((a, b) => a + b, 0)).toBe(99);
    expect(Math.max(...swings)).toBeLessThanOrEqual(10);
    p.active = [2, 4];
    expect(maxHealth(p, h.a)).toBe(33);
    expect(damage(p, h.a)).toBe(9);
  });
  it("drops supplies on defeat, waits five ticks, and keeps the wallet and personal vault", () => {
    const h = harness();
    Object.assign(h.a, { x: 110, z: 100, region: "cinder", hp: 1 });
    h.supplies(h.a, { timber: 3 });
    h.repo.put("container", {
      id: "vault-a",
      owner: "a",
      slots: [{ itemId: "iron_ore", quantity: 2 }],
    });
    h.repo.put("creature", {
      id: "hostile",
      species: "bristleback",
      owner: "",
      active: false,
      trained: false,
      region: "cinder",
      x: 111,
      z: 100,
      hp: 30,
      nextMove: h.w.now + 10000,
      restUntil: 0,
    });
    h.act({ action: "attack", id: "hostile" });
    expect(h.a.alive).toBe(false);
    expect(h.a.hp).toBe(0);
    expect(h.a.bag.every((x) => x === null)).toBe(true);
    expect(
      h.repo.all("drop")[0].slots.some((s) => s?.itemId === "timber"),
    ).toBe(true);
    expect(h.repo.get("profile", "a")?.coins).toBe(1000);
    expect(h.repo.get("container", "vault-a")?.slots[0]?.quantity).toBe(2);
    h.w.now += 2999;
    advance(h.w);
    expect(h.a.alive).toBe(false);
    h.w.now++;
    advance(h.w);
    expect(h.a.alive).toBe(true);
    expect(h.a.region).toBe("cinder");
    expect(h.a.hp).toBe(30);
  });
});


it('keeps gathering routes reachable and outside every fully expanded plot', () => {
  const plots = PLOTS.filter(p => p.region === 'settlement');
  for (const node of RESOURCE_PATCHES.filter(p => p.region === 'settlement')) {
    const inPlot = (point: {x:number;z:number}) => plots.some(p => point.x >= p.x && point.x < p.x + 16 && point.z >= p.z && point.z < p.z + 16);
    expect(inPlot(node)).toBe(false);
    const route = regionalPath('settlement', REGIONS.settlement.spawn, node, inPlot);
    expect(route).not.toBeNull();
    // The starter grove sits by the steward; wild patches only need a route.
    if (!node.id.startsWith('settlement-wild-')) expect(route!.length).toBeLessThanOrEqual(node.id.startsWith('settlement-timber-') ? 32 : 16);
  }
});

it('adds six catalog-backed timber trees to saved worlds without resetting claims or stumps', () => {
  const h = harness(); h.buy();
  const savedClaim = h.repo.get('claim',PLOTS[0].id)!;
  const tree = RESOURCE_PATCHES.find(n => n.id === 'settlement-timber')!;
  const stump = {...tree,felledAt:h.w.now-1000,regrowsAt:h.w.now+11000};
  h.repo.put('resource',stump);
  const state = frontierSnapshot([
    {kind:'claim',data:JSON.stringify(savedClaim)},
    {kind:'resource',data:JSON.stringify(stump)},
  ],[],h.a.id,h.w.now);
  const trees = state.resources.filter(n=>n.region==='settlement' && n.item==='timber' && !n.id.startsWith('settlement-wild-'));
  expect(trees).toHaveLength(6);
  expect(trees.find(n=>n.id===tree.id)).toEqual(stump);
  expect(trees.filter(n=>n.id!==tree.id).every(n=>!n.harvest && !n.regrowsAt)).toBe(true);
  expect(state.plots.find(p=>p.id===savedClaim.id)?.claim).toEqual(savedClaim);
  const added = trees.find(n=>n.id==='settlement-timber-2')!;
  Object.assign(h.a,{x:added.x-1,z:added.z});
  h.act({action:'gather',id:added.id});
  expect(h.repo.get('resource',added.id)?.harvest?.by).toBe(h.a.id);
  expect(h.repo.get('resource',tree.id)).toEqual(stump);
  expect(h.repo.get('claim',savedClaim.id)).toEqual(savedClaim);
});

it('introduces creatures after shelter and preserves earlier upkeep and quest completions', () => {
  const h = harness(), p = {...newProfile('a'),quests:['steward','supplies','tools','deed','shelter'],events:{observe:1}};
  h.repo.put('profile',p);
  expect(questProgress(p).find(q=>q.id==='observe')?.available).toBe(true);
  expect(questProgress(p).find(q=>q.id==='upkeep')?.available).toBe(false);
  h.act({action:'quest',id:'observe'});
  expect(h.repo.get('profile','a')?.coins).toBe(10);
  const returning = {...p,quests:[...p.quests,'upkeep']};
  expect(questProgress(returning).find(q=>q.id==='upkeep')?.complete).toBe(true);
  expect(questProgress(returning).find(q=>q.id==='observe')?.available).toBe(true);
});

describe("connected home island", () => {
  it("joins adjacent dry tiles and keeps every existing parcel buildable", () => {
    const west=homePoint(HOME_JOIN.bramblewild, 'bramblewild'), east=homePoint(HOME_JOIN.settlement, 'settlement');
    expect(east).toEqual({x:west.x+1,z:west.z});
    expect(homePath(west,east)).toEqual([east]);
    for(const p of PLOTS.filter(p=>p.region==='settlement')) {
      for(let x=p.x;x<p.x+16;x++)for(let z=p.z;z<p.z+16;z++) expect(regionLand('settlement',{x,z})).toBe(true);
      expect(homePath(homePoint(REGIONS.settlement.spawn,'settlement'),homePoint(p.marker,'settlement'))).not.toBeNull();
    }
  });
  it("walks from the harbour into the Meadows at three tiles per tick without relocating claims", () => {
    const h=harness();h.buy();const savedClaims=h.repo.all('claim');
    Object.assign(h.a,{region:'bramblewild',x:46,z:25});
    h.act({action:'enter'});
    expect(h.a.region).toBe('bramblewild');expect(h.a.x).toBe(46);
    expect(isHomeTarget(h.a.target)).toBe(true);
    let previous=homePoint(h.a,h.a.region), crossed=false;
    for(let i=0;i<80 && h.a.target;i++) {
      h.w.now+=600;advance(h.w);
      const next=homePoint(h.a,h.a.region);
      expect(Math.max(Math.abs(next.x-previous.x),Math.abs(next.z-previous.z))).toBeLessThanOrEqual(3);
      crossed ||= h.a.region==='settlement';previous=next;
    }
    expect(crossed).toBe(true);expect(h.a.target).toBeUndefined();
    expect({x:h.a.x,z:h.a.z}).toEqual(REGIONS.settlement.spawn);
    expect(h.repo.get('profile','a')!.events['visit:settlement']).toBeGreaterThan(0);
    expect(h.repo.all('claim')).toEqual(savedClaims);
  });
  it("walks back across the same seam and ordinary movement or stop replaces the route", () => {
    const h=harness();Object.assign(h.a,{region:'settlement',x:0,z:64});
    const west=HOME_JOIN.bramblewild.x-1;
    h.act({action:'walk',id:'bramblewild',x:west,z:25});advance(h.w);
    expect(h.a.region).toBe('bramblewild');expect(h.a.x).toBe(west);expect(h.a.target).toBeUndefined();
    h.act({action:'enter'});h.act({action:'stop'});advance(h.w);expect(h.a.x).toBe(west);
    Object.assign(h.a,{region:'settlement',...REGIONS.settlement.spawn});
    h.act({action:'return'});expect(homeDestination(h.a.target!)).toEqual({x:22,z:18});
    h.act({action:'move',x:31,z:65});advance(h.w);expect(h.a.region).toBe('settlement');expect(h.a.z).toBe(65);
  });
  it("still allows combat movement within the Meadows while preventing a combat escape across districts", () => {
    const h=harness();h.a.hostile=true;
    h.act({action:'walk',id:'settlement',x:31,z:65});advance(h.w);
    expect(h.a.z).toBe(65);expect(h.a.target).toBeUndefined();
    expect(()=>h.act({action:'return'})).toThrow('Finish your adventure or combat');
  });
  it("rechecks barriers and blocks invalid cross-district destinations", () => {
    const h=harness();Object.assign(h.a,{region:'bramblewild',...HOME_JOIN.bramblewild});
    h.w.homeStepRule=()=> (_from,to)=>to.region!=='settlement';
    expect(()=>h.act({action:'enter'})).toThrow('No walkable route');
    h.w.homeStepRule=()=>()=>true;h.act({action:'enter'});
    h.w.homeStepRule=()=> (_from,to)=>to.region!=='settlement';advance(h.w);
    expect(h.a.region).toBe('bramblewild');expect(h.a.target).toBeUndefined();
    expect(()=>h.act({action:'walk',id:'sea',x:5,z:64})).toThrow();
    // Open water between the Giant's headland and Eastreach.
    expect(()=>h.act({action:'walk',id:'bramblewild',x:70,z:50})).toThrow();
  });

  it('refuses a walk onto the sealed Spire floor at once, without routing', () => {
    const h = harness(); Object.assign(h.a, { region: 'bramblewild', x: 22, z: 18 });
    h.w.homeStepRule = () => () => true;
    for (const [x, z] of [[72, 57], [70, 55], [84, 69]]) {
      // Not 'No walkable route', which only comes after two full searches.
      expect(() => h.act({ action: 'walk', id: 'bramblewild', x, z })).toThrow('Choose dry ground');
    }
    expect(h.a.target).toBeUndefined();
  });

  it('names obstacles instead of a hedge when Meadows walls enclose the destination', () => {
    const h = harness();
    for (let rotation = 0; rotation < 4; rotation++) h.repo.put('building', {
      id: `wall-${rotation}`, claim: PLOTS[0].id, region: 'settlement', x: 35, z: 64, piece: 'wall', rotation, edge: true, label: '',
    });
    expect(() => h.act({ action: 'walk', id: 'settlement', x: 35, z: 64 })).toThrow('An obstacle or closed gate blocks the way');
    expect(h.a.target).toBeUndefined();
  });

  it('only suggests a sturdy stick when the missing key actually prevents the route', () => {
    const h = harness(); Object.assign(h.a, { region: 'bramblewild', x: 25, z: 25 });
    const rule = enterRule(false, false);
    h.w.homeStepRule = () => (from, to) => to.region !== 'bramblewild' || rule(from, to);
    expect(() => h.act({ action: 'enter' })).toThrow('sturdy stick');
  });

  it('names the stone club when a requested walk crosses the Boulders boundary', () => {
    const h = harness(); Object.assign(h.a, { region: 'bramblewild', x: 46, z: 44 });
    const rule = enterRule(true, false);
    h.w.homeStepRule = () => (from, to) => to.region !== 'bramblewild' || rule(from, to);
    expect(() => h.act({ action: 'walk', id: 'bramblewild', x: 55, z: 44 })).toThrow('stone club');
  });

  it('keeps combat and cargo movement slower while peaceful travel covers three valid steps', () => {
    const h = harness();
    for (const [hostile, budget, steps] of [[false, 3, 3], [true, 3, 2], [false, 1, 1]] as const) {
      Object.assign(h.a, { region: 'settlement', x: 31, z: 64, hostile });
      h.w.movementSteps = () => budget;
      h.act({ action: 'walk', id: 'settlement', x: 40, z: 64 });
      advance(h.w);
      expect(h.a.x).toBe(31 + steps);
    }
  });
});

it('moves skiffs each server tick, with a real two-step Exploration 10 bonus', () => {
  for (const skilled of [false, true]) {
    const h = harness(); Object.assign(h.a, { region: 'sea', x: 50, z: 50 });
    const p = h.repo.get('profile', h.a.id)!;
    if (skilled) { p.active = [4]; p.xp[4] = 2025; h.repo.put('profile', p); }
    h.repo.put('boat', { id: 'trip', owner: 'a', region: 'sea', x: 50, z: 50, lastPort: 'bramblewild', crew: ['a'], pilot: 'a', permissions: {}, emptySince: 0, target: { x: 60, z: 50 } });
    advance(h.w);
    expect(h.a.x).toBe(50 + (skilled ? 2 : 1));
    h.w.now += 599; advance(h.w);
    expect(h.a.x).toBe(50 + (skilled ? 2 : 1));
    h.w.now++; advance(h.w);
    expect(h.a.x).toBe(50 + (skilled ? 4 : 2));
  }
});
