// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {
  constructor(public ctx: any, public env: any) {}
} }));
vi.mock('../../cloudflare/codecs', () => ({}));
vi.mock('../../cloudflare/socket', () => ({ openCloudflareSocket: vi.fn() }));
vi.mock('../../agent-api/game', () => ({ createGameService: vi.fn(), deadline: (promise: Promise<any>) => promise }));
import worker, { AgentGateway } from '../../cloudflare/worker';
import { createGameService } from '../../agent-api/game';
import { ACTIONS } from '../../agent-api/contract';
import { VIEW_URI } from '../../cloudflare/mcp';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.useRealTimers(); vi.clearAllMocks(); });

const sampleState = (tile = { x: 25, z: 25 }) => ({
  tick: 120,
  player: { id: 'a'.repeat(64), name: 'Pip', tile, health: 18, maxHealth: 30, alive: true, region: 'bramblewild', area: 'grove', weapon: null },
  me: { safe: true },
  goal: { text: 'Harvest a berry', hint: 'Walk to a tree', action: 'harvest' },
  inventory: [{ slot: 0, itemId: 'stick', quantity: 1, wielded: true }],
  players: [{ id: 'a'.repeat(64), name: 'Pip', tile }, { id: 'b'.repeat(64), name: 'Moss', tile: { x: 27, z: 25 }, health: 30, maxHealth: 30 }],
  nodes: [{ id: 9, kind: 'berry', name: 'Berry tree', tile: { x: 40, z: 40 }, gives: { itemId: 'redberry' }, ready: true }, { id: 3, kind: 'berry', name: 'Berry tree', tile: { x: 26, z: 26 }, gives: { itemId: 'redberry' }, ready: false, regrowTicks: 4 }],
  groundItems: [], chat: [{ sender: 'b'.repeat(64), text: 'hi', tick: 100, nearby: true }], notices: [],
  world: { map: { rows: ['~'.repeat(128)] } },
});

function fixture() {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  const sql = { exec(query: string, ...args: any[]) {
    const rows = db.prepare(query).all(...args);
    return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
  } };
  let identity = 0;
  const session = { state: vi.fn(() => sampleState()), action: vi.fn(async () => ({ destination: { x: 30, z: 22 } })), suspend: vi.fn(), close: vi.fn() };
  const service = { ready: () => true, close: vi.fn(),
    provision: vi.fn(async () => ({ identity: (++identity).toString(16).padStart(64, '0'), token: 'character-token', uri: 'wss://test', database: 'test' })),
    renew: vi.fn(async () => {}), revoke: vi.fn(async () => {}), suspend: vi.fn(async () => {}),
    resume: vi.fn(async () => session),
  };
  vi.mocked(createGameService).mockResolvedValue(service as any);
  const env: any = { GATEWAY_CREDENTIAL: JSON.stringify({ uri: 'wss://test', database: 'test' }), SPACETIME_URI: 'wss://test', SPACETIME_DB: 'test', PUBLIC_ORIGIN: 'https://game.test',
    EDGE_LIMIT: { limit: vi.fn(async () => ({ success: true })) }, ADMIN_TOKEN: 'operator-test',
    ASSETS: { fetch: vi.fn(async () => new Response('# BeriGame agent instructions')) } };
  const gateway = new AgentGateway({ storage: { sql, transactionSync: (fn: () => unknown) => fn(), setAlarm: vi.fn(), deleteAlarm: vi.fn(), sync: vi.fn() } } as any, env);
  env.AGENT_GATEWAY = { idFromName: () => 'test', get: () => gateway };
  let id = 0;
  const rpc = async (method: string, params: unknown = {}, headers: Record<string, string> = {}) => {
    const response = await worker.fetch(new Request('https://game.test/mcp', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) }), env);
    return { status: response.status, body: await response.json() as any };
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => (await rpc('tools/call', { name, arguments: args })).body.result;
  return { sql, session, service, env, rpc, call };
}

describe('BeriGame MCP server', () => {
  it('initializes and lists play tools, the sidebar entrypoint and the live view', async () => {
    const f = fixture();
    const init = await f.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(init.status).toBe(200);
    expect(init.body.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'berigame' }, capabilities: { tools: {}, resources: {} } });
    const { tools } = (await f.rpc('tools/list')).body.result;
    const byName = Object.fromEntries(tools.map((t: any) => [t.name, t]));
    expect(Object.keys(byName)).toEqual(expect.arrayContaining(['join_game', 'look', 'act', 'check_danger', 'game_guide', 'show_live_view', 'leave_game', 'open_berigame', 'live_view_state']));
    expect(byName.act.inputSchema.properties.action.enum).toEqual(Object.keys(ACTIONS));
    expect(byName.open_berigame._meta).toMatchObject({ ui: { resourceUri: VIEW_URI, visibility: ['app'] }, 'openai/ui': { entrypoints: [{ type: 'global' }] } });
    expect(byName.look.annotations.readOnlyHint).toBe(true);
    const view = (await f.rpc('resources/read', { uri: VIEW_URI })).body.result.contents[0];
    expect(view.mimeType).toBe('text/html;profile=mcp-app');
    expect(view.text).toContain('ui/initialize');
  });

  it('answers notifications with 202 and rejects other methods and browser origins', async () => {
    const f = fixture();
    const note = await worker.fetch(new Request('https://game.test/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }), f.env);
    expect(note.status).toBe(202);
    expect((await worker.fetch(new Request('https://game.test/mcp'), f.env)).status).toBe(405);
    expect((await f.rpc('ping', {}, { Origin: 'https://evil.test' })).status).toBe(403);
    expect((await f.rpc('ping', {}, { Origin: 'https://chatgpt.com' })).status).toBe(200);
  });

  it('joins with a player_key that never exposes the game tokens, then acts through the agent API', async () => {
    const f = fixture();
    const joined = await f.call('join_game', { name: 'Pip' });
    const key = joined.structuredContent.player_key;
    expect(key).toMatch(/^bgm_/);
    expect(joined.content[0].text).toContain('Pip at (25,25)');
    expect(JSON.stringify(joined)).not.toMatch(/bgs_|bgr_/);
    const stored = f.sql.exec('SELECT payload FROM mcp_players').toArray() as any[];
    expect(stored).toHaveLength(1);
    expect(stored[0].payload).not.toMatch(/bgs_|bgr_/);
    expect(f.session.action).toHaveBeenCalledWith('name', { name: 'Pip' });

    const moved = await f.call('act', { player_key: key, action: 'move', args: { x: 30, z: 22 } });
    expect(moved.isError).toBeUndefined();
    expect(f.session.action).toHaveBeenLastCalledWith('move', { x: 30, z: 22 });
    expect(moved.structuredContent.receipt).toEqual({ action: 'move', destination: { x: 30, z: 22 } });
    expect(moved.structuredContent.state.nearby.nodes[0]).toMatchObject({ id: 3, distance: 1 });

    const rejected = await f.call('act', { player_key: key, action: 'move', args: { x: 'far' } });
    expect(rejected.isError).toBe(true);
  });

  it('renews an idle-logged-out character transparently and keeps the same player_key', async () => {
    const f = fixture();
    const key = (await f.call('join_game')).structuredContent.player_key;
    // Ten idle minutes: the gateway reaps the session; the renewal token still returns the character.
    f.sql.exec('UPDATE sessions SET last_seen = ?', Date.now() - 11 * 60_000);
    const look = await f.call('look', { player_key: key });
    expect(look.isError).toBeUndefined();
    expect(f.service.renew).toHaveBeenCalledWith('1'.padStart(64, '0'), 3600, true);
    expect((await f.call('look', { player_key: key })).isError).toBeUndefined();
  });

  it('reports unknown keys and forgets a key after leave_game', async () => {
    const f = fixture();
    expect((await f.call('look', { player_key: 'bgm_' + 'x'.repeat(43) })).isError).toBe(true);
    expect((await f.call('look', {})).content[0].text).toContain('join_game');
    const key = (await f.call('join_game')).structuredContent.player_key;
    expect((await f.call('leave_game', { player_key: key })).isError).toBeUndefined();
    expect(f.sql.exec('SELECT * FROM mcp_players').toArray()).toHaveLength(0);
    expect((await f.call('look', { player_key: key })).isError).toBe(true);
  });

  it('feeds the live view with player_key in _meta and serves the guide', async () => {
    const f = fixture();
    const key = (await f.call('join_game')).structuredContent.player_key;
    const shown = await f.call('show_live_view', { player_key: key });
    expect(shown._meta.player_key).toBe(key);
    expect(shown.structuredContent.view).toMatchObject({ region: 'bramblewild', players: [{ name: 'Moss', tile: { x: 27, z: 25 } }] });
    expect((await f.call('open_berigame')).structuredContent).toEqual({ launcher: true });
    expect((await f.call('game_guide')).content[0].text).toContain('BeriGame agent instructions');
    expect((await f.call('game_guide', { action: 'move' })).content[0].text).toContain('args schema');
    const full = await f.call('look', { player_key: key, detail: 'full' });
    expect(JSON.parse(full.content[0].text).world.map.rows).toHaveLength(1);
  });
});
