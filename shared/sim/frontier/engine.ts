import { homePoint, homePath, homeTarget, homeDestination, homeLocation, isHomeRegion, isHomeTarget } from "./homeMap";
import { addItem, countItem, removeFromSlot } from "../inventory";
import { getItemDef } from "../items";
import { facingFromDelta } from "../grid";
import { areaOf } from "../areas";
import { atGroveVault } from "../banking";
import { inSpireFloor } from "../bossZones";
import { TICK_MS } from "../constants";
import { levelForXp } from "../skills";
import { energyCost, energyScaled, newEnergy, spendEnergy } from "../energy";
import { buildingBlocker, buildingCollisionKeys, buildingsOverlap, isEdgeBuilding } from "./building";
import { regionalPvPProblem } from "./combat";
import { sameDisciplines, specializationSwitch } from './specialization';
import { ISLAND_SHRINES, shrineRestored, awardDisciplineXp } from './shrines';
import type { Slot } from "../types";
import {
  DAY,
  DISCIPLINES,
  FRONTIER,
  FRONTIER_RECIPES,
  ORDERS,
  PIECES,
  PLOTS,
  PORTS,
  QUESTS,
  REGIONS,
  RESOURCE_PATCHES,
  SPECIES,
  WEEK,
  type Cost,
  type Location,
  type Point,
  type RegionId,
} from "./catalog";
import {
  boatCanFloat,
  distance,
  near,
  regionalPath,
  regionLand,
  type PathBlocker,
} from "./regions";
import {
  can,
  claimStatus,
  newProfile,
  plotFor,
  questProgress,
  renewalPrice,
  utcDay,
  type Actor,
  type Boat,
  type Building,
  type Claim,
  type Container,
  type Creature,
  type Profile,
  type World,
} from "./model";
export class FrontierError extends Error {}
const check: (ok: unknown, message: string) => asserts ok = (ok, message) => {
  if (!ok) throw new FrontierError(message);
};
const integer = (n: unknown, min = 0, max = 127): number => {
  check(
    typeof n === "number" && Number.isInteger(n) && n >= min && n <= max,
    `Expected an integer from ${min} to ${max}`,
  );
  return n;
};
const str = (v: unknown): string => {
  check(
    typeof v === "string" && v.length <= 160,
    "Expected a short identifier",
  );
  return v;
};
export type Command = {
  action: string;
  id?: string;
  target?: string;
  item?: string;
  quantity?: number;
  x?: number;
  z?: number;
  rotation?: number;
  permissions?: number;
  disciplines?: number[];
  earlySwitch?: boolean;
  label?: string;
};
export const COMMANDS = [
  "enter",
  "return",
  "move",
  "walk",
  "stop",
  "talk",
  "quest",
  "order",
  "gather",
  "craft",
  "claim",
  "tax",
  "upgrade",
  "permit",
  "abandon",
  "challenge",
  "join_contest",
  "attack",
  "build",
  "move_building",
  "dismantle",
  "container",
  "specialize",
  "observe",
  "tame",
  "train",
  "companion",
  "ability",
  "plant",
  "harvest_crop",
  "boat",
  "boat_permit",
  "board",
  "pilot",
  "sail",
  "dock",
  "disembark",
  "eat",
  "equip",
  "pickup_bag",
  "invite_contest",
  "survey",
  "brace",
  "restore_shrine",
] as const;
export function validateCommand(value: unknown): Command {
  check(
    value && typeof value === "object" && !Array.isArray(value),
    "Expected an action object",
  );
  const c = value as Command;
  check(COMMANDS.includes(c.action as any), "Unknown frontier action");
  check(
    Object.keys(c).every((k) =>
      [
        "action",
        "id",
        "target",
        "item",
        "quantity",
        "x",
        "z",
        "rotation",
        "permissions",
        "disciplines",
        "earlySwitch",
        "label",
      ].includes(k),
    ),
    "Unknown action field",
  );
  for (const key of ["id", "target", "item", "label"] as const)
    if (c[key] !== undefined) str(c[key]);
  for (const key of ["quantity", "x", "z", "rotation", "permissions"] as const)
    if (c[key] !== undefined)
      integer(c[key], 0, key === "quantity" ? 999 : 127);
  if (c.disciplines !== undefined)
    check(
      Array.isArray(c.disciplines) &&
        c.disciplines.length === 2 &&
        new Set(c.disciplines).size === 2 &&
        c.disciplines.every((n) => Number.isInteger(n) && n >= 0 && n < 5),
      "Choose two different disciplines",
    );
  if (c.earlySwitch !== undefined)
    check(c.action === 'specialize' && typeof c.earlySwitch === 'boolean', 'Early switch must be true or false on a specialization action');
  return c;
}
function nextId(w: World, prefix: string) {
  const cfg = w.repo.get("config", "world")!;
  cfg.sequence++;
  w.repo.put("config", cfg);
  return `${prefix}-${cfg.sequence}`;
}
function profile(w: World, id: string) {
  return w.repo.get("profile", id) ?? newProfile(id);
}
function event(p: Profile, key: string, amount = 1) {
  p.events[key] = (p.events[key] ?? 0) + amount;
}
function xp(p: Profile, discipline: number, amount: number) {
  awardDisciplineXp(p, discipline, amount);
}
function money(w: World, p: Profile, delta: number, reason: string) {
  check(
    Number.isSafeInteger(delta) &&
      p.coins + delta >= 0 &&
      Number.isSafeInteger(p.coins + delta),
    "Not enough coins",
  );
  p.coins += delta;
  w.repo.put("ledger", {
    id: nextId(w, "coin"),
    owner: p.id,
    amount: delta,
    reason,
    at: w.now,
  });
}
function note(w: World, id: string, message: string) {
  const p = profile(w, id);
  p.notes = [...p.notes.slice(-19), message];
  w.repo.put("profile", p);
}
function consume(bag: Slot[], cost: Cost): Slot[] {
  check(
    Object.entries(cost).every(([id, n]) => countItem(bag, id) >= n),
    "Missing materials: " +
      Object.entries(cost)
        .map(([id, n]) => `${n} ${id}`)
        .join(", "),
  );
  let out = bag.slice();
  for (const [id, n] of Object.entries(cost)) {
    let left = n;
    for (let i = 0; i < out.length && left; i++)
      if (out[i]?.itemId === id) {
        const r = removeFromSlot(out, i, left);
        out = r.slots;
        left -= r.removed;
      }
  }
  return out;
}
function receive(bag: Slot[], id: string, quantity: number, storage = false) {
  check(getItemDef(id), "Unknown item");
  const r = addItem(bag, id, quantity, { allowWeaponQuickSlots: storage });
  check(r.remaining === 0, storage ? "This storage is full" : "Make room in your inventory first");
  return r.slots;
}
function spend(a: Actor, cost: Cost) {
  a.bag = consume(a.bag, cost);
}
function atTown(a: Actor) {
  return (
    a.region === "settlement" && distance(a, REGIONS.settlement.spawn) <= 4
  );
}
function atPort(a: Actor) {
  return PORTS.find((p) => p.region === a.region && distance(a, p) <= 4);
}
function authorizedStation(w: World, a: Actor, station: string) {
  return station === "harbour"
    ? !!atPort(a)
    : atTown(a) ||
        w.repo
          .all("building")
          .some(
            (b) =>
              PIECES[b.piece].station === station &&
              near(a, b, 2) &&
              can(w.repo.get("claim", b.claim)!, a.id, 1),
          );
}
function unlocked(p: Profile, discipline?: number, level = 1) {
  return (
    discipline === undefined ||
    (p.active.includes(discipline) && levelForXp(p.xp[discipline]) >= level)
  );
}
function claim(w: World, id: string) {
  const c = w.repo.get("claim", id);
  check(c, "This plot is unclaimed");
  return c;
}
function own(w: World, a: Actor, id: string) {
  const c = claim(w, id);
  check(c.owner === a.id, "Only the owner can do that");
  return c;
}
function localClaim(w: World, a: Actor, c: Claim) {
  const p = plotFor(c);
  check(
    a.region === p.region && distance(a, p) <= 20,
    "Walk to the plot first",
  );
}
function onboard(w: World, id: string) {
  return w.repo.all("boat").find((b) => b.crew.includes(id));
}
function blocked(w: World, a: Actor, extra?: Building, omit?: string) {
  const pieces = w.repo
    .all("building")
    .filter((b) => b.region === a.region && b.id !== omit);
  if (extra) pieces.push(extra);
  const cells = buildingCollisionKeys(pieces, (b) =>
    PIECES[b.piece].solid ||
    (["door", "gate"].includes(b.piece) &&
      !can(claim(w, b.claim), a.id, 1) &&
      !can(claim(w, b.claim), a.id, 2) &&
      !(
        a.x >= plotFor(claim(w, b.claim)).x &&
        a.x < plotFor(claim(w, b.claim)).x + 16 &&
        a.z >= plotFor(claim(w, b.claim)).z &&
        a.z < plotFor(claim(w, b.claim)).z + 16
      )),
  );
  return buildingBlocker(cells);
}
/** Reach another actor along a currently legal route, stopping at interaction range. */
export function interactionRoute(w: World, a: Actor, target: Actor, range = 1): Point[] | null {
  if (a.region !== target.region || a.region === 'bramblewild' || a.region === 'sea' || onboard(w, a.id)) return null;
  const route = regionalPath(a.region, a, target, blocked(w, a));
  return route?.slice(0, Math.max(0, route.length - range)) ?? null;
}
function placement(w: World, a: Actor, c: Claim, b: Building, omit?: string) {
  const parcel = plotFor(c),
    def = PIECES[b.piece],
    size = FRONTIER.sizes[c.tier];
  check(def, "Unknown building piece");
  check(
    b.region === parcel.region &&
      b.x >= parcel.x &&
      b.z >= parcel.z &&
      b.x < parcel.x + size &&
      b.z < parcel.z + size,
    "Outside your buildable area",
  );
  const pieces = w.repo.all("building");
  check(
    !pieces.some(
      (other) =>
        other.id !== omit &&
        buildingsOverlap(other, b),
    ),
    "That layer is occupied",
  );
  check(
    isEdgeBuilding(b) || !w.actors.some(
      (other) =>
        other.region === b.region && other.x === b.x && other.z === b.z,
    ),
    "A character is standing there",
  );
  check(
    isEdgeBuilding(b) || !w.repo
      .all("creature")
      .some(
        (other) =>
          other.region === b.region && other.x === b.x && other.z === b.z,
      ),
    "A creature is standing there",
  );
  if (def.solid)
    for (const other of w.actors.filter(
      (p) =>
        p.region === b.region &&
        p.x >= parcel.x &&
        p.x < parcel.x + 16 &&
        p.z >= parcel.z &&
        p.z < parcel.z + 16,
    ))
      check(
        regionalPath(
          b.region,
          other,
          parcel.marker,
          blocked(w, other, b, omit),
        ),
        "This would trap a character",
      );
}
export function previewBuilding(w: World, a: Actor, c: Command) {
  try {
    const land = claim(w, c.id ?? "");
    check(can(land, a.id, 1), "Building permission required");
    const b: Building = {
      id: "preview",
      claim: land.id,
      region: plotFor(land).region,
      piece: str(c.item),
      x: integer(c.x),
      z: integer(c.z),
      rotation: integer(c.rotation ?? 0, 0, 3),
      edge: !!PIECES[str(c.item)]?.edge,
      label: "",
    };
    placement(w, a, land, b);
    return { valid: true, cost: PIECES[b.piece].cost };
  } catch (e) {
    return { valid: false, reason: (e as Error).message };
  }
}
function storagePermission(w: World, a: Actor, c: Container) {
  if (c.claim) {
    const land = claim(w, c.claim);
    check(can(land, a.id, 2), "Storage permission required");
    const b = w.repo.get("building", c.id);
    check(b && near(a, b), "Walk to the chest");
  } else if (c.boat) {
    const b = w.repo.get("boat", c.boat);
    check(
      b && (b.owner === a.id || !!((b.permissions[a.id] ?? 0) & 4)),
      "Boat cargo permission required",
    );
    check(b!.crew.includes(a.id) || near(a, b!), "Walk to the boat");
  } else if (c.id.startsWith("pet-")) {
    check(
      unlocked(profile(w, a.id), 3, 2),
      "Activate Beastcraft to use trained pack storage",
    );
    const pet = w.repo.get("creature", c.id.slice(4));
    check(
      pet && pet.owner === a.id && pet.active && near(a, pet),
      "Call your pack companion first",
    );
  } else
    check(c.owner === a.id && (atTown(a) || atGroveVault(a)), "Your vault opens in Meadows town and in the Grove safe ring");
}
function homeRoute(w: World, a: Actor, to: Point, respectBoundaries = true) {
  const meadowBlocked: PathBlocker = blocked(w, { ...a, ...(a.region === "settlement" ? a : { x: -1, z: -1 }), region: "settlement" });
  const obstacles = Object.assign((p: Location) => p.region === "bramblewild" ? (w.homeBlocked?.(p) ?? false) : meadowBlocked(p), {
    crosses: (from: Location, next: Location) => from.region === "settlement" && next.region === "settlement" && !!meadowBlocked.crosses?.(from, next),
  });
  return homePath(homePoint(a, a.region), to,
    obstacles, respectBoundaries ? w.homeStepRule?.(a) : undefined);
}
function queueHomeWalk(w: World, a: Actor, to: Location) {
  check(isHomeRegion(a.region) && !onboard(w, a.id), "Walking is available on the home island");
  check(to.region === a.region || (!a.hostile && (w.canLeaveHomeDistrict?.(a) ?? true)), "Finish your adventure or combat before taking the Meadows trail");
  // The sealed Spire floor counts as land for the tick's movement mask, but no walk reaches it: refuse it before
  // routing instead of exhausting two searches over the whole home grid.
  check(regionLand(to.region, to) && !(to.region === "bramblewild" && inSpireFloor(to)), "Choose dry ground in the requested district");
  const target = homePoint(to, to.region);
  if (!homeRoute(w, a, target)) {
    // Only blame a progression boundary when removing that rule restores a
    // route. A house wall or locked gate must never suggest crafting a stick.
    const unrestricted = w.homeStepRule && homeRoute(w, a, target, false);
    if (unrestricted) {
      const rule = w.homeStepRule!(a);
      let previous: Location = a;
      for (const point of unrestricted) {
        const next = homeLocation(point);
        if (!rule(previous, next) && next.region === "bramblewild") {
          const boulders = ["boulder-line", "boulders"].includes(areaOf(next));
          check(false, boulders ? "No walkable route. Carry a stone club to cross the Boulders" : "No walkable route. Carry a sturdy stick to pass the Bramblewild hedge");
        }
        previous = next;
      }
    }
    check(false, "No walkable route. An obstacle or closed gate blocks the way");
  }
  a.target = homeTarget(target);
}

/** Travel is quicker at peace; server adapters retain cargo and combat limits. */
function movementSteps(w: World, a: Actor): number {
  return Math.max(1, Math.min(a.hostile ? 2 : 3, w.movementSteps?.(a) ?? 3));
}
export function cancelGathering(w: World, actorId: string) {
  for (const node of w.repo.all("resource")) {
    if (node.harvest?.by !== actorId) continue;
    delete node.harvest;
    w.repo.put("resource", node);
  }
}
function gatherYield(p: Profile, a: Actor, item: string) {
  return item === "timber" && countItem(a.bag, "axe") ? 2
    : unlocked(p, 0, 10) && ["stone", "iron_ore"].includes(item) && countItem(a.bag, "pick") ? 2 : 1;
}
export function perform(w: World, a: Actor, input: unknown): void {
  const cmd = validateCommand(input),
    r = w.repo,
    cfg = r.get("config", "world");
  check(cfg?.enabled, "The settlements expansion is not enabled");
  check(a.online && a.alive, "Return to the world before acting");
  const p = profile(w, a.id),
    id = cmd.id ?? "";
  if (a.region === "bramblewild")
    check(
      [
        "enter",
        "walk",
        "stop",
        "tax",
        "permit",
        "abandon",
        "boat",
        "boat_permit",
        "board",
        "pilot",
        "sail",
        "disembark",
        "craft",
        "talk",
        "quest",
        "container",
        "ability",
        "observe",
        "tame",
        "train",
        "equip",
        "eat",
      ].includes(cmd.action),
      "Use Bramblewild controls for this action",
    );
  // A successful new action releases the previous resource. Reducer rollback preserves it on error.
  if (cmd.action !== "gather") cancelGathering(w, a.id);
  switch (cmd.action) {
    case "enter":
      check(a.region === "bramblewild", "You are already on the Meadows trail");
      queueHomeWalk(w, a, { region: "settlement", ...REGIONS.settlement.spawn });
      break;
    case "return":
      check(a.region === "settlement", "Follow the home island trail from the Meadows");
      queueHomeWalk(w, a, { region: "bramblewild", x: 22, z: 18 });
      break;
    case "walk": {
      check(cmd.id === "bramblewild" || cmd.id === "settlement", "Choose a home island district");
      queueHomeWalk(w, a, { region: cmd.id, x: integer(cmd.x), z: integer(cmd.z) });
      break;
    }
    case "move": {
      check(
        a.region !== "bramblewild" && a.region !== "sea" && !onboard(w, a.id),
        "Use walking on land and the helm at sea",
      );
      const target = { x: integer(cmd.x), z: integer(cmd.z) };
      check(
        regionalPath(a.region, a, target, blocked(w, a)),
        "No walkable route",
      );
      a.target = target;
      break;
    }
    case "stop":
      a.target = undefined;
      break;
    case "talk":
      if (id === "shipwright") {
        check(atPort(a), "Meet the shipwright at a harbour");
        event(p, "shipwright");
      } else {
        check(atTown(a), "Meet the steward in town");
        event(p, "steward");
      }
      break;
    case "quest": {
      const q = QUESTS.find((q) => q.id === id);
      check(q, "Unknown quest");
      const progress = questProgress(p).find((row) => row.id === id)!;
      check(
        progress.available && !progress.complete,
        "Complete the previous quest first",
      );
      check(
        atTown(a) || atPort(a),
        "Claim your quest reward from the steward or shipwright",
      );
      if (q.handIn) {
        if (id === "cinder")
          check(
            p.discoveries.includes("cinder"),
            "Discover Cinder Shoal first",
          );
        spend(a, q.handIn);
      } else
        check(
          (p.events[q.event] ?? 0) >= q.amount,
          "Finish the quest objective first",
        );
      p.quests.push(id);
      money(w, p, q.coins, `quest:${id}`);
      break;
    }
    case "order": {
      check(atTown(a) || atPort(a), "Visit the steward or shipwright");
      const order = ORDERS.find((o) => o.id === id);
      check(order, "Unknown order");
      const day = utcDay(w.now);
      if (p.repeatDay !== day) {
        p.repeatDay = day;
        p.repeatCoins = 0;
      }
      check(
        p.repeatCoins + 10 <= FRONTIER.repeatCap,
        "Daily repeatable coin allowance reached",
      );
      spend(a, order.inputs);
      p.repeatCoins += 10;
      money(w, p, 10, `order:${id}`);
      event(p, "order");
      xp(p, 2, 10);
      break;
    }
    case "gather": {
      const node = RESOURCE_PATCHES.find((n) => n.id === id);
      check(node && near(a, node), "Walk beside the resource patch");
      const state = r.get("resource", id) ?? { ...node };
      check(!state.harvest, state.harvest?.by === a.id ? "Already gathering this resource" : "Someone is gathering this resource");
      check(!state.regrowsAt || w.now >= state.regrowsAt, "This tree is regrowing");
      // Check space now and again at completion; starting never grants an item or XP.
      receive(a.bag, node.item, gatherYield(p, a, node.item));
      cancelGathering(w, a.id);
      const duration =
        (unlocked(p, 1, 5) &&
        ["fibre", "reeds", "berry_greenberry", "berry_strawberry"].includes(
          node.item,
        )
          ? 2400
          : FRONTIER.gatherDuration);
      state.harvest = { by: a.id, startedAt: w.now, completesAt: w.now + duration,
        origin: { x: a.x, z: a.z }, hp: a.hp, inputStamp: a.inputStamp,
        tool: node.item === "timber" ? countItem(a.bag, "axe") ? "axe" : "hatchet"
          : ["stone", "iron_ore", "clay"].includes(node.item) ? "pick" : "hands",
        quantity: gatherYield(p, a, node.item) };
      delete state.felledAt;
      delete state.regrowsAt;
      a.target = undefined;
      if (distance(a, node) > 0) a.facing = facingFromDelta(node.x - a.x, node.z - a.z);
      p.nextGather = w.now + duration;
      r.put("resource", state);
      break;
    }
    case "craft": {
      const recipe = FRONTIER_RECIPES.find((x) => x.id === id);
      check(recipe, "Unknown recipe");
      check(
        !a.hostile && w.now >= (p.events.hostileUntil ?? 0),
        "Finish combat first",
      );
      check(
        unlocked(p, recipe.discipline, recipe.level),
        "Activate the required discipline and reach its level",
      );
      check(
        !recipe.station || authorizedStation(w, a, recipe.station),
        "Walk beside the required workstation or use the public town workshop",
      );
      const inputs = Object.fromEntries(
        Object.entries(recipe.inputs).map(([id, n]) => [
          id,
          unlocked(p, 2, 10) && n >= 4 ? n - 1 : n,
        ]),
      );
      const bag = consume(a.bag, inputs);
      a.bag = receive(
        bag,
        recipe.output,
        recipe.quantity + (unlocked(p, 2, 2) && recipe.quantity >= 2 ? 1 : 0),
      );
      event(p, `craft:${id}`);
      xp(p, 2, 15);
      break;
    }
    case "claim": {
      const plot = PLOTS.find((x) => x.id === id);
      check(
        plot && near(a, { ...plot, ...plot.marker }),
        "Walk to an available claim marker",
      );
      check(!r.get("claim", id), "This plot already has an owner");
      check(
        !r.all("claim").some((c) => c.owner === a.id) &&
          !r.all("claim").some((c) => c.challenge?.by === a.id),
        "You already own or are challenging a plot",
      );
      check(
        p.quests.includes("tools"),
        "Earn your deed through the steward quests",
      );
      money(w, p, -FRONTIER.deed - FRONTIER.taxes[0], "deed and first week");
      r.put("claim", {
        id,
        owner: a.id,
        tier: 0,
        paidUntil: w.now + WEEK,
        cooldownUntil: 0,
        permissions: {},
      });
      event(p, "claim");
      break;
    }
    case "tax": {
      const land = claim(w, id);
      check(can(land, a.id, 4), "Treasurer permission required");
      const weeks = integer(cmd.quantity, 1, 4);
      const until = Math.max(land.paidUntil, w.now) + weeks * WEEK;
      check(
        until <= w.now + FRONTIER.maxPrepay,
        "At most four weeks can be prepaid",
      );
      money(w, p, -renewalPrice(land, w.now, weeks), "land tax");
      land.paidUntil = until;
      if (land.challenge) {
        const other = profile(w, land.challenge.by);
        money(
          w,
          other,
          land.challenge.deposit,
          "challenge cancelled by tax payment",
        );
        r.put("profile", other);
        delete land.challenge;
      }
      r.put("claim", land);
      event(p, "upkeep");
      break;
    }
    case "upgrade": {
      const land = own(w, a, id);
      localClaim(w, a, land);
      check(!land.challenge && land.tier < 2, "Cannot expand this plot now");
      money(
        w,
        p,
        -FRONTIER.upgradeCoins[land.tier] -
          Math.ceil(
            (Math.max(0, land.paidUntil - w.now) / WEEK) *
              (FRONTIER.taxes[land.tier + 1] - FRONTIER.taxes[land.tier]),
          ),
        "plot upgrade and prepaid tax adjustment",
      );
      spend(
        a,
        land.tier === 0
          ? { planks: 10, stone: 10 }
          : { planks: 20, bricks: 20 },
      );
      land.tier++;
      r.put("claim", land);
      break;
    }
    case "permit": {
      const land = own(w, a, id);
      check(!land.challenge, "Permissions are frozen during a challenge");
      const target = str(cmd.target),
        mask = integer(cmd.permissions, 0, 7);
      check(
        target !== a.id && w.actors.some((x) => x.id === target),
        "Choose another known character",
      );
      check(
        Object.keys(land.permissions).length < 8 ||
          target in land.permissions ||
          mask === 0,
        "At most eight trusted helpers",
      );
      if (mask) land.permissions[target] = mask;
      else delete land.permissions[target];
      r.put("claim", land);
      break;
    }
    case "abandon": {
      const land = own(w, a, id);
      check(!land.challenge, "Cannot abandon a challenged plot");
      check(
        !r.all("building").some((b) => b.claim === id),
        "Dismantle your buildings and empty storage first",
      );
      r.remove("claim", id);
      break;
    }
    case "challenge": {
      const land = claim(w, id);
      localClaim(w, a, land);
      check(!cfg.pausedAt, "Capture challenges are paused");
      check(
        claimStatus(land, w.now) === "vulnerable" &&
          w.now >= land.cooldownUntil,
        "The claim is not available for a challenge",
      );
      check(
        !r
          .all("claim")
          .some((c) => c.owner === a.id || c.challenge?.by === a.id),
        "You already own or are challenging a plot",
      );
      check(
        p.quests.includes("tools"),
        "Earn your deed through the steward quests",
      );
      const deposit = FRONTIER.taxes[land.tier];
      money(w, p, -deposit, "challenge deposit");
      land.challenge = {
        by: a.id,
        opens: w.now + FRONTIER.notice,
        closes: w.now + FRONTIER.notice + FRONTIER.window,
        heldSince: 0,
        deposit,
        attackers: [a.id],
        defenders: [],
      };
      r.put("claim", land);
      note(
        w,
        land.owner,
        `Your claim ${id} has a challenge. Pay overdue tax before capture to keep it.`,
      );
      break;
    }
    case "invite_contest": {
      const c = claim(w, id).challenge;
      check(c && c.by === a.id, "Only the challenger can invite attackers");
      const target = str(cmd.target);
      check(
        w.actors.some((a) => a.id === target) && target !== a.id,
        "Choose another character",
      );
      c.invited = [...new Set([...(c.invited ?? []), target])].slice(0, 3);
      const land = claim(w, id);
      land.challenge = c;
      r.put("claim", land);
      break;
    }
    case "join_contest": {
      const land = claim(w, id),
        c = land.challenge;
      check(c && w.now < c.closes, "No active challenge");
      const side = cmd.target === "defend" ? c.defenders : c.attackers;
      check(
        cmd.target === "defend"
          ? can(land, a.id, 1)
          : a.id === c.by || c.invited?.includes(a.id),
        "Only the owner or trusted helpers can defend; challengers enter themselves",
      );
      check(
        !side.includes(a.id) && side.length < 4,
        "Team is full or you already joined",
      );
      side.push(a.id);
      r.put("claim", land);
      break;
    }
    case "build": {
      const land = claim(w, id);
      check(can(land, a.id, 1), "Building permission required");
      localClaim(w, a, land);
      check(!land.challenge, "Finish the claim challenge before building");
      check(
        r.all("building").filter((b) => b.claim === id).length <
          FRONTIER.maxPieces,
        "Plot construction limit reached",
      );
      const piece = str(cmd.item),
        def = PIECES[piece];
      check(def, "Unknown building piece");
      check(
        unlocked(p, def.discipline, def.level),
        "Building specialization and level required",
      );
      const b: Building = {
        id: nextId(w, "piece"),
        claim: id,
        piece,
        region: plotFor(land).region,
        x: integer(cmd.x),
        z: integer(cmd.z),
        rotation: integer(cmd.rotation ?? 0, 0, 3),
        edge: !!def.edge,
        label: (cmd.label ?? "").slice(0, 48),
      };
      placement(w, a, land, b);
      spend(a, def.cost);
      r.put("building", b);
      if (piece === "chest")
        r.put("container", {
          id: b.id,
          owner: land.owner,
          claim: id,
          slots: Array(12).fill(null),
        });
      if (!p.events[`build:${piece}`]) xp(p, 2, 25);
      event(p, `build:${piece}`);
      const pieces = r.all("building").filter((b) => b.claim === id);
      if (
        ["floor", "wall", "roof"].every((key) =>
          pieces.some((b) => b.piece === key),
        )
      )
        event(p, "shelter");
      break;
    }
    case "move_building": {
      const b = r.get("building", id);
      check(b, "Unknown building");
      const land = claim(w, b.claim);
      check(
        can(land, a.id, 1) && !land.challenge,
        "Building permission required outside a challenge",
      );
      localClaim(w, a, land);
      const next = {
        ...b,
        x: integer(cmd.x),
        z: integer(cmd.z),
        rotation: integer(cmd.rotation ?? b.rotation, 0, 3),
        edge: !!PIECES[b.piece]?.edge,
      };
      placement(w, a, land, next, b.id);
      r.put("building", next);
      const crop = r.get("crop", id);
      if (crop) r.put("crop", { ...crop, x: next.x, z: next.z });
      break;
    }
    case "dismantle": {
      const b = r.get("building", id);
      check(b, "Unknown building");
      const land = claim(w, b.claim);
      check(
        can(land, a.id, 1) && !land.challenge,
        "Building permission required outside a challenge",
      );
      localClaim(w, a, land);
      check(
        !r.get("container", id)?.slots.some(Boolean),
        "Empty the container first",
      );
      for (const [item, n] of Object.entries(PIECES[b.piece].cost)) {
        const qty = Math.floor(n * 0.75);
        if (qty) a.bag = receive(a.bag, item, qty);
      }
      r.remove("building", id);
      r.remove("container", id);
      r.remove("crop", id);
      break;
    }
    case "container": {
      let c = r.get("container", id);
      if (id === `vault-${a.id}` && !c)
        c = { id, owner: a.id, slots: Array(FRONTIER.bankSlots).fill(null) };
      check(c, "Unknown container");
      storagePermission(w, a, c);
      // Grow legacy personal vaults on access, preserving every occupied slot.
      if (id === `vault-${a.id}` && c.slots.length < FRONTIER.bankSlots)
        c.slots = [...c.slots, ...Array(FRONTIER.bankSlots - c.slots.length).fill(null)];
      const quantity = integer(cmd.quantity, 1, 99),
        item = str(cmd.item);
      check(getItemDef(item), "Unknown item");
      if (cmd.target === "deposit") {
        const bag = consume(a.bag, { [item]: quantity });
        const slots = receive(c.slots, item, quantity, true);
        a.bag = bag;
        c.slots = slots;
        if (c.boat && (getItemDef(item)?.healthRestore ?? 0) > 0)
          event(p, "provisions");
      } else {
        check(cmd.target === "withdraw", "Choose deposit or withdraw");
        const slots = consume(c.slots, { [item]: quantity });
        a.bag = receive(a.bag, item, quantity);
        c.slots = slots;
      }
      r.put("container", c);
      break;
    }
    case "specialize": {
      check(
        atTown(a) &&
          !a.hostile &&
          w.now >= (p.events.hostileUntil ?? 0) &&
          !onboard(w, a.id) &&
          !r
            .all("claim")
            .some(
              (c) =>
                c.challenge &&
                (c.challenge.attackers.includes(a.id) ||
                  c.challenge.defenders.includes(a.id)),
            ),
        "Change disciplines in town outside conflict and voyages",
      );
      check(cmd.disciplines, "Choose two disciplines");
      // Retrying an accepted command, or reversing its pair, never charges again.
      if (sameDisciplines(p.active, cmd.disciplines)) break;
      const switching = specializationSwitch(p, w.now);
      check(!switching.waitMs || cmd.earlySwitch, `Wait 24 hours between specialization changes, or switch early for ${switching.earlyCost} coins total`);
      const price = switching.waitMs ? switching.earlyCost : switching.normalCost;
      if (price) money(w, p, -price, switching.waitMs ? 'early specialization change' : 'specialization');
      p.active = cmd.disciplines;
      p.switchedAt = w.now;
      break;
    }
    case "restore_shrine": {
      const shrine = ISLAND_SHRINES.find(shrine => shrine.id === id);
      check(shrine, "Choose an island shrine");
      check(!shrineRestored(p, shrine.id), "You already restored this shrine");
      check(near(a, shrine, 2) && !onboard(w, a.id), "Walk beside the shrine on its island");
      a.bag = consume(a.bag, shrine.cost);
      p.events[`shrine:${shrine.id}`] = 1;
      p.notes = [...p.notes.slice(-19), `${shrine.name} restored: permanent +5% discipline XP.`];
      break;
    }
    case "brace": {
      check(unlocked(p, 0, 5), "Activate Might at level 5");
      check(w.now >= p.nextAbility, "Your ability is resting");
      p.events.braceUntil = w.now + 12000;
      p.nextAbility = w.now + 30000;
      break;
    }
    case "survey": {
      check(unlocked(p, 4, 2), "Activate Exploration at level 2");
      check(
        !p.events[`survey:${a.region}`],
        "You already found this region cache",
      );
      check(
        a.region !== "sea" && distance(a, { x: 118, z: 112 }) <= 3,
        "Search the far southeast of this region near 118,112",
      );
      a.bag = receive(a.bag, "berry_goldberry", 1);
      event(p, `survey:${a.region}`);
      xp(p, 4, 25);
      break;
    }
    case "observe": {
      const c = r.get("creature", id);
      check(c && near(a, c, 4), "Walk near the creature");
      if (!p.observed.includes(c.species)) {
        p.observed.push(c.species);
        xp(p, 3, 15);
      }
      event(p, "observe");
      break;
    }
    case "tame": {
      const c = r.get("creature", id);
      check(c && near(a, c), "Walk beside the creature");
      check(
        !c.owner && SPECIES.find((s) => s.id === c.species)?.tameable,
        "This creature cannot be tamed",
      );
      check(
        p.observed.includes(c.species),
        "Observe this species before feeding it",
      );
      check(w.now >= p.nextAbility, "Give the creature time to approach");
      const owned = r.all("creature").filter((c) => c.owner === a.id).length;
      check(owned < FRONTIER.maxCompanions, "Your companion and stable are full");
      if (owned)
        check(
          r
            .all("building")
            .some(
              (b) => b.piece === "stable" && claim(w, b.claim).owner === a.id,
            ),
          "Build a stable before befriending more companions",
        );
      spend(a, { taming_feed: 1 });
      p.nextAbility = w.now + 6000;
      p.tame[id] = (p.tame[id] ?? 0) + 1;
      if (p.tame[id] >= (unlocked(p, 3, 5) ? 1 : 2)) {
        c.owner = a.id;
        c.active = !p.companion;
        if (c.active) p.companion = c.id;
        r.put("creature", c);
        event(p, "tame");
        xp(p, 3, 30);
        seedCreatures(w);
      }
      break;
    }
    case "train": {
      const c = r.get("creature", id);
      check(c && c.owner === a.id && near(a, c), "Walk to your creature");
      check(unlocked(p, 3, 2), "Activate Beastcraft at level 2");
      check(!c.trained, "Already trained");
      spend(a, { harness: 1 });
      c.trained = true;
      r.put("creature", c);
      if (c.species === "reedhorn")
        r.put("container", {
          id: `pet-${c.id}`,
          owner: a.id,
          slots: Array(6).fill(null),
        });
      xp(p, 3, 25);
      break;
    }
    case "companion": {
      const c = r.get("creature", id);
      check(
        c && c.owner === a.id && w.now >= c.restUntil,
        "This companion is unavailable",
      );
      check(
        atTown(a) || authorizedStation(w, a, "stable"),
        "Choose companions at town or your stable",
      );
      for (const pet of r.all("creature").filter((c) => c.owner === a.id)) {
        pet.active = pet.id === id;
        if (pet.active) {
          pet.region = a.region;
          pet.x = a.x;
          pet.z = a.z;
        }
        r.put("creature", pet);
      }
      p.companion = id;
      break;
    }
    case "ability": {
      const c = r.get("creature", p.companion);
      check(
        c && c.active && c.trained && near(a, c) && unlocked(p, 3, 2),
        "Call a trained companion with Beastcraft active",
      );
      check(w.now >= p.nextAbility, "Companion ability is resting");
      p.nextAbility = w.now + (unlocked(p, 3, 10) ? 30000 : 60000);
      const found = companionFind(c.species, w.now);
      if (found) a.bag = receive(a.bag, found.item, found.quantity);
      else if (c.species === "emberling") a.hp = Math.min(maxHealth(p, a), a.hp + 6);
      else if (c.species === "hootling")
        p.notes = [
          ...p.notes.slice(-19),
          `Wild creatures: ${r.all("creature").filter((n) => !n.owner && n.region === a.region)
            .map((n) => `${SPECIES.find((s) => s.id === n.species)?.name ?? n.species} (${n.x},${n.z})`)
            .join("; ") || "none nearby"}`,
        ];
      else
        p.notes = [
          ...p.notes.slice(-19),
          c.species === "glowmoth"
            ? `Resource patches: ${RESOURCE_PATCHES.filter(
                (n) => n.region === a.region,
              )
                .map((n) => `${n.item} (${n.x},${n.z})`)
                .join("; ")}`
            : c.species === "shellback"
              ? "Shellback is guarding your cargo for 12 seconds."
              : "Your Reedhorn carries six cargo slots.",
        ];
      if (c.species === "shellback") p.events.guardUntil = w.now + 12000;
      break;
    }
    case "plant": {
      const b = r.get("building", id);
      check(
        b &&
          b.piece === "planter" &&
          near(a, b) &&
          can(claim(w, b.claim), a.id, 1),
        "Use a planter on a plot you can build on",
      );
      check(!r.get("crop", id), "This planter is occupied");
      spend(a, { carrot_seed: 1 });
      r.put("crop", {
        id,
        owner: a.id,
        region: b.region,
        x: b.x,
        z: b.z,
        item: "carrot",
        ripeAt:
          w.now + (countItem(a.bag, "watering_can") ? 1.5 : 2) * 60 * 60 * 1000,
      });
      xp(p, 1, 8);
      break;
    }
    case "harvest_crop": {
      const c = r.get("crop", id),
        b = r.get("building", id);
      check(
        c && b && near(a, c) && can(claim(w, b.claim), a.id, 1),
        "Use a planter on a plot you can build on",
      );
      check(w.now >= c.ripeAt, "This crop is still growing");
      a.bag = receive(a.bag, "carrot", unlocked(p, 1, 2) ? 4 : 3);
      r.remove("crop", id);
      xp(p, 1, 20);
      break;
    }
    case "boat": {
      const port = atPort(a);
      check(port, "Build your skiff at a harbour");
      check(
        !r.all("boat").some((b) => b.owner === a.id),
        "You already own a skiff",
      );
      spend(a, { skiff_hull: 1, sail: 1 });
      const boat: Boat = {
        id: nextId(w, "skiff"),
        owner: a.id,
        region: port.region,
        x: port.x,
        z: port.z,
        permissions: {},
        crew: [],
        pilot: "",
        lastPort: port.region,
        emptySince: 0,
      };
      r.put("boat", boat);
      r.put("container", {
        id: boat.id,
        boat: boat.id,
        owner: a.id,
        slots: Array(12).fill(null),
      });
      event(p, "boat");
      xp(p, 2, 40);
      break;
    }
    case "boat_permit": {
      const b = r.get("boat", id);
      check(b && b.owner === a.id, "Only the boat owner can grant access");
      const target = str(cmd.target),
        mask = integer(cmd.permissions, 0, 7);
      check(
        w.actors.some((p) => p.id === target),
        "Unknown character",
      );
      if (mask) b.permissions[target] = mask;
      else delete b.permissions[target];
      if (b.pilot === target && !(mask & 2)) b.pilot = "";
      r.put("boat", b);
      break;
    }
    case "board": {
      const b = r.get("boat", id);
      check(
        b && b.region !== "sea" && near(a, b) && atPort(a),
        "Board at a harbour",
      );
      check(
        b.owner === a.id || !!((b.permissions[a.id] ?? 0) & 1),
        "Boarding permission required",
      );
      check(
        !onboard(w, a.id) && b.crew.length < 4,
        "Boat is full or you already boarded",
      );
      b.crew.push(a.id);
      b.emptySince = 0;
      a.target = undefined;
      r.put("boat", b);
      break;
    }
    case "pilot": {
      const b = onboard(w, a.id);
      check(
        b && (b.owner === a.id || !!((b.permissions[a.id] ?? 0) & 2)),
        "Pilot permission required aboard",
      );
      b.pilot = a.id;
      r.put("boat", b);
      break;
    }
    case "sail": {
      const b = onboard(w, a.id);
      check(b && b.pilot === a.id, "Take the helm first");
      if (b.region !== "sea") {
        const port = PORTS.find((p) => p.region === b.region)!;
        b.region = "sea";
        Object.assign(b, port.sea);
      }
      const to = { x: integer(cmd.x, 3, 124), z: integer(cmd.z, 3, 124) };
      check(
        regionalPath("sea", b, to, (p) => !boatCanFloat(p)),
        "No navigable route",
      );
      b.target = to;
      r.put("boat", b);
      for (const crew of w.actors.filter((x) => b.crew.includes(x.id))) {
        crew.region = "sea";
        crew.x = b.x;
        crew.z = b.z;
        crew.target = undefined;
        w.save(crew);
      }
      a.region = "sea";
      a.x = b.x;
      a.z = b.z;
      break;
    }
    case "dock": {
      const b = onboard(w, a.id);
      check(
        b && b.pilot === a.id && b.region === "sea",
        "Dock from the helm at sea",
      );
      const port = PORTS.find((p) => p.region === id);
      check(
        port && distance(b, port.sea) <= (unlocked(p, 4, 5) ? 4 : 2),
        "Sail to the destination harbour first",
      );
      b.region = port.region;
      b.x = port.x;
      b.z = port.z;
      b.lastPort = port.region;
      b.target = undefined;
      r.put("boat", b);
      for (const crew of w.actors.filter((x) => b.crew.includes(x.id))) {
        crew.region = port.region;
        crew.x = port.x;
        crew.z = port.z;
        w.save(crew);
        if (crew.id !== a.id) {
          const q = profile(w, crew.id);
          if (!q.discoveries.includes(id)) {
            q.discoveries.push(id);
            xp(q, 4, 50);
          }
          event(q, `visit:${id}`);
          r.put("profile", q);
        }
      }
      a.region = port.region;
      a.x = port.x;
      a.z = port.z;
      if (!p.discoveries.includes(id)) {
        p.discoveries.push(id);
        xp(p, 4, 50);
      }
      event(p, `visit:${id}`);
      break;
    }
    case "disembark": {
      const b = onboard(w, a.id);
      check(b && b.region !== "sea", "Disembark only at a harbour");
      b.crew = b.crew.filter((id) => id !== a.id);
      if (b.pilot === a.id) b.pilot = "";
      r.put("boat", b);
      a.region = b.region;
      a.x = b.x;
      a.z = b.z;
      break;
    }
    case "eat": {
      const item = str(cmd.item),
        def = getItemDef(item);
      check(def && def.healthRestore > 0, "Choose food");
      check(w.now >= p.nextAbility, "Wait before eating again");
      spend(a, { [item]: 1 });
      a.hp = Math.min(maxHealth(p, a), a.hp + foodHealing(def.healthRestore, p));
      p.nextAbility = w.now + 1800;
      p.nextAttack = Math.max(p.nextAttack, w.now + 1800);
      break;
    }
    case "pickup_bag": {
      const drop = r.get("drop", id);
      check(
        drop && near(a, drop) && w.now < drop.expiresAt,
        "Walk beside the dropped bag",
      );
      let bag = a.bag;
      const left: Slot[] = [];
      for (const slot of drop.slots) {
        if (!slot) continue;
        const result = addItem(bag, slot.itemId, slot.quantity);
        bag = result.slots;
        if (result.remaining)
          left.push({ itemId: slot.itemId, quantity: result.remaining });
      }
      a.bag = bag;
      if (left.length) r.put("drop", { ...drop, slots: left });
      else r.remove("drop", id);
      break;
    }
    case "equip": {
      const item = str(cmd.item);
      if (item === "padded_vest" && cmd.target === "unequip") {
        p.events.vest = 0;
        break;
      }
      check(
        countItem(a.bag, item) > 0 &&
          (item === "padded_vest" || !!getItemDef(item)?.weaponDamage),
        "Carry usable equipment first",
      );
      if (item === "padded_vest") p.events.vest = 1;
      else a.weapon = item;
      break;
    }
    case "attack": {
      check(w.now >= p.nextAttack, "Wait for your next swing");
      p.nextAttack = w.now + 2400;
      const target = w.actors.find((x) => x.id === id);
      if (target) {
        check(
          near(a, target, 1) && target.online && target.alive,
          "Walk beside the target",
        );
        const problem = regionalPvPProblem(a, target, r.all("claim"), w.now);
        check(!problem, problem ?? "Player combat is unavailable");
        p.events.hostileUntil = w.now + 60000;
        const tp = profile(w, target.id);
        tp.events.hostileUntil = w.now + 60000;
        r.put("profile", tp);
        target.hp -= damage(p, a);
        xp(p, 0, 1);
        if (target.hp <= 0) defeat(w, target, tp);
        w.save(target);
      } else {
        const c = r.get("creature", id);
        check(
          c &&
            c.species === "bristleback" &&
            near(a, c, 1) &&
            w.now >= c.restUntil,
          "No hostile creature in reach",
        );
        c.hp -= damage(p, a);
        a.hp -= w.now < (p.events.braceUntil ?? 0) ? 1 : 3;
        xp(p, 0, 1);
        if (c.hp <= 0) {
          c.hp = 30;
          c.restUntil = w.now + 60000;
          xp(p, 0, 25);
          a.bag = receive(a.bag, "fibre", 2);
        }
        r.put("creature", c);
        if (a.hp <= 0) defeat(w, a, p);
      }
      break;
    }
  }
  if (a.weapon && !countItem(a.bag, a.weapon)) a.weapon = "";
  r.put("profile", p);
  w.save(a);
}
export function maxHealth(p: Pick<Profile, 'active' | 'events'>, a: Pick<Actor, 'bag'>) {
  return Math.min(
    36,
    30 +
      (p.active.includes(0) ? 3 : 0) +
      (p.events.vest && countItem(a.bag, "padded_vest") ? 3 : 0),
  );
}
/** Food uses the same Forager benefit from the bag, quick bar, and agent API. */
export function foodHealing(base: number, p?: Pick<Profile, 'active' | 'xp'>) {
  return Math.min(10, base + (p?.active.includes(1) && levelForXp(p.xp[1]) >= 10 ? 2 : 0));
}
export function damage(p: Profile, a: Actor) {
  const base = getItemDef(a.weapon)?.weaponDamage || 3;
  const exact =
    Math.min(10, base * (unlocked(p, 0, 2) ? 1.1 : 1)) +
    (p.events.damageRemainder ?? 0);
  const result = Math.floor(exact + 1e-9);
  p.events.damageRemainder = exact - result;
  return result;
}
function defeat(w: World, a: Actor, p: Profile) {
  cancelGathering(w, a.id);
  const id = nextId(w, "drop"),
    slots = a.bag.slice();
  const boat = onboard(w, a.id);
  const returnRegion =
    a.region === "sea" ? (boat?.lastPort ?? "settlement") : a.region;
  if (boat) {
    boat.crew = boat.crew.filter((id) => id !== a.id);
    if (boat.pilot === a.id) boat.pilot = "";
    w.repo.put("boat", boat);
  }
  p.events.frontierRespawnRegion = [
    "bramblewild",
    "settlement",
    "reedwake",
    "cinder",
  ].indexOf(returnRegion);
  const pet = w.repo.all("creature").find((c) => c.owner === a.id && c.active);
  if (pet) {
    const pack = w.repo.get("container", `pet-${pet.id}`);
    if (pack) {
      slots.push(...pack.slots);
      pack.slots = Array(6).fill(null);
      w.repo.put("container", pack);
    }
    pet.active = false;
    pet.restUntil = w.now + 60000;
    w.repo.put("creature", pet);
  }
  w.repo.put("drop", {
    id,
    region: a.region,
    x: a.x,
    z: a.z,
    slots,
    expiresAt: w.now + 300000,
  });
  a.bag = Array(28).fill(null);
  a.hp = 0;
  a.alive = false;
  a.weapon = "";
  a.target = undefined;
  p.events.frontierRespawnAt = w.now + 3000;
  p.notes = [
    ...p.notes.slice(-19),
    `Defeated at ${a.region} ${a.x},${a.z}. Your supplies remain there for five minutes.`,
  ];
  w.repo.put("profile", p);
}

/** Idle claims/buildings never tick. Only moving actors, creatures, boats and active contests write. */
export function advance(w: World) {
  const r = w.repo,
    cfg = r.get("config", "world");
  if (!cfg?.enabled) return;
  // Reservations and regrowth use the server clock; idle resources never write per tick.
  for (const node of r.all("resource")) {
    const h = node.harvest;
    if (!h) {
      if (node.regrowsAt && w.now >= node.regrowsAt) {
        delete node.felledAt;
        delete node.regrowsAt;
        r.put("resource", node);
      }
      continue;
    }
    const a = w.actors.find(actor => actor.id === h.by);
    if (!a || !a.online || !a.alive || a.target || !near(a, node)
      || a.x !== h.origin.x || a.z !== h.origin.z || a.hp < h.hp
      || a.inputStamp !== h.inputStamp) {
      delete node.harvest;
      r.put("resource", node);
      continue;
    }
    if (w.now < h.completesAt) continue;
    a.bag = w.loadBag?.(a) ?? a.bag;
    const p = profile(w, a.id);
    // Energy sets the payout: double while rested, nothing on three of four tired gathers.
    const spent = spendEnergy(r.get("energy", a.id) ?? newEnergy(a.id, w.now, w.bornAt?.(a.id) ?? w.now), w.now, energyCost(h.completesAt - h.startedAt));
    const quantity = energyScaled(gatherYield(p, a, node.item), spent.payout);
    const result = addItem(a.bag, node.item, quantity);
    delete node.harvest;
    if (quantity === 0 || result.remaining < quantity) {
      r.put("energy", spent.state);
      a.bag = result.slots;
      const got = quantity - result.remaining;
      if (got) event(p, `gather:${node.item}`, got);
      if (spent.payout) xp(p, ["fibre", "reeds", "carrot_seed"].includes(node.item) ? 1 : 4, energyScaled(8, spent.payout));
      if (node.item === "timber") {
        node.felledAt = w.now;
        node.regrowsAt = w.now + FRONTIER.timberRegrow;
      }
      // On `p` itself: a separate note() would be overwritten by the profile saved just below.
      if (!spent.payout) p.notes = [...p.notes.slice(-19), "You are tired: that gather found nothing. Energy comes back with time, and a rest away from the game makes you rested."];
      r.put("profile", p);
      w.save(a);
    } else note(w, a.id, "Gathering stopped because your bag is full.");
    r.put("resource", node);
  }
  for (const a of w.actors.filter(
    (a) => !a.alive && a.region !== "bramblewild",
  )) {
    const p = profile(w, a.id);
    if (p.events.frontierRespawnAt && w.now >= p.events.frontierRespawnAt) {
      a.alive = true;
      a.hp = maxHealth(p, a);
      a.region =
        (["bramblewild", "settlement", "reedwake", "cinder"] as const)[
          p.events.frontierRespawnRegion ?? 1
        ] ?? "settlement";
      Object.assign(a, REGIONS[a.region].spawn);
      delete p.events.frontierRespawnRegion;
      delete p.events.frontierRespawnAt;
      r.put("profile", p);
      w.save(a);
    }
  }
  for (const a of w.actors.filter(a => a.online && a.alive && isHomeRegion(a.region) && isHomeTarget(a.target))) {
    const destination = homeDestination(a.target!);
    const canWalk = homeLocation(destination).region === a.region || (!a.hostile && (w.canLeaveHomeDistrict?.(a) ?? true));
    const route = canWalk ? homeRoute(w, a, destination) : null;
    if (route?.length) {
      const previousRegion = a.region;
      Object.assign(a, homeLocation(route[Math.min(movementSteps(w, a), route.length) - 1]));
      if (a.region !== previousRegion && a.region === "settlement") {
        const p = profile(w, a.id);
        event(p, "visit:settlement");
        r.put("profile", p);
      }
      if (distance(homePoint(a, a.region), destination) === 0) a.target = undefined;
    } else a.target = undefined;
    w.save(a);
  }
  for (const a of w.actors.filter(
    (a) =>
      a.online &&
      a.alive &&
      a.region !== "bramblewild" &&
      a.region !== "sea" &&
      a.target &&
      !isHomeTarget(a.target) &&
      !onboard(w, a.id),
  )) {
    const route = regionalPath(a.region, a, a.target!, blocked(w, a));
    if (route?.length) {
      Object.assign(a, route[Math.min(movementSteps(w, a), route.length) - 1]);
      if (distance(a, a.target!) === 0) a.target = undefined;
    } else a.target = undefined;
    w.save(a);
  }
  for (const b of r.all("boat")) {
    const online = w.actors.filter((a) => a.online && b.crew.includes(a.id));
    let changed = false;
    if (b.region === "sea") {
      if (!online.length) {
        if (!b.emptySince) {
          b.emptySince = w.now;
          changed = true;
        } else if (w.now >= b.emptySince + 300000) {
          const port = PORTS.find((p) => p.region === b.lastPort)!;
          b.region = port.region;
          b.x = port.x;
          b.z = port.z;
          b.target = undefined;
          b.emptySince = 0;
          changed = true;
        }
      } else {
        if (b.emptySince) {
          b.emptySince = 0;
          changed = true;
        }
        if (
          b.target &&
          online.some((a) => a.id === b.pilot) &&
          w.now >= (b.nextMove ?? 0)
        ) {
          b.nextMove = w.now + TICK_MS;
          const route = regionalPath(
            "sea",
            b,
            b.target,
            (p) => !boatCanFloat(p),
          );
          if (route?.length) {
            const steps = unlocked(profile(w, b.pilot), 4, 10) ? 2 : 1;
            Object.assign(b, route[Math.min(steps, route.length) - 1]);
            if (distance(b, b.target) === 0) b.target = undefined;
            changed = true;
          }
        }
      }
    }
    for (const a of w.actors.filter((a) => b.crew.includes(a.id)))
      if (a.region !== b.region || distance(a, b) > 0) {
        a.region = b.region;
        a.x = b.x;
        a.z = b.z;
        a.target = undefined;
        w.save(a);
      }
    if (changed) r.put("boat", b);
  }
  // New species join saved worlds, and wild strays find their way home.
  seedCreatures(w);
  for (const c of r.all("creature")) {
    if (w.now < c.nextMove) continue;
    if (
      !c.owner &&
      !w.actors.some(
        (a) => a.online && a.region === c.region && distance(a, c) <= 32,
      )
    )
      continue;
    const owner = c.owner
      ? w.actors.find((a) => a.id === c.owner && a.online)
      : undefined;
    if (c.owner && (!c.active || !owner || owner.region === "sea" || (owner.region === "bramblewild" && inSpireFloor(owner)))) continue;
    if (owner) {
      // Companions keep pace: up to three steps a tick, stopping beside you.
      if (owner.region !== c.region || distance(c, owner) > PET_LEASH) {
        c.region = owner.region;
        c.x = owner.x;
        c.z = owner.z;
      } else if (distance(c, owner) > 1) {
        const path = regionalPath(c.region, c, owner, blocked(w, owner));
        if (path && path.length > 1) Object.assign(c, path[Math.min(PET_STEPS, path.length - 1) - 1]);
      }
      c.nextMove = w.now + PET_STEP_MS;
    } else {
      const next = wildStep(c, w.now);
      if (next) Object.assign(c, next);
      c.nextMove = w.now + 3000;
    }
    r.put("creature", c);
  }
  for (const drop of r.all("drop"))
    if (w.now >= drop.expiresAt) r.remove("drop", drop.id);
  if (cfg.pausedAt) return;
  for (const land of r.all("claim")) {
    const c = land.challenge;
    if (!c || w.now < c.opens) continue;
    if (c.lastChecked && w.now - c.lastChecked > 1800) c.heldSince = 0;
    c.lastChecked = w.now;
    const marker = { ...plotFor(land), ...plotFor(land).marker };
    const attacker = w.actors.find(
      (a) => a.id === c.by && a.online && a.alive && near(a, marker, 1),
    );
    const defender = w.actors.some(
      (a) =>
        c.defenders.includes(a.id) && a.online && a.alive && near(a, marker, 1),
    );
    if (!attacker || defender) c.heldSince = 0;
    else if (!c.heldSince) c.heldSince = w.now;
    if (
      w.now < c.closes &&
      c.heldSince &&
      w.now - c.heldSince >= FRONTIER.hold
    ) {
      const old = land.owner;
      land.owner = c.by;
      land.permissions = {};
      land.paidUntil = w.now + WEEK;
      delete land.challenge;
      for (const storage of r
        .all("container")
        .filter((x) => x.claim === land.id)) {
        storage.owner = land.owner;
        r.put("container", storage);
      }
      note(
        w,
        old,
        `Your unpaid plot ${land.id} was captured. Your vault, boats and companions remain yours.`,
      );
      note(
        w,
        land.owner,
        `You captured ${land.id}. Tax is covered for seven days.`,
      );
    } else if (w.now >= c.closes) {
      const p = profile(w, c.by);
      money(w, p, Math.floor(c.deposit / 2), "unsuccessful challenge refund");
      r.put("profile", p);
      delete land.challenge;
      land.cooldownUntil = w.now + DAY;
    }
    r.put("claim", land);
  }
}
const PET_STEPS = 3, PET_STEP_MS = 600, PET_LEASH = 24;
const SPAWN_OFFSETS = [[0, 0], [2, 1], [-1, 2], [1, -2], [-2, -1]] as const;
/** Ability gifts; the rest of the abilities change the profile or the actor. */
export function companionFind(species: string, now: number): { item: string; quantity: number } | undefined {
  if (species === "burrowbun") return { item: "carrot_seed", quantity: 1 };
  if (species === "thistlefox") return { item: ["berry_strawberry", "berry_greenberry", "berry_blueberry"][Math.floor(now / 60000) % 3], quantity: 1 };
  if (species === "puddlefrog") return { item: "fibre", quantity: 2 };
  if (species === "bumblewisp") return { item: "resin", quantity: 1 };
  if (species === "driftgull") return { item: "driftwood", quantity: 1 };
}
const onPlotLand = (p: Location) => PLOTS.some((plot) => plot.region === p.region
  && p.x >= plot.x - 1 && p.x < plot.x + FRONTIER.sizes[2] && p.z >= plot.z - 1 && p.z < plot.z + FRONTIER.sizes[2]);
/**
 * Wild creatures amble about their home: a fresh nearby goal every few moves,
 * one step at a time, never onto water or anyone's plot. Deterministic per id.
 */
export function wildStep(c: Creature, now: number): Point | undefined {
  const species = SPECIES.find((s) => s.id === c.species);
  const home = species?.home ?? { x: c.x, z: c.z }, roam = species?.roam ?? 3;
  let seed = Math.floor(now / 9000) * 31;
  for (const ch of c.id) seed = (seed * 33 + ch.charCodeAt(0)) >>> 0;
  const pick = (n: number) => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 8) % n;
  const goal = distance(c, home) > roam ? home : { x: home.x + pick(roam * 2 + 1) - roam, z: home.z + pick(roam * 2 + 1) - roam };
  if (goal.x === c.x && goal.z === c.z) return;
  const next = { region: c.region, x: c.x + Math.sign(goal.x - c.x), z: c.z + Math.sign(goal.z - c.z) };
  if (!regionLand(c.region, next) || onPlotLand(next)) return;
  return { x: next.x, z: next.z };
}
function spawnSpot(species: (typeof SPECIES)[number], i: number): Point {
  const spots = SPAWN_OFFSETS.map(([dx, dz]) => ({ region: species.region, x: species.home.x + dx, z: species.home.z + dz }))
    .filter((p) => regionLand(p.region, p) && !onPlotLand(p));
  return spots.length ? spots[i % spots.length] : species.home;
}
export function seedCreatures(w: World) {
  const creatures = w.repo.all("creature");
  for (const species of SPECIES) {
    const wild = creatures.filter((c) => c.species === species.id && !c.owner);
    for (const c of wild) {
      if (c.region === species.region && distance(c, species.home) <= species.roam + 8) continue;
      const spot = spawnSpot(species, wild.indexOf(c));
      Object.assign(c, { region: species.region, x: spot.x, z: spot.z });
      w.repo.put("creature", c);
    }
    for (let i = wild.length; i < 3; i++) {
      const initial = `${species.id}-${i}`,
        id = w.repo.get("creature", initial) ? nextId(w, species.id) : initial;
      const spot = spawnSpot(species, i);
      w.repo.put("creature", {
        id,
        species: species.id,
        owner: "",
        trained: false,
        active: false,
        region: species.region,
        x: spot.x,
        z: spot.z,
        nextMove: w.now + 3000,
        hp: 30,
        restUntil: 0,
      });
    }
  }
}
