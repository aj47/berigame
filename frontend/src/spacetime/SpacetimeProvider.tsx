import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CombatEvent } from '../module_bindings/types';
import { useMyIdentityHex } from './hooks';
import { useFirstDayStore } from './stores/firstDayStore';
import { SpacetimeDBProvider, useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import { buildConnection } from './connection';
import { onWorldTick } from './tickClock';
import { startWorldLivenessMonitor } from './worldLivenessMonitor';
import { useCombatFxStore } from './stores/combatFxStore';

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
  return null;
};

const SpacetimeProvider = ({ children }: { children: React.ReactNode }) => {
  const connectionBuilder = useMemo(() => buildConnection(), []);
  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <TableSync />
      {children}
    </SpacetimeDBProvider>
  );
};

export default SpacetimeProvider;
