import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CombatEvent } from '../module_bindings/types';
import { useMyIdentityHex } from './hooks';
import { useFirstDayStore } from './stores/firstDayStore';
import { SpacetimeDBProvider, useSpacetimeDB, useTable } from 'spacetimedb/react';
import type { DbConnection } from '../module_bindings';
import { tables } from '../module_bindings';
import { buildConnection } from './connection';
import { onWorldTick } from './tickClock';
import { startWorldLivenessMonitor } from './worldLivenessMonitor';
import { useCombatFxStore } from './stores/combatFxStore';
import { useSocialStore } from './stores/socialStore';
import { useProgressStore } from './stores/progressStore';

/** Feeds the tick clock and the combat FX store from table updates. */
const TableSync = () => {
  useEffect(startWorldLivenessMonitor, []);
  useTable(tables.world, {
    onInsert: (row) => onWorldTick(row.tick),
    onUpdate: (_old, row) => onWorldTick(row.tick),
  });
  const pushEvent = useCombatFxStore((s) => s.pushEvent);
  const me = useMyIdentityHex();
  const meRef = useRef(me);
  meRef.current = me;
  // combat_event is an event table: rows only ever arrive through onInsert.
  const onEvent = useCallback((row: CombatEvent) => {
    pushEvent(row);
    useFirstDayStore.getState().onEvent(meRef.current, row);
  }, [pushEvent]);
  useTable(tables.combatEvent, { onInsert: onEvent });
  // Training dummy blows and emotes: event tables too.
  useTable(tables.dummyEvent, { onInsert: useSocialStore.getState().pushDummyHit });
  useTable(tables.emoteEvent, { onInsert: useSocialStore.getState().pushEmote });
  return null;
};

/**
 * F2: your own player_skill / player_cosmetic rows drive the XP floaters, the
 * level-up banner and the keepsake banner. Rows delivered by the initial
 * subscription are only a baseline.
 */
const ProgressSync = () => {
  const me = useMyIdentityHex();
  const { getConnection } = useSpacetimeDB<DbConnection>();
  const conn = getConnection() as any;
  useEffect(() => {
    const skills = conn?.db?.playerSkill, cosmetics = conn?.db?.playerCosmetic;
    if (!skills || !cosmetics || !me) return;
    const mine = (row: { identity: any }) => row.identity.toHexString() === me;
    const initial = (ctx: any) => ctx?.event?.tag === 'SubscribeApplied';
    const store = () => useProgressStore.getState();
    const skillInsert = (ctx: any, row: any) => { if (mine(row) && !initial(ctx)) store().onSkills(null, row); };
    const skillUpdate = (_ctx: any, prev: any, row: any) => { if (mine(row)) store().onSkills(prev, row); };
    const cosmeticInsert = (ctx: any, row: any) => { if (mine(row) && !initial(ctx)) store().onCosmetics(0, row.unlocked); };
    const cosmeticUpdate = (_ctx: any, prev: any, row: any) => { if (mine(row)) store().onCosmetics(prev.unlocked, row.unlocked); };
    skills.onInsert(skillInsert); skills.onUpdate(skillUpdate);
    cosmetics.onInsert(cosmeticInsert); cosmetics.onUpdate(cosmeticUpdate);
    return () => {
      skills.removeOnInsert(skillInsert); skills.removeOnUpdate(skillUpdate);
      cosmetics.removeOnInsert(cosmeticInsert); cosmetics.removeOnUpdate(cosmeticUpdate);
    };
  }, [conn, me]);
  return null;
};

const SpacetimeProvider = ({ children }: { children: React.ReactNode }) => {
  const connectionBuilder = useMemo(() => buildConnection(), []);
  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <TableSync />
      <ProgressSync />
      {children}
    </SpacetimeDBProvider>
  );
};

export default SpacetimeProvider;
