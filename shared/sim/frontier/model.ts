import type { Slot } from "../types";
import {
  DAY,
  FRONTIER,
  PLOTS,
  QUESTS,
  WEEK,
  type Location,
  type Point,
} from "./catalog";
export type Profile = {
  id: string;
  coins: number;
  xp: number[];
  active: number[];
  switchedAt: number;
  quests: string[];
  events: Record<string, number>;
  repeatDay: number;
  repeatCoins: number;
  observed: string[];
  tame: Record<string, number>;
  companion: string;
  discoveries: string[];
  recoveryReady: boolean;
  nextGather: number;
  nextAbility: number;
  nextAttack: number;
  notes: string[];
};
export type Claim = {
  id: string;
  owner: string;
  tier: number;
  paidUntil: number;
  cooldownUntil: number;
  permissions: Record<string, number>;
  challenge?: {
    by: string;
    opens: number;
    closes: number;
    heldSince: number;
    deposit: number;
    attackers: string[];
    defenders: string[];
    invited?: string[];
    lastChecked?: number;
  };
};
export type Building = Location & {
  id: string;
  claim: string;
  piece: string;
  rotation: number;
  label: string;
};
export type Container = {
  id: string;
  owner: string;
  claim?: string;
  boat?: string;
  slots: Slot[];
};
export type Creature = Location & {
  id: string;
  species: string;
  owner: string;
  trained: boolean;
  active: boolean;
  nextMove: number;
  hp: number;
  restUntil: number;
};
export type Boat = Location & {
  id: string;
  owner: string;
  permissions: Record<string, number>;
  crew: string[];
  pilot: string;
  lastPort: string;
  target?: Point;
  emptySince: number;
  nextMove?: number;
};
export type Crop = Location & {
  id: string;
  owner: string;
  ripeAt: number;
  item: string;
};
export type GroundBag = Location & {
  id: string;
  slots: Slot[];
  expiresAt: number;
};
/** A shared resource reservation and the last completed timber felling. */
export type Resource = Location & {
  id: string;
  item: string;
  harvest?: {
    by: string;
    startedAt: number;
    completesAt: number;
    origin: Point;
    hp: number;
    inputStamp?: string;
    /** Built-in starter tools are distinct from crafted upgrades. Optional for older reservations. */
    tool?: "hatchet" | "axe" | "pick" | "hands";
    quantity?: number;
  };
  felledAt?: number;
  regrowsAt?: number;
};
export type Ledger = {
  id: string;
  owner: string;
  amount: number;
  reason: string;
  at: number;
};
export type Config = {
  id: string;
  enabled: boolean;
  pausedAt: number;
  sequence: number;
};
export type EntityMap = {
  profile: Profile;
  claim: Claim;
  building: Building;
  container: Container;
  creature: Creature;
  boat: Boat;
  crop: Crop;
  ledger: Ledger;
  config: Config;
  drop: GroundBag;
  resource: Resource;
};
export type Kind = keyof EntityMap;
export interface Repository {
  changed?: Set<string>;
  get<K extends Kind>(kind: K, id: string): EntityMap[K] | undefined;
  all<K extends Kind>(kind: K): EntityMap[K][];
  put<K extends Kind>(kind: K, row: EntityMap[K]): void;
  remove(kind: Kind, id: string): void;
}
export type Actor = Location & {
  id: string;
  online: boolean;
  alive: boolean;
  hp: number;
  bag: Slot[];
  weapon: string;
  target?: Point;
  hostile: boolean;
  combat: boolean;
  inputStamp?: string;
  facing?: number;
};
export interface World {
  repo: Repository;
  now: number;
  actors: Actor[];
  save(actor: Actor): void;
  loadBag?(actor: Actor): Slot[];
  homeStepRule?(actor: Actor): (from: Location, to: Location) => boolean;
  homeBlocked?(point: Point): boolean;
  canLeaveHomeDistrict?(actor: Actor): boolean;
}
export function newProfile(id: string): Profile {
  return {
    id,
    coins: 0,
    xp: [0, 0, 0, 0, 0],
    active: [],
    switchedAt: 0,
    quests: [],
    events: {},
    repeatDay: -1,
    repeatCoins: 0,
    observed: [],
    tame: {},
    companion: "",
    discoveries: [],
    recoveryReady: false,
    nextGather: 0,
    nextAbility: 0,
    nextAttack: 0,
    notes: [],
  };
}
export function claimStatus(c: Claim, now: number) {
  return now < c.paidUntil
    ? "protected"
    : now < c.paidUntil + FRONTIER.grace
      ? "grace"
      : c.challenge
        ? now < c.challenge.opens
          ? "announced"
          : "contested"
        : "vulnerable";
}
export function renewalPrice(c: Claim, now: number, weeks: number) {
  const unpaid = Math.max(0, Math.ceil((now - c.paidUntil) / WEEK));
  return (unpaid + weeks) * FRONTIER.taxes[c.tier];
}
export const can = (c: Claim, id: string, permission: number) =>
  c.owner === id || !!((c.permissions[id] ?? 0) & permission);
export function plotFor(c: Claim) {
  const p = PLOTS.find((p) => p.id === c.id);
  if (!p) throw new Error("Unknown plot");
  return p;
}
export function questProgress(p: Profile) {
  return QUESTS.map((q, i) => ({
    ...q,
    complete: p.quests.includes(q.id),
    available: i === 0 || p.quests.includes(QUESTS[i - 1].id),
    progress: Math.min(q.amount, p.events[q.event] ?? 0),
  }));
}
export const utcDay = (now: number) => Math.floor(now / DAY);
