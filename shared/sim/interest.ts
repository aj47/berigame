/**
 * Interest management: what part of the world a client subscribes to.
 *
 * Fast-changing rows (players moving every tick, nodes being claimed, ground
 * items, place-bound events) are only sent to clients near them. The map is
 * cut into square chunks ("cells") and every such row carries the id of the
 * cell it is in (`cell` column, cellAt below). A client subscribes one query
 * per cell, `WHERE cell = K`, for a block of cells around itself.
 *
 * Why one equality per cell and not a box (`x >= .. AND x < ..`): SpacetimeDB
 * prunes subscription queries only by a single-column equality (or an index
 * point lookup, and joins whose other side is one). For every changed row it
 * looks up the queries subscribed with that row's value and evaluates only
 * those; every other query is evaluated for every changed row of its table.
 * With boxes, each step of each walker was checked against every distinct
 * block of every client (hundreds of queries); with cells it is checked
 * against the one or two cells it left and entered (docs/LOAD_TEST.md).
 * Clients in the same cell send the same query text, so each query is
 * evaluated once for all of them, and a block moving by a chunk subscribes
 * only its new edge cells and drops the old ones.
 *
 * A block is (2 * radius + 1)^2 chunks centred on the client's chunk. It is
 * kept while the client stays within radius - 1 chunks of its centre plus
 * `slack` tiles, so a client walking along a chunk border or wandering
 * around one spot does not resubscribe back and forth, and it always has at
 * least one chunk minus `slack` tiles of margin.
 *
 * Both blocks are 3 x 3 cells: every cell is one subscription, and each one
 * costs the server a transaction to add or drop and a result to fan out per
 * client per transaction, so fewer, larger cells cost less than 5 x 5 small
 * ones covering the same area (docs/LOAD_TEST.md). The size is per kind
 * (BlockSpec):
 * - nodes and ground items (NODE_BLOCK): 3 x 3 chunks of 54 tiles (162 tiles,
 *   at least 32 tiles of margin). They change rarely, and the client draws
 *   and pathfinds around them.
 * - players (PLAYER_BLOCK): 3 x 3 chunks of 27 tiles (81 tiles, at least 16
 *   tiles of margin). Every walker's step is an update to every client whose
 *   block holds it, so this block decides most of the bandwidth: on the 256
 *   map a 160-tile block holds ~75 % of uniformly spread players, an 80-tile
 *   one ~30 % (docs/LOAD_TEST.md).
 * - place-bound events (combat, dummy, emote, giant; EVENT_TABLES) use the
 *   player block's cells: an event is about a character or an object at that
 *   spot, and characters further away are not in your cache to show it on.
 *   Rows about no place carry GLOBAL_CELL and are subscribed by everyone.
 *
 * Players come as two queries per cell over the narrow `player_pos` table (one
 * row per online character, rewritten for each step;
 * spacetimedb/src/lib/playerStore.ts): the positions themselves, and the full
 * `player` rows of the same characters through a join on it, which the server
 * re-sends only when a `player` row changes or a character enters or leaves
 * the cell, not for a step.
 *
 * Shared by the server (it writes the cells), the browser, the agent gateway
 * and the load test.
 */
import { GRID_SIZE } from './constants';

export interface BlockSpec {
  /** Chunk edge in tiles. */
  chunk: number;
  /** Chunks on each side of the centre chunk. */
  radius: number;
  /** Tiles a client may stray past the kept chunks before the block recentres (default 0). */
  slack?: number;
}

/** Nodes and ground items: 3 x 3 chunks of 54 tiles, recentred 22 tiles into a neighbour chunk (32 tiles of margin). */
export const NODE_BLOCK: BlockSpec = { chunk: 54, radius: 1, slack: 22 };
/** Players (and place-bound events): 3 x 3 chunks of 27 tiles, recentred 11 tiles into a neighbour chunk (16 tiles of margin). */
export const PLAYER_BLOCK: BlockSpec = { chunk: 27, radius: 1, slack: 11 };

/** The node block's chunk and radius (older callers). */
export const INTEREST_CHUNK = NODE_BLOCK.chunk;
export const INTEREST_RADIUS = NODE_BLOCK.radius;
/** How far from you another player is still in your player block, at the least (its margin is one chunk more). */
export const PLAYER_VIEW_TILES = PLAYER_BLOCK.chunk * PLAYER_BLOCK.radius;

/** Tables filtered by position; everything else is either small or the client's own. */
export const SPATIAL_TABLES = ['player_pos', 'player', 'tree', 'ground_item'] as const;
export type SpatialTable = (typeof SPATIAL_TABLES)[number];

/** Region-local grid size: Bramblewild is the 256 map, every frontier region is 128. */
export function regionSize(region: string): number {
  return region === 'bramblewild' ? GRID_SIZE : 128;
}

export interface InterestBlock {
  region: string;
  spec: BlockSpec;
  /** Centre chunk. */
  cx: number;
  cz: number;
  /** Tile bounds, inclusive minimum and exclusive maximum, clamped to the region. */
  x0: number; x1: number; z0: number; z1: number;
}

export function chunkOf(v: number, chunk = INTEREST_CHUNK): number {
  return Math.floor(v / chunk);
}

export function interestBlock(region: string, cx: number, cz: number, spec: BlockSpec = NODE_BLOCK): InterestBlock {
  const size = regionSize(region);
  const clamp = (v: number) => Math.max(0, Math.min(size, v));
  const { chunk, radius } = spec;
  return {
    region, spec, cx, cz,
    x0: clamp((cx - radius) * chunk), x1: clamp((cx + radius + 1) * chunk),
    z0: clamp((cz - radius) * chunk), z1: clamp((cz + radius + 1) * chunk),
  };
}

/**
 * The block a client at `p` should hold, given the one it holds now. Keeps
 * `current` while `p` is in the same region and within radius - 1 chunks of
 * its centre, plus `slack` tiles; otherwise recentres on `p`'s chunk. `spec`
 * defaults to `current`'s, else the node block.
 */
export function nextInterestBlock(p: { region?: string; x: number; z: number }, current?: InterestBlock, spec: BlockSpec = current?.spec ?? NODE_BLOCK): InterestBlock {
  const region = p.region || 'bramblewild';
  const cx = chunkOf(p.x, spec.chunk), cz = chunkOf(p.z, spec.chunk);
  if (current && current.region === region && current.spec.chunk === spec.chunk && current.spec.radius === spec.radius) {
    const keep = Math.max(0, spec.radius - 1), slack = spec.slack ?? 0, c = spec.chunk;
    const near = (v: number, centre: number) => v >= (centre - keep) * c - slack && v < (centre + keep + 1) * c + slack;
    if (near(p.x, current.cx) && near(p.z, current.cz)) return current;
  }
  return interestBlock(region, cx, cz, spec);
}

/** Whether a tile is inside a block (for tests and for pruning stale rows). */
export function inInterestBlock(b: InterestBlock, t: { region?: string; x: number; z: number }): boolean {
  return (t.region ?? b.region) === b.region && t.x >= b.x0 && t.x < b.x1 && t.z >= b.z0 && t.z < b.z1;
}

/** The box of a block as SQL, optionally on a table alias (tests, owner SQL; subscriptions use cells). */
export function boxSql(b: InterestBlock, alias = ''): string {
  const c = alias ? `${alias}.` : '';
  return `${c}x >= ${b.x0} AND ${c}x < ${b.x1} AND ${c}z >= ${b.z0} AND ${c}z < ${b.z1}`;
}

// ---- Cells ----------------------------------------------------------------------

/**
 * Regions in cell ids, by index. Append only: a stored cell id encodes its
 * region's index. A region missing here shares the last index (UNKNOWN_REGION).
 */
export const CELL_REGIONS = ['bramblewild', 'settlement', 'reedwake', 'cinder', 'sea'] as const;
const UNKNOWN_REGION = 255;
/** Chunks per region side a cell id can hold (64 x 27 = 1728 tiles). */
const CELL_SPAN = 64;
/** The cell of rows about no place (world-wide events), subscribed by every client. */
export const GLOBAL_CELL = 0;

/** A cell id (a u32): 1 + region index, then the chunk's z and x. Never GLOBAL_CELL. */
export function cellId(region: string, cx: number, cz: number): number {
  const i = (CELL_REGIONS as readonly string[]).indexOf(region || 'bramblewild');
  const r = i < 0 ? UNKNOWN_REGION : i;
  const c = (v: number) => Math.max(0, Math.min(CELL_SPAN - 1, v));
  return 1 + (r * CELL_SPAN + c(cz)) * CELL_SPAN + c(cx);
}

/** The cell of a tile on a block spec's chunk grid. */
export function cellAt(region: string | undefined, x: number, z: number, spec: BlockSpec): number {
  return cellId(region || 'bramblewild', chunkOf(Math.max(0, x), spec.chunk), chunkOf(Math.max(0, z), spec.chunk));
}

/** player_pos.cell: the character's cell on the player grid. */
export const playerCell = (region: string | undefined, x: number, z: number) => cellAt(region, x, z, PLAYER_BLOCK);
/** tree.cell and ground_item.cell (Bramblewild only): the node grid. */
export const nodeCell = (x: number, z: number) => cellAt('bramblewild', x, z, NODE_BLOCK);
/** The cell column of a place-bound event: the player grid, GLOBAL_CELL for none (x < 0). */
export const eventCell = (region: string | undefined, x: number, z: number) => (x < 0 || z < 0 ? GLOBAL_CELL : playerCell(region, x, z));

/** The cells of a block that lie in its region, row by row. */
export function blockCells(b: InterestBlock): number[] {
  const { chunk, radius } = b.spec;
  const n = Math.ceil(regionSize(b.region) / chunk);
  const out: number[] = [];
  for (let cz = Math.max(0, b.cz - radius); cz <= Math.min(n - 1, b.cz + radius); cz++)
    for (let cx = Math.max(0, b.cx - radius); cx <= Math.min(n - 1, b.cx + radius); cx++) out.push(cellId(b.region, cx, cz));
  return out;
}

/** Place-bound event tables: a `cell` column (eventCell), GLOBAL_CELL for world-wide rows. */
export const EVENT_TABLES = ['combat_event', 'dummy_event', 'emote_event', 'giant_event'] as const;

/** One node cell's queries (tree, ground_item). */
export function nodeCellQueries(cell: number): string[] {
  return [`SELECT * FROM tree WHERE cell = ${cell}`, `SELECT * FROM ground_item WHERE cell = ${cell}`];
}

/**
 * One player cell's queries: the online characters' positions in it, and
 * their `player` rows through a join (re-sent only when one changes, not for
 * a step). Offline characters have no player_pos row, so they are left out:
 * nobody needs to see them.
 */
export function playerCellQueries(cell: number): string[] {
  return [
    `SELECT * FROM player_pos WHERE cell = ${cell}`,
    `SELECT p.* FROM player p JOIN player_pos q ON p.identity = q.identity WHERE q.cell = ${cell}`,
  ];
}

/** One cell's place-bound events (a player-grid cell, or GLOBAL_CELL for the world-wide ones). */
export function eventCellQueries(cell: number, tables: readonly string[] = EVENT_TABLES): string[] {
  return tables.map((t) => `SELECT * FROM ${t} WHERE cell = ${cell}`);
}

/** Kinds of cell group: node cells, player cells, event cells, or `local` (a player cell's players and events in one). */
export type CellKind = 'nodes' | 'players' | 'events' | 'local';

/**
 * The subscription groups of a block, one per cell: key `<kind>:<cell>` to its
 * queries. `local` puts a player cell's player and event queries in one
 * group (one subscription per cell around you instead of two: a subscription
 * costs the server a transaction). Nodes exist only in Bramblewild (frontier
 * regions keep theirs in frontier_object), so other regions' node blocks
 * have none.
 */
export function blockGroups(b: InterestBlock | undefined, kind: CellKind): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!b || (kind === 'nodes' && b.region !== 'bramblewild')) return out;
  for (const cell of blockCells(b)) {
    const queries = kind === 'nodes' ? nodeCellQueries(cell)
      : kind === 'players' ? playerCellQueries(cell)
      : kind === 'events' ? eventCellQueries(cell)
      : [...playerCellQueries(cell), ...eventCellQueries(cell)];
    out.set(`${kind}:${cell}`, queries);
  }
  return out;
}
