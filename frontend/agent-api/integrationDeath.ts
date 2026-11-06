/**
 * Opt-in live check of the death drop: /state must stay readable and steer you back to your bag. Same guards as
 * integration.ts (an isolated loopback server and a disposable database). `grove` dies where the bag is reachable;
 * `coast` dies past the brambles with the only stick, so the bag is out of reach and the goal must not offer it.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Identity } from 'spacetimedb';
import { STICK_ITEM_ID } from '../../shared/sim';
import { connect, createGameService, mintIdentity, type Credential } from './game';
import { createAgentServer } from './http';
import { InviteStore } from './security';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const clock = () => new Date().toISOString().slice(11, 19);
const say = (line: string) => console.log(`${clock()} ${line}`);

async function main() {
  const uri = process.env.BERIGAME_AGENT_URI ?? '';
  const database = process.env.BERIGAME_AGENT_DB ?? '';
  const ownerFile = process.env.BERIGAME_AGENT_TEST_OWNER;
  const scenario = process.argv[2] === 'coast' ? 'coast' : 'grove';
  if (process.env.BERIGAME_AGENT_INTEGRATION !== '1' || uri !== 'ws://127.0.0.1:3010'
    || !database.startsWith('berigame-agent-api-check') || !ownerFile) {
    throw new Error('These checks require the explicit test flag, an isolated server on 127.0.0.1:3010, a berigame-agent-api-check database, and its disposable owner credential.');
  }
  const backend = { uri, database };
  const owner = await connect({ ...JSON.parse(await readFile(ownerFile, 'utf8')), ...backend } as Credential, true);
  const gateway = await mintIdentity(backend);
  await owner.conn.reducers.configureAccess({ gateway: Identity.fromString(gateway.identity), requireAdmission: true });
  const directory = await mkdtemp(join(process.env.BERIGAME_AGENT_TEST_DATA!, 'death-'));
  await writeFile(join(directory, 'gateway.json'), JSON.stringify(gateway), { mode: 0o600 });
  const game = await createGameService(gateway);
  const invites = new InviteStore(directory);
  const api = createAgentServer({ game, invites, log: entry => { if ('error' in entry || (entry as any).event === 'unexpected_error') say('GATEWAY LOG ' + JSON.stringify(entry)); } });
  await new Promise<void>(resolve => api.server.listen(0, '127.0.0.1', resolve));
  const { port } = api.server.address() as { port: number };
  const base = `http://127.0.0.1:${port}/api/agent/v1`;
  const request = (path: string, token?: string, body?: object) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const enter = async () => {
    const invite = await invites.issue({ expiresAt: Date.now() + 60_000, lifetimeSeconds: 3600, combat: true, chat: false });
    const response = await request('/sessions', invite, {});
    assert.equal(response.status, 201);
    return await response.json() as { token: string; playerId: string };
  };
  const read = async (token: string) => {
    const res = await request('/state', token);
    return { status: res.status, body: await res.json() as any };
  };
  const state = async (token: string) => { const r = await read(token); assert.equal(r.status, 200, `/state ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`); return r.body; };
  const act = async (token: string, name: string, body: object) => { await sleep(1050); return request('/actions/' + name, token, body); };
  const until = async (token: string, what: string, test: (s: any) => boolean, tries = 60) => {
    for (let i = 0; i < tries; i++) { const s = await state(token); if (test(s)) return s; await sleep(1050); }
    throw new Error(`Timed out waiting for ${what}.`);
  };
  /** Harvest until the bag holds `test`; a stick is guaranteed at Foraging level 2 (four harvests). */
  const gather = async (token: string, what: string, test: (s: any) => boolean) => {
    for (let round = 0; round < 12; round++) {
      if (test(await state(token))) return;
      await act(token, 'harvest', {});
      await until(token, 'the harvest', s => test(s) || (s.player.action === null && !s.player.destination), 12).catch(() => {});
    }
    throw new Error(`Timed out gathering ${what}.`);
  };
  const hasStick = (s: any) => s.inventory.some((row: any) => row.itemId === STICK_ITEM_ID);
  const hasItem = (s: any) => s.inventory.length > 0;
  const walk = async (token: string, tile: { x: number; z: number }) => {
    await act(token, 'move', tile);
    // Close is enough: the tile may be taken, and attack walks the rest of the way.
    return until(token, `walking to ${tile.x},${tile.z}`, s => Math.max(Math.abs(s.player.tile.x - tile.x), Math.abs(s.player.tile.z - tile.z)) <= 2, 40);
  };
  const stand = scenario === 'coast' ? { x: 45, z: 25 } : { x: 31, z: 25 };
  try {
    const victim = await enter(), killer = await enter();
    say(`scenario ${scenario}: victim ${victim.playerId.slice(0, 8)}, killer ${killer.playerId.slice(0, 8)}`);
    await gather(victim.token, 'the victim\'s bag', scenario === 'coast' ? hasStick : hasItem);
    if (scenario === 'coast') await gather(killer.token, 'the killer\'s stick', hasStick);
    say(`victim bag: ${(await state(victim.token)).inventory.map((row: any) => row.itemId).join(', ')}`);
    await walk(victim.token, stand);
    await walk(killer.token, stand);
    const where = await state(victim.token);
    say(`both at ${stand.x},${stand.z}, area ${where.me.area}`);
    // A newcomer is protected for a few minutes, so keep trying until the first attack lands.
    let accepted = false;
    for (let i = 0; i < 60 && !accepted; i++) {
      accepted = (await act(killer.token, 'attack', { playerId: victim.playerId })).status === 200;
      await state(victim.token); // Reads keep the idle session alive.
      if (!accepted) await sleep(4000);
    }
    assert.ok(accepted, 'the attack was never accepted');
    let last = '', deadAt = 0, broken = 0, pickup: any = null, first503 = 0;
    const started = Date.now();
    // Poll past the death, through the respawn, like an agent does.
    while (Date.now() - started < 120_000) {
      const r = await read(victim.token);
      const s = r.body;
      if (r.status === 200 && !s.player.alive && !deadAt) { deadAt = Date.now(); say(`DIED at tile ${s.player.tile.x},${s.player.tile.z} hp ${s.player.health}`); }
      const mine = r.status === 200 ? s.groundItems.filter((g: any) => g.yourDeathDrop) : [];
      const line = r.status === 200 ? `200 alive=${s.player.alive} tile=${s.player.tile.x},${s.player.tile.z} goal=${s.goal?.id ?? null} action=${JSON.stringify(s.goal?.action ?? null)} target=${JSON.stringify(s.goal?.target ?? null)} deathDrops=${mine.map((g: any) => `${g.id}:${g.itemId}@${g.expiresInTicks}`).join('|')}`
        : `${r.status} ${JSON.stringify(s)}`;
      if (line.replace(/@\d+/g, '') !== last) { say(`/state ${line}`); last = line.replace(/@\d+/g, ''); }
      if (r.status !== 200 && !broken) {
        first503 = Date.now(); broken++;
        const danger = await request('/danger', victim.token), world = await request('/world');
        const move = await act(victim.token, 'stop', {});
        say(`while /state is ${r.status}: /danger ${danger.status}, /world ${world.status}, actions/stop ${move.status}`);
      } else if (r.status !== 200) broken++;
      if (r.status === 200 && deadAt && s.player.alive && s.goal?.action?.kind === 'pickup') { pickup = s.goal; break; }
      if (r.status === 200 && deadAt && s.player.alive && Date.now() - deadAt > 15_000 && !first503 && scenario === 'coast') break;
      if (broken > 8) break;
      await sleep(1100);
    }
    assert.ok(deadAt || first503, 'the victim never died');
    if (first503) {
      say(`REPRODUCED: /state failing ${Math.round((first503 - (deadAt || started)) / 1000)} s after death`);
      process.exitCode = 2;
      return;
    }
    if (scenario === 'coast') {
      const s = await state(victim.token);
      assert.equal(s.me.area, 'grove');
      assert.notEqual(s.goal?.id, 'recover-bag');
      assert.ok(s.groundItems.some((g: any) => g.yourDeathDrop), 'the bag should still lie on the coast');
      say(`PASS unreachable bag: /state 200, goal ${s.goal?.id}, no pickup offered, bag listed in groundItems`);
      return;
    }
    assert.ok(pickup, 'the goal never offered the bag');
    assert.equal(typeof pickup.action.itemId, 'string');
    const before = (await state(victim.token)).inventory.length;
    const res = await act(victim.token, 'pickup', { id: pickup.action.itemId });
    assert.equal(res.status, 200, `pickup ${res.status}`);
    const after = await until(victim.token, 'the bag back', s => s.inventory.length > before);
    say(`PASS /state 200 through death and respawn; goal.action ${JSON.stringify(pickup.action)} accepted by /actions/pickup; bag: ${after.inventory.map((row: any) => row.itemId).join(', ')}`);
  } finally { await api.close(); owner.conn.disconnect(); }
}
main().catch(error => { console.error('FAIL ' + error.message); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(), 200));
