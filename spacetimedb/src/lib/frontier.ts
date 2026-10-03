import { isHomeTarget } from "../../../shared/sim/frontier/homeMap";
import { blockedTiles } from "./blocked";
import { playerEnterRule } from "./brambles";
import { carrying, duelFor } from "./adventure";
import { Identity } from "spacetimedb";
import { SenderError } from "spacetimedb/server";
import {
  advance,
  seedCreatures,
  maxHealth,
  cancelGathering,
} from "../../../shared/sim/frontier/engine";
import {
  can,
  newProfile,
  type Actor,
  type EntityMap,
  type Kind,
  type Repository,
  type World,
} from "../../../shared/sim/frontier/model";
import { PORTS, type RegionId } from "../../../shared/sim/frontier/catalog";
import { readSlots, writeSlots } from "./inventory";
import { canPlay } from "./access";
import type { Ctx } from "./types";
const PUBLIC = new Set<Kind>([
  "claim",
  "building",
  "creature",
  "boat",
  "crop",
  "drop",
  "resource",
]);
/** Small entities persist separately; inventories, wallets and audit records never enter public rows. */
export function frontierRepository(ctx: Ctx): Repository {
  const table = (kind: Kind) =>
    PUBLIC.has(kind) ? ctx.db.frontierObject : ctx.db.frontierPrivate;
  const cache = new Map<Kind, Map<string, any>>();
  const rows = (kind: Kind) => {
    let found = cache.get(kind);
    if (!found) {
      found = new Map(
        Array.from(table(kind).kind.filter(kind)).map((row) => {
          const value = JSON.parse(row.data);
          return [value.id, value];
        }),
      );
      cache.set(kind, found);
    }
    return found;
  };
  const changed = new Set<string>();
  return {
    changed,
    get(kind, id) {
      if (cache.has(kind)) return cache.get(kind)!.get(id);
      const row = table(kind).key.find(`${kind}:${id}`);
      return row ? JSON.parse(row.data) : undefined;
    },
    all(kind) {
      return Array.from(rows(kind).values());
    },
    put(kind, value) {
      cache.get(kind)?.set(value.id, value);
      const key = `${kind}:${value.id}`,
        data = JSON.stringify(value),
        t = table(kind),
        before = t.key.find(key);
      if (before?.data === data) return;
      changed.add(key);
      const row = {
        key,
        kind,
        data,
        ...(PUBLIC.has(kind) ? { region: (value as any).region ?? "" } : {}),
      };
      if (before) t.key.update(row as any);
      else t.insert(row as any);
    },
    remove(kind, id) {
      cache.get(kind)?.delete(id);
      changed.add(`${kind}:${id}`);
      table(kind).key.delete(`${kind}:${id}`);
    },
  };
}
export function frontierWorld(ctx: Ctx): World {
  const repo = frontierRepository(ctx);
  const actors: Actor[] = Array.from(ctx.db.player.iter()).map((p) => ({
    id: p.identity.toHexString(),
    region: (p.region || "bramblewild") as RegionId,
    x: p.x,
    z: p.z,
    online: p.online && canPlay(ctx, p.identity),
    alive: p.state === 0,
    hp: p.hp,
    bag: [],
    weapon: p.weapon,
    facing: p.facing,
    inputStamp: `${p.lastInputTick}:${p.inputsThisTick}`,
    target:
      p.targetX === undefined ? undefined : { x: p.targetX, z: p.targetZ! },
    hostile: p.hostile,
    combat:
      ctx.db.playerGrant.identity.find(p.identity)?.combat ??
      !ctx.db.accessPolicy.id.find(0)?.requireAdmission,
  }));
  let homeObstacles: Set<number> | undefined;
  return {
    repo,
    now: Number(ctx.timestamp.microsSinceUnixEpoch / 1000n),
    actors,
    loadBag(a) { return readSlots(ctx, Identity.fromString(a.id)).slots; },
    homeBlocked(point) { return (homeObstacles ??= blockedTiles(ctx)).has(point.z * 64 + point.x); },
    homeStepRule(a) {
      const row = ctx.db.player.identity.find(Identity.fromString(a.id))!;
      const rule = playerEnterRule(ctx, row);
      return (from, to) => to.region !== "bramblewild" || rule(from.region === "bramblewild" ? from : { x: 63, z: 25 }, to);
    },
    canLeaveHomeDistrict(a) {
      const identity = Identity.fromString(a.id);
      const now = Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);
      return now >= (repo.get('profile', a.id)?.events.hostileUntil ?? 0)
        && !ctx.db.expeditionMember.identity.find(identity) && !duelFor(ctx, identity) && !carrying(ctx, identity);
    },
    movementSteps(a) {
      const identity = Identity.fromString(a.id), row = ctx.db.player.identity.find(identity);
      if (carrying(ctx, identity)) return 1;
      const p = repo.get('profile', a.id), now = Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);
      if (a.hostile || row?.combatTarget || (p?.events.hostileUntil ?? 0) > now || (p?.nextAttack ?? 0) > now
        || duelFor(ctx, identity) || ctx.db.expeditionMember.identity.find(identity)) return 2;
      return 3;
    },
    save(a) {
      const identity = Identity.fromString(a.id),
        p = ctx.db.player.identity.find(identity);
      if (!p) return;
      const next = {
        ...p,
        region: a.region,
        state: a.alive ? 0 : 1,
        respawnTick:
          !a.alive && p.state === 0
            ? (ctx.db.world.id.find(0)?.tick ?? 0) + 5
            : p.respawnTick,
        x: a.x,
        z: a.z,
        hp: Math.max(
          0,
          Math.min(
            maxHealth(repo.get("profile", a.id) ?? newProfile(a.id), {
              ...a,
              bag: a.bag.length ? a.bag : readSlots(ctx, identity).slots,
            }),
            Math.floor(a.hp),
          ),
        ),
        maxHp: maxHealth(repo.get("profile", a.id) ?? newProfile(a.id), {
          ...a,
          bag: a.bag.length ? a.bag : readSlots(ctx, identity).slots,
        }),
        weapon: a.weapon,
        facing: a.facing ?? p.facing,
        targetX: a.target?.x,
        targetZ: a.target?.z,
      };
      if (
        [
          "region",
          "state",
          "respawnTick",
          "x",
          "z",
          "hp",
          "maxHp",
          "weapon",
          "facing",
          "targetX",
          "targetZ",
        ].some((key) => (next as any)[key] !== (p as any)[key])
      )
        ctx.db.player.identity.update(next);
      if (a.bag.length)
        writeSlots(ctx, identity, readSlots(ctx, identity), a.bag);
    },
  };
}
/** Rebuild authorized projections in the same transaction as permission/storage changes. */
export function projectFrontier(ctx: Ctx, repo = frontierRepository(ctx)) {
  const changes = repo.changed ?? new Set<string>();
  const profiles = [...changes]
    .filter((key) => key.startsWith("profile:"))
    .map((key) => key.slice(8));
  const containers = new Set(
    [...changes]
      .filter((key) => key.startsWith("container:"))
      .map((key) => key.slice(10)),
  );
  const changedClaims = new Set(
    [...changes]
      .filter((key) => key.startsWith("claim:"))
      .map((key) => key.slice(6)),
  );
  const changedBoats = new Set(
    [...changes]
      .filter((key) => key.startsWith("boat:"))
      .map((key) => key.slice(5)),
  );
  if (changedClaims.size || changedBoats.size)
    for (const c of repo.all("container"))
      if (
        (c.claim && changedClaims.has(c.claim)) ||
        (c.boat && changedBoats.has(c.boat))
      )
        containers.add(c.id);
  const publish = (
    source: string,
    kind: string,
    id: string,
    owners: string[],
    value: unknown,
  ) => {
    const wanted = new Set(owners.map((owner) => `${owner}:${source}`));
    for (const row of ctx.db.frontierView.source.filter(source))
      if (!wanted.has(row.key)) ctx.db.frontierView.key.delete(row.key);
    for (const owner of owners) {
      const key = `${owner}:${source}`,
        data = JSON.stringify(value),
        old = ctx.db.frontierView.key.find(key);
      if (old?.data === data && old.source === source) continue;
      const row = {
        key,
        source,
        owner: Identity.fromString(owner),
        kind,
        data,
      };
      if (old) ctx.db.frontierView.key.update(row);
      else ctx.db.frontierView.insert(row);
    }
  };
  for (const id of profiles) {
    const p = repo.get("profile", id);
    publish(`profile:${id}`, "profile", id, p ? [id] : [], p);
  }
  for (const id of containers) {
    const c = repo.get("container", id),
      readers = new Set<string>();
    if (c) {
      readers.add(c.owner);
      if (c.claim) {
        const land = repo.get("claim", c.claim);
        readers.clear();
        if (land) {
          readers.add(land.owner);
          for (const [id, mask] of Object.entries(land.permissions))
            if (mask & 2) readers.add(id);
        }
      }
      if (c.boat) {
        const boat = repo.get("boat", c.boat);
        if (boat)
          for (const [id, mask] of Object.entries(boat.permissions))
            if (mask & 4) readers.add(id);
      }
    }
    publish(`container:${id}`, "container", id, [...readers], c);
  }
  if (changes.has("config:world")) {
    const cfg = repo.get("config", "world")!;
    const key = "config:world",
      data = JSON.stringify({ enabled: cfg.enabled, pausedAt: cfg.pausedAt });
    const old = ctx.db.frontierObject.key.find(key);
    if (old?.data !== data) {
      const row = { key, kind: "config", region: "", data };
      if (old) ctx.db.frontierObject.key.update(row);
      else ctx.db.frontierObject.insert(row);
    }
  }
}

export function ensureFrontierProfile(ctx: Ctx, repo: Repository) {
  const id = ctx.sender.toHexString();
  if (repo.get("profile", id)) return;
  const p = newProfile(id),
    legacy = ctx.db.playerSkill.identity.find(ctx.sender),
    paths = ctx.db.adventureProfile.identity.find(ctx.sender);
  p.xp = [
    paths?.fightingXp ?? 0,
    Math.max(paths?.growingXp ?? 0, legacy?.foragingXp ?? 0),
    Math.max(paths?.buildingXp ?? 0, legacy?.craftingXp ?? 0),
    paths?.befriendingXp ?? 0,
    Math.max(paths?.exploringXp ?? 0, legacy?.beachcombingXp ?? 0),
  ];
  repo.put("profile", p);
}
export function tickFrontier(ctx: Ctx) {
  const repo = frontierRepository(ctx);
  if (!repo.get("config", "world")?.enabled) return;
  const w = frontierWorld(ctx);
  advance(w);
  if (w.repo.changed?.size) projectFrontier(ctx, w.repo);
}
export function configureFrontier(ctx: Ctx, enabled: boolean, pause: boolean) {
  const policy = ctx.db.accessPolicy.id.find(0);
  if (policy?.owner.toHexString() !== ctx.sender.toHexString())
    throw new SenderError("World owner required");
  const w = frontierWorld(ctx),
    cfg = w.repo.get("config", "world") ?? {
      id: "world",
      enabled: false,
      pausedAt: 0,
      sequence: 0,
    };
  pause = pause || !enabled;
  if (cfg.pausedAt && !pause) {
    const shift = w.now - cfg.pausedAt;
    for (const land of w.repo.all("claim")) {
      land.paidUntil += shift;
      if (land.challenge) {
        land.challenge.opens += shift;
        land.challenge.closes += shift;
        land.challenge.heldSince = 0;
      }
      w.repo.put("claim", land);
    }
  }
  cfg.enabled = enabled;
  cfg.pausedAt = pause ? cfg.pausedAt || w.now : 0;
  w.repo.put("config", cfg);
  if (enabled) seedCreatures(w);
  else {
    for (const actor of w.actors) cancelGathering(w, actor.id);
    // Keep property intact, freeze upkeep and return stranded characters safely.
    for (const boat of w.repo.all("boat")) {
      const port = PORTS.find((p) => p.region === boat.lastPort)!;
      Object.assign(boat, {
        region: port.region,
        x: port.x,
        z: port.z,
        crew: [],
        pilot: "",
        target: undefined,
        emptySince: 0,
      });
      w.repo.put("boat", boat);
    }
    for (const actor of w.actors)
      if (actor.region !== "bramblewild") {
        Object.assign(actor, {
          region: "bramblewild",
          x: 22,
          z: 18,
          target: undefined,
        });
        w.save(actor);
      } else if (isHomeTarget(actor.target)) {
        actor.target = undefined;
        w.save(actor);
      }
  }
  // Backfill projections when migrating an earlier expansion build.
  for (const row of ctx.db.frontierView.iter())
    if (!row.source) {
      ctx.db.frontierView.key.update({
        ...row,
        source: `${row.kind}:${JSON.parse(row.data).id}`,
      });
    }
  projectFrontier(ctx, w.repo);
}
