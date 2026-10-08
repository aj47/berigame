/**
 * The compact view of GET /state that MCP tools return to chat assistants. The full state carries the island map
 * and every rule text (tens of kilobytes); a chat model reads this instead and asks for `detail: "full"` when it
 * needs something specific. Pure, so the Worker and tests share it.
 */
type Tile = { x: number; z: number };
type State = Record<string, any>;

const NEARBY = 12;
const distance = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const tileOf = (row: any): Tile | null => row?.tile && Number.isFinite(row.tile.x) && Number.isFinite(row.tile.z) ? row.tile : null;
const nearest = <T>(rows: unknown, here: Tile, limit: number, keep: (row: any) => boolean = () => true): (T & { distance: number })[] =>
  (Array.isArray(rows) ? rows : [])
    .filter(row => tileOf(row) && keep(row))
    .map(row => ({ ...row, distance: distance(here, tileOf(row)!) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);

export interface StateSummary {
  tick: number;
  you: Record<string, unknown>;
  goal: Record<string, unknown> | null;
  objective: unknown;
  inventory: { slot: number; itemId: string; quantity: number; wielded?: true }[];
  skills: Record<string, number>;
  nearby: { players: unknown[]; nodes: unknown[]; groundItems: unknown[] };
  bosses: Record<string, unknown>;
  trade: unknown;
  chat: { from: string; text: string; nearby: boolean }[];
  notices: unknown[];
}

export function summarizeState(state: State): StateSummary {
  const player = state.player ?? {};
  const here: Tile = tileOf(player) ?? { x: 0, z: 0 };
  const names = new Map<string, string>();
  for (const p of Array.isArray(state.players) ? state.players : []) if (p?.id) names.set(p.id, p.name);
  const players = nearest<any>(state.players, here, 8, p => p.id !== player.id)
    .filter(p => p.distance <= NEARBY)
    .map(p => ({ id: p.id, name: p.name, tile: p.tile, distance: p.distance, health: p.health, maxHealth: p.maxHealth, hostile: p.hostile || undefined }));
  const nodes = nearest<any>(state.nodes, here, 8)
    .map(n => ({ id: n.id, kind: n.kind, name: n.name, tile: n.tile, distance: n.distance, gives: n.gives?.itemId, ready: n.ready, ...(n.ready ? {} : { regrowTicks: n.regrowTicks }) }));
  const groundItems = nearest<any>(state.groundItems, here, 6)
    .map(g => ({ id: g.id, itemId: g.itemId, quantity: g.quantity, tile: g.tile, distance: g.distance, ...(g.yourDeathDrop ? { yourDeathDrop: true } : {}) }));
  const giant = state.giant;
  const bosses: Record<string, unknown> = {};
  if (giant) bosses.giant = { tile: giant.tile, state: giant.state, health: giant.health, maxHealth: giant.maxHealth,
    ...(giant.asleep ? { nextWakeInSeconds: giant.nextWakeInSeconds } : {}), ...(giant.telegraph ? { telegraph: giant.telegraph } : {}) };
  if (state.clatterhorn) bosses.clatterhorn = pick(state.clatterhorn, ['state', 'health', 'maxHealth', 'telegraph', 'contribution', 'open']);
  if (state.spire && (state.spire.run || state.spire.member)) bosses.spire = pick(state.spire, ['run', 'member', 'stars', 'stage']);
  const skills: Record<string, number> = {};
  for (const s of Array.isArray(state.skills) ? state.skills : []) if (s?.id) skills[s.id] = s.level;
  return {
    tick: state.tick ?? 0,
    you: {
      id: player.id, name: player.name, tile: player.tile, health: player.health, maxHealth: player.maxHealth, alive: player.alive,
      region: player.region, area: player.area, safe: state.me?.safe, weapon: player.weapon?.itemId ?? null,
      action: player.action ?? null, destination: player.destination ?? null, load: player.load || undefined,
    },
    goal: state.goal ? pick(state.goal, ['text', 'hint', 'action', 'target', 'waiting']) : null,
    objective: state.objective ?? null,
    inventory: (Array.isArray(state.inventory) ? state.inventory : []).map((row: any) => ({ slot: row.slot, itemId: row.itemId, quantity: row.quantity, ...(row.wielded ? { wielded: true as const } : {}) })),
    skills,
    nearby: { players, nodes, groundItems },
    bosses,
    trade: state.trade ? pick(state.trade, ['id', 'with', 'withName', 'status', 'yourOffer', 'theirOffer', 'youConfirmed', 'theyConfirmed', 'swapInTicks']) : null,
    // Names and chat are untrusted player text; the tool description says so.
    chat: (Array.isArray(state.chat) ? state.chat : []).slice(-6).map((c: any) => ({ from: names.get(c.sender) ?? String(c.sender).slice(0, 8), text: c.text, nearby: !!c.nearby })),
    notices: (Array.isArray(state.notices) ? state.notices : []).slice(-5),
  };
}

/** One line a chat model can read before the JSON: where you are and what to do next. */
export function describeSummary(s: StateSummary): string {
  const you = s.you as any;
  const bag = s.inventory.length ? s.inventory.map(i => `${i.quantity} ${i.itemId}`).join(', ') : 'empty';
  const where = you.tile ? `(${you.tile.x},${you.tile.z})` : '(unknown)';
  const status = you.alive === false ? 'knocked out' : `${you.health}/${you.maxHealth} HP`;
  const goal = s.goal?.text ? ` Next goal: ${s.goal.text}` : '';
  return `${you.name ?? 'You'} at ${where} in ${you.area ?? you.region ?? 'the island'}, ${status}. Bag: ${bag}.${goal}`;
}

function pick(row: Record<string, any>, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) out[key] = row[key];
  return out;
}
