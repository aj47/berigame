import { useEffect } from 'react';
import { useSpacetimeDB } from 'spacetimedb/react';
import type { DbConnection } from '../module_bindings';
import { useMyIdentityHex } from '../spacetime/hooks';
import { useBossStore, type BossTable } from './bossStore';
import { startClatterFx } from './clatterhorn/clatterFx';
import { startSpireFx } from './spire/spireFx';

/** Persistent boss tables mirrored into the store, with each row's key. */
const TABLES: readonly [BossTable, (row: any) => string | number | bigint][] = [
  ['bossConfig', (r) => r.id],
  ['clatterhorn', (r) => r.id],
  ['spireRun', (r) => r.id],
  ['spireMember', (r) => r.identity.toHexString()],
  ['spireFight', (r) => r.runId],
];

/**
 * Mirrors the connection's boss rows into `useBossStore` (mounted once inside
 * SpacetimeProvider's TableSync). On mount it copies the current rows, then
 * listens: inserts, updates and deletes of the persistent tables, inserts of
 * the two event tables (boss_event, and boss_notice narrowed to you by RLS),
 * and player updates for other players' Clatterhorn swing cues. It also starts
 * the boss FX consumers. Everything is removed on unmount.
 */
export default function BossSync() {
  const { getConnection, isActive } = useSpacetimeDB<DbConnection>();
  const conn = getConnection() as any;
  const me = useMyIdentityHex();

  useEffect(() => { useBossStore.getState().setMe(me); }, [me]);

  useEffect(() => {
    const db = conn?.db;
    if (!db || !isActive) return;
    const store = useBossStore.getState;
    store().reset();
    store().setMe(me);
    const off: (() => void)[] = [];

    for (const [table, key] of TABLES) {
      const t = db[table];
      if (!t) continue;
      for (const row of t.iter()) store().setRow(table, row);
      const ins = (_ctx: unknown, row: any) => store().setRow(table, row);
      const upd = (_ctx: unknown, _prev: any, row: any) => store().setRow(table, row);
      const del = (_ctx: unknown, row: any) => store().deleteRow(table, key(row));
      t.onInsert(ins); t.onUpdate?.(upd); t.onDelete(del);
      off.push(() => { t.removeOnInsert(ins); t.removeOnUpdate?.(upd); t.removeOnDelete(del); });
    }

    const events = db.bossEvent, notices = db.bossNotice, players = db.player;
    if (events) {
      const ins = (_ctx: unknown, row: any) => store().pushEvent(row);
      events.onInsert(ins);
      off.push(() => events.removeOnInsert(ins));
    }
    if (notices) {
      const ins = (_ctx: unknown, row: any) => store().pushNotice(row);
      notices.onInsert(ins);
      off.push(() => notices.removeOnInsert(ins));
    }
    if (players?.onUpdate) {
      const upd = (_ctx: unknown, prev: any, row: any) => store().onPlayerUpdate(prev, row);
      players.onUpdate(upd);
      off.push(() => players.removeOnUpdate(upd));
    }

    off.push(startClatterFx(), startSpireFx());
    return () => { for (const f of off) f(); };
    // `me` is applied by the effect above; re-subscribing on an identity change is not needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, isActive]);

  return null;
}
