/** Opt-in live checks. Use a disposable database on an isolated loopback server. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Identity } from 'spacetimedb';
import { HOTBAR_SIZE, INVENTORY_SIZE, STICK_ITEM_ID } from '../../shared/sim';
import { connect, createGameService, mintIdentity, type Credential } from './game';
import { createAgentServer } from './http';
import { InviteStore } from './security';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// A harvest can add two rows at once (the berry plus a bonus stick), so count berries by item ID.
const berries = (state: any): any[] => state.inventory.filter((row: any) => row.itemId.startsWith('berry_'));
const freeSlot = (state: any, below = INVENTORY_SIZE) => {
  const used = new Set(state.inventory.map((row: any) => row.slot));
  for (let i = 0; i < below; i++) if (!used.has(i)) return i;
  return -1;
};
async function main() {
  const uri = process.env.BERIGAME_AGENT_URI ?? '';
  const database = process.env.BERIGAME_AGENT_DB ?? '';
  const ownerFile = process.env.BERIGAME_AGENT_TEST_OWNER;
  if (process.env.BERIGAME_AGENT_INTEGRATION !== '1' || uri !== 'ws://127.0.0.1:3010'
    || !database.startsWith('berigame-agent-api-check') || !ownerFile) {
    throw new Error('These checks require the explicit test flag, an isolated server on 127.0.0.1:3010, a berigame-agent-api-check database, and its disposable owner credential.');
  }
  const backend = { uri, database };
  const owner = await connect({ ...JSON.parse(await readFile(ownerFile, 'utf8')), ...backend } as Credential, true);
  const gateway = await mintIdentity(backend);
  await owner.conn.reducers.configureAccess({ gateway: Identity.fromString(gateway.identity), requireAdmission: true });
  const directory = await mkdtemp(join(process.env.BERIGAME_AGENT_TEST_DATA!, 'run-'));
  await writeFile(join(directory, 'gateway.json'), JSON.stringify(gateway), { mode: 0o600 });
  const game = await createGameService(gateway);
  const invites = new InviteStore(directory);
  const api = createAgentServer({ game, invites });
  await new Promise<void>(resolve => api.server.listen(0, '127.0.0.1', resolve));
  const address = api.server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}/api/agent/v1`;
  const request = (path: string, token?: string, body?: object, key?: string, method = body === undefined ? 'GET' : 'POST') => fetch(base + path, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const enter = async (combat = false, chat = false) => {
    const invite = await invites.issue({ expiresAt: Date.now() + 60_000, lifetimeSeconds: 3600, combat, chat });
    const response = await request('/sessions', invite, {});
    assert.equal(response.status, 201, `join status ${response.status}`);
    return { ...await response.json() as any, invite };
  };
  const state = async (token: string) => { const res = await request('/state', token); assert.equal(res.status, 200); return await res.json() as any; };
  const action = async (token: string, name: string, body: object) => {
    await sleep(1050);
    const res = await request('/actions/' + name, token, body, randomUUID());
    assert.equal(res.status, 200, `${name} status ${res.status}`);
  };
  const waitState = async (token: string, predicate: (state: any) => boolean) => {
    for (let i = 0; i < 20; i++) { await sleep(1050); const current = await state(token); if (predicate(current)) return current; }
    throw new Error('Timed out waiting for the expected game state.');
  };
  try {
    const stranger = await mintIdentity(backend);
    await assert.rejects(connect(stranger));
    console.log('PASS uninvited direct SDK connection rejected');
    const a = await enter();
    assert.equal((await request('/sessions', a.invite, {})).status, 401);
    assert.equal((await state(a.token)).player.id, a.playerId);
    console.log('PASS invite redemption, replay rejection, and private player session');
    const key = randomUUID();
    assert.equal((await request('/actions/harvest', a.token, {}, key)).status, 200);
    let current = await waitState(a.token, s => berries(s).length === 1);
    assert.equal(berries(current)[0].quantity, 1);
    assert.equal((await request('/actions/harvest', a.token, {}, key)).status, 200);
    console.log('PASS API-only walk, harvest, inventory receipt, and safe action retry');
    await action(a.token, 'name', { name: 'API_Check' });
    await action(a.token, 'appearance', { hairStyle: 1, skinTone: 2, hairColor: 1, robeColor: 1, wrapColor: 1 });
    // Wielding: a berry is not a weapon, unwield always succeeds, and a stick (a chance on each harvest) round-trips.
    const attempt = async (token: string, name: string, body: object) => { await sleep(1050); return (await request('/actions/' + name, token, body, randomUUID())).status; };
    const firstBerry = berries(current)[0].slot;
    assert.equal(await attempt(a.token, 'wield', { slot: firstBerry }), firstBerry < HOTBAR_SIZE ? 422 : 400);
    await action(a.token, 'unwield', {});
    current = await state(a.token);
    assert.equal(current.player.weapon, null);
    assert.equal(current.hotbarSize, HOTBAR_SIZE);
    let stick = current.inventory.find((row: any) => row.itemId === STICK_ITEM_ID);
    if (stick) {
      if (stick.slot >= HOTBAR_SIZE) {
        const to = freeSlot(current, HOTBAR_SIZE);
        assert.ok(to >= 0, 'no free quick slot for the stick');
        await action(a.token, 'inventory_move', { from: stick.slot, to });
        current = await waitState(a.token, s => s.inventory.some((row: any) => row.itemId === STICK_ITEM_ID && row.slot === to));
        stick = current.inventory.find((row: any) => row.itemId === STICK_ITEM_ID);
      }
      assert.equal(stick.hotbar, true);
      await action(a.token, 'wield', { slot: stick.slot });
      current = await waitState(a.token, s => s.player.weapon?.itemId === STICK_ITEM_ID);
      assert.ok(current.player.weapon.damage > current.punchDamage);
      assert.ok(current.inventory.some((row: any) => row.itemId === STICK_ITEM_ID && row.wielded));
      await action(a.token, 'unwield', {});
      await waitState(a.token, s => s.player.weapon === null);
      console.log('PASS stick found on harvest, wielded and unwielded through HTTP');
    } else {
      console.log('SKIP stick wield round-trip: this harvest found no stick (chance per harvest)');
    }
    await action(a.token, 'move', { x: 26, z: 26 });
    await waitState(a.token, s => s.player.tile.x === 26 && s.player.tile.z === 26);
    await action(a.token, 'stop', {});
    current = await state(a.token);
    const berry = berries(current)[0];
    const spare = freeSlot(current);
    await action(a.token, 'inventory_move', { from: berry.slot, to: spare });
    await waitState(a.token, s => berries(s).some(row => row.slot === spare));
    await action(a.token, 'drop', { slot: spare, quantity: 1 });
    current = await waitState(a.token, s => berries(s).length === 0 && s.groundItems.some((item: any) => item.itemId === berry.itemId));
    await action(a.token, 'pickup', { id: current.groundItems.find((item: any) => item.itemId === berry.itemId).id });
    current = await waitState(a.token, s => berries(s).length === 1);
    await action(a.token, 'eat', { slot: berries(current)[0].slot });
    await waitState(a.token, s => berries(s).length === 0);
    console.log('PASS movement, appearance, wield/unwield, name, stop, inventory move/drop/pickup and eat through HTTP');
    const b = await enter(true, true), c = await enter(true, true);
    assert.notEqual(b.playerId, a.playerId); assert.notEqual(b.playerId, c.playerId);
    assert.equal((await request('/actions/attack', a.token, { playerId: b.playerId }, randomUUID())).status, 403);
    assert.equal((await request('/actions/chat', a.token, { text: 'not allowed' }, randomUUID())).status, 403);
    assert.equal((await request('/actions/attack', b.token, { playerId: a.playerId }, randomUUID())).status, 422);
    console.log('PASS default scopes and server protection of a noncombat target');
    await action(b.token, 'follow', { playerId: c.playerId });
    await action(b.token, 'attack', { playerId: c.playerId });
    await waitState(b.token, s => s.player.hostile === true);
    await action(b.token, 'stop', {});
    await action(b.token, 'chat', { text: 'Isolated API check' });
    await waitState(b.token, s => s.chat.some((message: any) => message.text === 'Isolated API check'));
    console.log('PASS scoped following, combat and chat through HTTP');
    await owner.conn.reducers.revokePlayer({ identity: Identity.fromString(a.playerId) });
    await sleep(500);
    assert.equal((await request('/state', a.token)).status, 401);
    console.log('PASS owner revocation invalidates the live session');
    let limited = false;
    for (let i = 0; i < 10; i++) {
      const res = await request('/actions/move', b.token, { x: -1, z: 0 }, randomUUID());
      if (res.status === 429) { assert.ok(Number(res.headers.get('Retry-After')) >= 1); limited = true; break; }
      assert.equal(res.status, 400);
    }
    assert.ok(limited);
    await sleep(1500);
    assert.equal((await request('/session', b.token, undefined, undefined, 'DELETE')).status, 204);
    assert.equal((await request('/state', b.token)).status, 401);
    console.log('PASS invalid request throttling and explicit session revocation');
    console.log('PREVIEW_DATA ' + directory);
  } finally { await api.close(); game.close(); owner.conn.disconnect(); }
}
main().catch(error => { console.error('FAIL ' + error.message); process.exitCode = 1; });
