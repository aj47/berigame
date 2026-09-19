import React, { useMemo } from 'react';
import { SpacetimeDBProvider, useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import { buildConnection } from './connection';
import { onWorldTick } from './tickClock';
import { useCombatFxStore } from './stores/combatFxStore';

/** Feeds the tick clock and the combat FX store from table updates. */
const TableSync = () => {
  useTable(tables.world, {
    onInsert: (row) => onWorldTick(row.tick),
    onUpdate: (_old, row) => onWorldTick(row.tick),
  });
  const pushEvent = useCombatFxStore((s) => s.pushEvent);
  // combat_event is an event table: rows only ever arrive through onInsert.
  useTable(tables.combatEvent, { onInsert: pushEvent });
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
