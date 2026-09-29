import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CombatEvent, SocialEvent } from '../module_bindings/types';
import { identityHex } from './identity';
import { useToastStore } from './stores/toastStore';
import { useMyIdentityHex } from './hooks';
import { useFirstDayStore } from './stores/firstDayStore';
import { SpacetimeDBProvider, useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import { buildConnection, currentConnection, markConnectionLost, setConnectionLifecycle } from './connection';
import { ReconnectController, type BackoffOptions } from './reconnect';
import { useLoadingStore } from '../store';

/** How long the world may look frozen on an open socket before we replace it. */
const ZOMBIE_GRACE_MS = 4000;
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

/** Test hooks: `?reconnectAttempts=2&reconnectMaxMs=1000` shortens the give-up path for browser checks. */
function backoffOverrides(): Partial<BackoffOptions> {
  try {
    const q = new URLSearchParams(window.location.search);
    const out: Partial<BackoffOptions> = {};
    const attempts = Number(q.get('reconnectAttempts'));
    const maxMs = Number(q.get('reconnectMaxMs'));
    if (attempts > 0 && attempts <= 50) out.maxAttempts = attempts;
    if (maxMs >= 100 && maxMs <= 60_000) out.maxMs = maxMs;
    return out;
  } catch {
    return {};
  }
}

/**
 * Owns reconnection: exponential backoff with jitter (reconnect.ts), a fresh
 * connection builder per attempt (so the latest saved token, i.e. the same
 * character, is always used), and the browser offline/online/sleep/wake
 * signals. Handing SpacetimeDBProvider a new builder makes it open a new
 * socket for the same key; the old one was already closed.
 */
const SpacetimeProvider = ({ children }: { children: React.ReactNode }) => {
  const [connectionBuilder, setConnectionBuilder] = useState(() => buildConnection());
  const controllerRef = useRef<ReconnectController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new ReconnectController({
      connect: () => setConnectionBuilder(buildConnection()),
      onChange: (state) => useLoadingStore.getState().setReconnectState(state),
    }, backoffOverrides());
  }
  useEffect(() => {
    const controller = controllerRef.current!;
    controller.start();
    setConnectionLifecycle({ connected: () => controller.connected(), lost: () => controller.lost() });
    useLoadingStore.getState().setRetryConnection(() => controller.retryNow());
    return () => {
      setConnectionLifecycle(null);
      controller.dispose();
    };
  }, []);
  useEffect(() => {
    const controller = controllerRef.current!;
    const dropCurrent = () => markConnectionLost(currentConnection());
    const offline = () => {
      // An open socket on a dead network can take minutes to notice; drop it now.
      if (controller.snapshot.status === 'connected') dropCurrent();
      controller.offline();
    };
    const online = () => controller.online();
    const wake = () => { if (document.visibilityState !== 'hidden') controller.wake(); };
    // A socket that is "open" but delivers no world ticks (sleep, captive
    // network) is a zombie: the liveness monitor flags it, we replace it.
    let stalledSince: number | null = null;
    const unsubscribe = useLoadingStore.subscribe((state: any) => {
      if (state.worldUpdatesStalled && state.websocketConnected && navigator.onLine && document.visibilityState !== 'hidden') {
        stalledSince ??= performance.now();
        if (performance.now() - stalledSince >= ZOMBIE_GRACE_MS) { stalledSince = null; dropCurrent(); }
      } else stalledSince = null;
    });
    const zombieCheck = window.setInterval(() => {
      const state: any = useLoadingStore.getState();
      if (stalledSince !== null && state.worldUpdatesStalled && performance.now() - stalledSince >= ZOMBIE_GRACE_MS) {
        stalledSince = null;
        dropCurrent();
      }
    }, 1000);
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    window.addEventListener('pageshow', wake);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    document.addEventListener('resume', wake);
    return () => {
      unsubscribe();
      window.clearInterval(zombieCheck);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      window.removeEventListener('pageshow', wake);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
      document.removeEventListener('resume', wake);
    };
  }, []);
  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <TableSync />
      {children}
    </SpacetimeDBProvider>
  );
};

export default SpacetimeProvider;
