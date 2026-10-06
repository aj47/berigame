import { beforeEach, describe, expect, it, vi } from 'vitest';
const test = vi.hoisted(() => ({ callbacks: {} as Record<string, any>, token: undefined as string | undefined, subscribe: vi.fn(), loading: { setConnectionIssue: vi.fn(), setWebsocketConnected: vi.fn(), setGameDataLoaded: vi.fn(), setLoadingMessage: vi.fn() } }));
vi.mock('../module_bindings', () => ({
  tables: { world: 'world', player: 'player', appearance: 'appearance', tree: 'tree', groundItem: 'groundItem', chatMessage: 'chat', inventorySlot: 'inventory', combatEvent: 'combat',
    // boss_notice is narrowed to your rows by the query (it has no RLS).
    bossNotice: { where: (f: (row: any) => string) => `bossNotice where ${f({ player: { eq: (id: any) => `player = ${id.toHexString()}` } })}` } },
  DbConnection: { builder: () => {
    const builder: any = {};
    for (const name of ['withUri', 'withDatabaseName']) builder[name] = () => builder;
    builder.getUri = () => 'ws://x';
    builder.withToken = (token: string) => { test.token = token; return builder; };
    for (const name of ['onConnect', 'onConnectError', 'onDisconnect']) builder[name] = (callback: any) => { test.callbacks[name] = callback; return builder; };
    return builder;
  } },
}));
vi.mock('../store', () => ({ useLoadingStore: { getState: () => test.loading } }));
import { buildConnection, TOKEN_KEY } from '../spacetime/connection';
const saved = new Map<string, string>();
beforeEach(() => {
  saved.clear(); vi.clearAllMocks();
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) });
});

describe('failed connection recovery preserves identity', () => {
  it('never clears a saved token on a network failure, and logs no credential', () => {
    const token = `e30.${btoa(JSON.stringify({ sub: 'existing-character' })).replace(/=/g, '')}.signature`;
    saved.set(TOKEN_KEY, token);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    buildConnection();
    test.callbacks.onConnectError({}, new Error(`network unavailable: ${token}`));
    expect(saved.get(TOKEN_KEY)).toBe(token);
    expect(test.loading.setConnectionIssue).toHaveBeenCalledWith('Cannot reach the game server. Rejoin to try again.', true);
    expect(JSON.stringify(log.mock.calls)).not.toContain(token);
    log.mockRestore();
  });
  it('offers recovery for malformed credentials without replacing them automatically', () => {
    saved.set(TOKEN_KEY, 'malformed');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    buildConnection();
    test.callbacks.onConnectError({}, new Error('rejected'));
    expect(saved.get(TOKEN_KEY)).toBe('malformed');
    expect(test.loading.setConnectionIssue).toHaveBeenCalledWith(expect.stringContaining('invalid or expired'), true);
    log.mockRestore();
  });
  it('a successful connection clears the error, saves the scoped token, and subscribes to appearance', () => {
    buildConnection();
    const subscription: any = { onApplied: () => subscription, onError: () => subscription, subscribe: test.subscribe };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    test.callbacks.onConnect({ db: { player: { onInsert: vi.fn(), onUpdate: vi.fn(), iter: () => [] } }, subscriptionBuilder: () => subscription }, { toHexString: () => 'testidentity' }, 'new-token');
    expect(saved.get(TOKEN_KEY)).toBe('new-token');
    expect(test.loading.setConnectionIssue).toHaveBeenCalledWith(null, false);
    expect(test.subscribe).toHaveBeenCalledWith(expect.arrayContaining(['appearance', 'bossNotice where player = testidentity']));
    log.mockRestore();
  });
});

describe('each reconnect attempt opens a new socket at once', () => {
  it('every builder gets its own pool key, so the SDK never hands back the old connection', () => {
    const first = buildConnection() as any;
    const second = buildConnection() as any;
    expect(first.getUri()).not.toBe(second.getUri());
    expect(first.getUri()).toMatch(/#attempt-\d+$/);
  });
});
