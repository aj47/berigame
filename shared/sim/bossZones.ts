/**
 * Boss geometry shared by the server, the browser and the agent gateway:
 * Clatterhorn's Glade on the Coast and the Sunken Spire's sealed floor in the
 * inland sea (docs: FINAL_SPEC sections 2.1, 3.2 and 3.4). Pure integer
 * constants and predicates; imports `./types` only, so `terrain.ts` can use it.
 */
import type { Tile } from './types';

export interface BossRect { x0: number; z0: number; x1: number; z1: number }

// ---- Clatterhorn's Glade ------------------------------------------------------
/** Aggro, hazards, candidates and the no-PvP zone: 17 x 17 Coast tiles. */
export const CLATTER_GLADE: BossRect = { x0: 76, z0: 98, x1: 92, z1: 114 };
/** Where Clatterhorn wakes and resets. */
export const CLATTER_HOME: Tile = { x: 84, z: 106 };
/** The 8 standing stones (static scenery blockers), knight offsets (±6,±3) and (±3,±6) from home. */
export const CLATTER_STONES: readonly Tile[] = [
  { x: 78, z: 103 }, { x: 90, z: 103 }, { x: 78, z: 109 }, { x: 90, z: 109 },
  { x: 81, z: 100 }, { x: 87, z: 100 }, { x: 81, z: 112 }, { x: 87, z: 112 },
];

// ---- The Sunken Spire -------------------------------------------------------
/** The sealed 15 x 15 floor (area 'spire'); reached only by the Spire's reducers and the tick. */
export const SPIRE_FLOOR: BossRect = { x0: 70, z0: 55, x1: 84, z1: 69 };
/** The Shardmother's dais centre. */
export const SPIRE_CENTRE: Tile = { x: 77, z: 62 };
/** The blocked 3 x 3 dais (in worldBlockedSet like the Giant's footprint). */
export const SPIRE_DAIS: readonly Tile[] = [61, 62, 63].flatMap((z) => [76, 77, 78].map((x) => ({ x, z })));
/** The Spire Gate arch on the Boulders' east cliff: a static scenery blocker. */
export const SPIRE_GATE: Tile = { x: 62, z: 45 };
/** Where members are ejected (knockout, clear, timeout, forfeit, stranded). */
export const SPIRE_EXIT: Tile = { x: 61, z: 45 };
/** The lobby: Chebyshev distance from the gate within which parties form and start. */
export const SPIRE_GATE_RANGE = 3;

// ---- The Drowned Hollow (Lanternmaw, Glimmerfen) ------------------------------
/**
 * Lanternmaw's sealed 15 x 15 floor (area 'lantern') in the strait off
 * Glimmerfen's north shore, 7+ tiles from any land: walkable land in the mask
 * (terrain.ts) but reached only by the Drowned Hollow's reducers and the tick.
 * The shared simulation (lanternmaw.ts) works in local tiles.
 */
export const LANTERN_FLOOR: BossRect = { x0: 56, z0: 129, x1: 70, z1: 143 };
/** The maw's centre (local (7,7)). */
export const LANTERN_CENTRE_TILE: Tile = { x: 63, z: 136 };
/** The blocked 3 x 3 maw (in worldBlockedSet like the Spire's dais). */
export const LANTERN_MAW: readonly Tile[] = [135, 136, 137].flatMap((z) => [62, 63, 64].map((x) => ({ x, z })));
/** The Fen Gate on Glimmerfen's north shore: a static scenery blocker. */
export const LANTERN_GATE: Tile = { x: 47, z: 152 };
/** Where members are ejected (knockout, clear, timeout, forfeit, stranded). */
export const LANTERN_EXIT: Tile = { x: 47, z: 153 };
/** The lobby: Chebyshev distance from the gate within which parties form and start. */
export const LANTERN_GATE_RANGE = 3;

export function inLanternFloor(t: Tile): boolean {
  return Number.isInteger(t.x) && Number.isInteger(t.z) && inBossRect(t, LANTERN_FLOOR);
}

/** A floor tile a player can stand on: the floor minus the maw (216 tiles). */
export function lanternStandable(t: Tile): boolean {
  return inLanternFloor(t) && !(Math.abs(t.x - LANTERN_CENTRE_TILE.x) <= 1 && Math.abs(t.z - LANTERN_CENTRE_TILE.z) <= 1);
}

/** The Fen Gate zone: lobby tiles, no PvP. */
export function inLanternGateZone(t: Tile): boolean {
  return Math.max(Math.abs(t.x - LANTERN_GATE.x), Math.abs(t.z - LANTERN_GATE.z)) <= LANTERN_GATE_RANGE;
}

/** Either sealed boss floor (the Sunken Spire or the Drowned Hollow). */
export function inSealedFloor(t: Tile): boolean {
  return inSpireFloor(t) || inLanternFloor(t);
}

export function inBossRect(t: Tile, r: BossRect): boolean {
  return t.x >= r.x0 && t.x <= r.x1 && t.z >= r.z0 && t.z <= r.z1;
}

export function inClatterGlade(t: Tile): boolean {
  return inBossRect(t, CLATTER_GLADE);
}

/** Integer tiles inside SPIRE_FLOOR (the dais included); false for fractional coordinates. */
export function inSpireFloor(t: Tile): boolean {
  return Number.isInteger(t.x) && Number.isInteger(t.z) && inBossRect(t, SPIRE_FLOOR);
}

/** A floor tile a player can stand on: the floor minus the dais (216 tiles). */
export function spireStandable(t: Tile): boolean {
  return inSpireFloor(t) && !(Math.abs(t.x - SPIRE_CENTRE.x) <= 1 && Math.abs(t.z - SPIRE_CENTRE.z) <= 1);
}

/** The gate zone: lobby tiles, no PvP, not counted as Giant raiders. */
export function inSpireGateZone(t: Tile): boolean {
  return Math.max(Math.abs(t.x - SPIRE_GATE.x), Math.abs(t.z - SPIRE_GATE.z)) <= SPIRE_GATE_RANGE;
}

/**
 * One visibility rule for every surface (avatars, chat bubbles, combat FX,
 * /state.players, WebMCP), for both sealed floors: a player on a floor is seen only by members of
 * the same run who are also on the floor; an overworld viewer never sees floor
 * players; a viewer on the floor sees only its own run. `sameRun` = both
 * identities belong to the same spire_run or the same lantern_run. Both tiles are Bramblewild tiles
 * (callers skip players in other regions).
 */
export function spireSeesPlayer(viewer: Tile, other: Tile, sameRun: boolean): boolean {
  // Both sealed floors (the Spire and the Drowned Hollow) follow the same rule; `sameRun` covers either run table.
  const viewerInside = inSealedFloor(viewer);
  if (inSealedFloor(other)) return viewerInside && sameRun && inSpireFloor(viewer) === inSpireFloor(other);
  return !viewerInside;
}
