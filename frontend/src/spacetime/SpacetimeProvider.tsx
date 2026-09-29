import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CombatEvent, SocialEvent } from '../module_bindings/types';
import { identityHex } from './identity';
import { useToastStore } from './stores/toastStore';
import { useMyIdentityHex } from './hooks';
import { useFirstDayStore } from './stores/firstDayStore';
import { SpacetimeDBProvider, useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import { buildConnection } from './connection';
import { onWorldTick } from './tickClock';
import { startWorldLivenessMonitor } from './worldLivenessMonitor';
import { useCombatFxStore } from './stores/combatFxStore';
import { useSocialStore } from './stores/socialStore';

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
  // Social notices (trade requests and results, invite results): only your own show.
  useTable(tables.socialEvent, { onInsert: useCallback((row: SocialEvent) => {
    if (meRef.current && identityHex(row.to) === meRef.current) useToastStore.getState().show(row.text);
  }, []) });
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
