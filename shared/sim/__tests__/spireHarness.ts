import { adventureTables, testTable } from './adventureHarness';
import { PlayerState } from '../types';
import { BOSS_CONFIG_DEFAULTS, SPIRE_EXIT, SPIRE_NONE, SPIRE_RULES_VERSION, type BossConfigLike, type Tile } from '../index';

/**
 * The real-tick harness for the Spire's server tests (FINAL_SPEC 10.2): real
 * reducers and the real tick against in-memory tables. The test file must
 * `vi.mock` the SDK server entry, `spacetimedb/src/schema` and
 * `spacetimedb/src/tables` before importing reducers (vi.mock is hoisted per file).
 */

export type Identity = { toHexString(): string; __identity__: bigint };
export const id = (n: number): Identity => {
  const hex = n.toString(16).padStart(64, '0');
  return { toHexString: () => hex, __identity__: BigInt(n) };
};
export const A = id(1), B = id(2), C = id(3), D = id(4), E = id(5), OWNER = id(9), MODULE = id(10);
export type Reducer = (ctx: any, args?: any) => void;
export const R = (f: unknown) => f as Reducer;

const KEYS: Record<string, [string, boolean]> = {
  player: ['identity', false], playerGrant: ['identity', false], appearance: ['identity', false], emoteCooldown: ['identity', false],
  playStats: ['identity', false], giantContribution: ['identity', false], mentee: ['identity', false], mentorStat: ['identity', false],
  world: ['id', false], accessPolicy: ['id', false], tree: ['id', false], trainingDummy: ['id', false], giant: ['id', false],
  giantRaid: ['id', false], inviteCode: ['code', false], socialPair: ['pair', false],
};

/** Counts writes per table (insert / update / delete through any accessor). */
export interface WriteLog { insert: Record<string, number>; update: Record<string, number>; delete: Record<string, number> }

function spied(name: string, table: any, log: WriteLog): any {
  const bump = (k: keyof WriteLog) => { log[k][name] = (log[k][name] ?? 0) + 1; };
  return new Proxy(table, {
    get(obj: any, field: string) {
      const v = obj[field];
      if (field === 'insert') return (row: any) => { bump('insert'); return v(row); };
      if (v && typeof v === 'object' && 'update' in v) {
        return { ...v, update: (row: any) => { bump('update'); return v.update(row); }, delete: (k: any) => { bump('delete'); return v.delete(k); } };
      }
      return v;
    },
  });
}

export const BOSS_TABLES = ['bossConfig', 'clatterhorn', 'clatterhornCredit', 'spireRun', 'spireMember', 'spireFight', 'bossEvent', 'bossNotice'] as const;

export function spireHarness(tick: Reducer, names = ['Ann', 'Bo', 'Cy', 'Di', 'Ed']) {
  const log: WriteLog = { insert: {}, update: {}, delete: {} };
  const base: Record<string, any> = { ...adventureTables() };
  for (const t of BOSS_TABLES) base[t] = spied(t, base[t], log);
  const db = new Proxy(base, {
    get(obj, name: string) {
      if (!(name in obj)) { const [pk, auto] = KEYS[name] ?? ['id', true]; obj[name] = testTable(pk, auto); }
      return obj[name];
    },
  });
  db.accessPolicy.insert({ id: 0, owner: OWNER, gateway: id(11), requireAdmission: false });
  db.world.insert({ id: 0, tick: 100 });
  const ctx: any = { db, sender: A, identity: MODULE, random: () => 0.99, timestamp: { microsSinceUnixEpoch: 1_000_000_000_000n } };
  const ids = [A, B, C, D, E];
  names.forEach((name, i) => db.player.insert({
    identity: ids[i], name, online: true, connections: 1, region: 'bramblewild', x: SPIRE_EXIT.x, z: SPIRE_EXIT.z, facing: 0,
    targetX: undefined, targetZ: undefined, hp: 30, maxHp: 30, state: PlayerState.Alive, respawnTick: 0,
    stance: 0, fightState: 0, combatTarget: undefined, hostile: false, nextSwingTick: 0, harvestTreeId: 0, harvestEndTick: 0,
    pending: 0, pendingId: 0n, lastInputTick: 0, inputsThisTick: 0, eatCooldownUntilTick: 0, weapon: '',
  }));
  const p = (who: Identity) => db.player.identity.find(who);
  const set = (who: Identity, extra: object) => db.player.identity.update({ ...p(who), ...extra });
  const place = (who: Identity, t: Tile, extra: object = {}) => set(who, { x: t.x, z: t.z, targetX: undefined, targetZ: undefined, ...extra });
  const give = (who: Identity, itemId: string, quantity: number) => {
    const used = new Set([...db.inventorySlot.owner.filter(who)].map((r: any) => r.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    db.inventorySlot.insert({ id: 0n, owner: who, slot, itemId, quantity });
  };
  const bag = (who: Identity) => [...db.inventorySlot.owner.filter(who)].map((r: any) => `${r.itemId}:${r.quantity}`).sort();
  const count = (who: Identity, itemId: string) =>
    [...db.inventorySlot.owner.filter(who)].reduce((n: number, r: any) => n + (r.itemId === itemId ? r.quantity : 0), 0);
  const as = (who: Identity) => { ctx.sender = who; return ctx; };
  const T = () => db.world.id.find(0).tick as number;
  const run = (n = 1) => {
    for (let i = 0; i < n; i++) { ctx.sender = MODULE; tick(ctx, { timer: {} }); }
  };
  const config = (patch: Partial<BossConfigLike> = {}) => {
    const row = { id: 0, ...BOSS_CONFIG_DEFAULTS, spireOpen: true, ...patch };
    if (db.bossConfig.id.find(0)) db.bossConfig.id.update(row); else db.bossConfig.insert(row);
  };
  const runRow = (runId: bigint) => db.spireRun.id.find(runId);
  const fight = (runId: bigint) => db.spireFight.runId.find(runId);
  const member = (who: Identity) => db.spireMember.identity.find(who);
  const setFight = (runId: bigint, patch: object) => db.spireFight.runId.update({ ...fight(runId), ...patch });
  const setRun = (runId: bigint, patch: object) => db.spireRun.id.update({ ...runRow(runId), ...patch });
  const setMember = (who: Identity, patch: object) => db.spireMember.identity.update({ ...member(who), ...patch });
  /** Publish one pattern instance as `cur` (no `prev`). */
  const pattern = (runId: bigint, kind: number, start: number, seed = 0, aim: Tile = { x: 77, z: 69 }) =>
    setFight(runId, { curKind: kind, curStart: start, curSeed: seed, curAimX: aim.x, curAimZ: aim.z, prevKind: SPIRE_NONE, prevStart: 0, prevSeed: 0, prevAimX: 0, prevAimZ: 0 });
  const notices = (kind: number, who?: Identity) =>
    [...db.bossNotice.iter()].filter((n: any) => n.kind === kind && (!who || n.player.toHexString() === who.toHexString()));
  const events = (kind: number) => [...db.bossEvent.iter()].filter((e: any) => e.kind === kind);
  const socials = (who: Identity) => [...db.socialEvent.iter()].filter((e: any) => e.to.toHexString() === who.toHexString()).map((e: any) => e.text);
  return {
    ctx, db, log, p, set, place, give, bag, count, as, T, run, config, runRow, fight, member, setFight, setRun, setMember,
    pattern, notices, events, socials, rules: SPIRE_RULES_VERSION,
  };
}

export type SpireHarness = ReturnType<typeof spireHarness>;
