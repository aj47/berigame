import { describe, expect, it } from "vitest";
import {
  advance,
  damage,
  maxHealth,
  perform,
  seedCreatures,
  validateCommand,
} from "../frontier/engine";
import { FRONTIER, DAY, PLOTS, PORTS, WEEK, RESOURCE_PATCHES, REGIONS } from "../frontier/catalog";
import {
  claimStatus,
  newProfile,
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
    p.recoveryReady = true;
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
  it("requires a recovery backup and completed deed quests", () => {
    const h = harness();
    h.atPlot();
    h.repo.put("profile", {
      ...h.repo.get("profile", "a")!,
      recoveryReady: false,
    });
    expect(() => h.act({ action: "claim", id: PLOTS[0].id })).toThrow(
      "recovery",
    );
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
  it("rejects construction outside the parcel and across occupied tiles", () => {
    const h = harness();
    h.buy();
    h.supplies();
    expect(() =>
      h.act({ action: "build", id: PLOTS[0].id, item: "wall", x: 20, z: 8 }),
    ).toThrow("Outside");
    h.act({ action: "build", id: PLOTS[0].id, item: "wall", x: 12, z: 9 });
    expect(() =>
      h.act({ action: "build", id: PLOTS[0].id, item: "chest", x: 12, z: 9 }),
    ).toThrow("occupied");
  });
  it("rejects a last wall that traps a visitor", () => {
    const h = harness();
    h.buy();
    h.supplies();
    Object.assign(h.b, { x: 14, z: 10 });
    for (const [x, z] of [
      [13, 10],
      [14, 9],
      [15, 10],
    ])
      h.act({ action: "build", id: PLOTS[0].id, item: "wall", x, z });
    expect(() =>
      h.act({ action: "build", id: PLOTS[0].id, item: "wall", x: 14, z: 11 }),
    ).toThrow("trap");
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


it('keeps starter gathering routes short and outside every fully expanded plot', () => {
  const plots = PLOTS.filter(p => p.region === 'settlement');
  for (const node of RESOURCE_PATCHES.filter(p => p.region === 'settlement')) {
    const inPlot = (point: {x:number;z:number}) => plots.some(p => point.x >= p.x && point.x < p.x + 16 && point.z >= p.z && point.z < p.z + 16);
    expect(inPlot(node)).toBe(false);
    const route = regionalPath('settlement', REGIONS.settlement.spawn, node, inPlot);
    expect(route).not.toBeNull();
    expect(route!.length).toBeLessThanOrEqual(16);
  }
});
