/** Opt-in check against a disposable loopback world; never points at beta. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { Identity } from 'spacetimedb';
import { DbConnection, tables } from '../src/module_bindings';
import { MAX_ONLINE_PLAYERS } from '../../shared/sim/admission';

async function main() {
  const uri = process.env.BERIGAME_ADMISSION_CHECK_URI;
  const database = process.env.BERIGAME_ADMISSION_CHECK_DB;
  const ownerFile = process.env.BERIGAME_ADMISSION_CHECK_OWNER;
  const output = process.env.BERIGAME_ADMISSION_CHECK_OUTPUT;
  if (uri !== 'ws://127.0.0.1:45991' || !database?.startsWith('berigame-admission-check') || !ownerFile || !output) {
    throw new Error('Use a disposable world on ws://127.0.0.1:45991, a berigame-admission-check database, its new owner JSON, and an output path.');
  }
  const connections: DbConnection[] = [];
  const open = (token: string) => new Promise<{ conn: DbConnection; identity: Identity }>((resolve, reject) => {
    let conn: DbConnection | undefined;
    const timer = setTimeout(() => { conn?.disconnect(); reject(new Error('Connection timed out')); }, 10_000);
    conn = DbConnection.builder().withUri(uri).withDatabaseName(database).withToken(token)
      .onConnectError(() => { clearTimeout(timer); reject(new Error('Connection rejected')); })
      .onConnect((connection, identity) => {
        connection.subscriptionBuilder().onApplied(() => { clearTimeout(timer); resolve({ conn: connection, identity }); })
          .onError(() => { clearTimeout(timer); reject(new Error('Subscription failed')); })
          .subscribe([tables.world, tables.player.where(row => row.online.eq(true))]);
      }).onDisconnect(() => { clearTimeout(timer); reject(new Error('Connection closed')); }).build();
    connections.push(conn);
  });
  const mint = async () => {
    const response = await fetch('http://127.0.0.1:45991/v1/identity', { method: 'POST' });
    assert.equal(response.status, 200);
    return await response.json() as { identity: string; token: string };
  };
  const until = async (fn: () => boolean) => {
    const end = Date.now() + 10_000;
    while (!fn()) { if (Date.now() > end) throw new Error('World observation timed out'); await new Promise(r => setTimeout(r, 25)); }
  };
  try {
    const owner = await open(JSON.parse(await readFile(ownerFile, 'utf8')).token);
    const gateway = await mint();
    await owner.conn.reducers.configureAccess({ gateway: Identity.fromString(gateway.identity), requireAdmission: true });
    const control = await open(gateway.token);
    const credentials: Awaited<ReturnType<typeof mint>>[] = [];
    for (let i = 0; i <= MAX_ONLINE_PLAYERS; i++) {
      const credential = await mint(); credentials.push(credential);
      await control.conn.reducers.grantAgent({ identity: Identity.fromString(credential.identity), lifetimeSeconds: 3600, combat: true, chat: true });
    }
    const players: Awaited<ReturnType<typeof open>>[] = [];
    const began = performance.now();
    for (let i = 0; i < MAX_ONLINE_PLAYERS; i += 16) {
      players.push(...await Promise.all(credentials.slice(i, Math.min(i + 16, MAX_ONLINE_PLAYERS)).map(c => open(c.token))));
    }
    const admissionMs = performance.now() - began;
    const online = () => [...control.conn.db.player.iter()].filter(p => p.online).length;
    await until(() => online() === MAX_ONLINE_PLAYERS);
    await assert.rejects(open(credentials[MAX_ONLINE_PLAYERS].token));
    assert.equal(online(), MAX_ONLINE_PLAYERS);
    await control.conn.reducers.renewGrant({ identity: players[1].identity, lifetimeSeconds: 3600 });
    players[0].conn.disconnect();
    await until(() => online() === MAX_ONLINE_PLAYERS - 1);
    await open(credentials[MAX_ONLINE_PLAYERS].token);
    await until(() => online() === MAX_ONLINE_PLAYERS);
    const tick = control.conn.db.world.id.find(0)!.tick;
    await until(() => control.conn.db.world.id.find(0)!.tick >= tick + 10);
    const result = { onlinePlayers: online(), extraConnectionRejected: true, onlineRenewalAtCapacity: true,
      disconnectedSlotReused: true, ticksObservedAtCapacity: 10, admissionMs: Math.round(admissionMs),
      scope: 'Isolated local SpacetimeDB, minimal world/online-player subscriptions; no production or browser rendering benchmark.' };
    await writeFile(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally { for (const conn of connections) { try { conn.disconnect(); } catch {} } }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Admission check failed'); process.exitCode = 1; });
