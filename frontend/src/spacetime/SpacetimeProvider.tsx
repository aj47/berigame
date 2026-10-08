import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CombatEvent, SocialEvent } from '../module_bindings/types';
import { identityHex } from './identity';
import { useToastStore } from './stores/toastStore';
import { useMyIdentityHex } from './hooks';
import { useFirstDayStore } from './stores/firstDayStore';
import { SpacetimeDBProvider, useSpacetimeDB } from 'spacetimedb/react';
import type { DbConnection } from '../module_bindings';
import { buildConnection, currentConnection, markConnectionLost, setConnectionLifecycle } from './connection';
import { ReconnectController, type BackoffOptions } from './reconnect';
import { useLoadingStore } from '../store';

/** How long the world may look frozen on an open socket before we replace it. */
const ZOMBIE_GRACE_MS = 4000;
import { onWorldTick } from './tickClock';
import { startWorldLivenessMonitor } from './worldLivenessMonitor';
import { useCombatFxStore } from './stores/combatFxStore';
import { useSocialStore } from './stores/socialStore';
import { useGiantStore } from './stores/giantStore';
import { useProgressStore } from './stores/progressStore';
import { FrontierSync } from '../frontier/useFrontier';
import BossSync from '../bosses/BossSync';
import { isPlayerVisible } from '../bosses/selectors';
import { useBossStore } from '../bosses/bossStore';

/**
 * Listen to one table of the connection's own world subscription. Unlike
 * `useTable`, this opens no second SQL subscription: with two overlapping
 * subscriptions every event-table row (combat, dummy, emote, social, Giant)
 * was delivered, and handled, twice.
 */
function useRowListener(accessor: string, onInsert?: (row: any) => void, onUpdate?: (prev: any, row: any) => void) {
  const { getConnection, isActive } = useSpacetimeDB<DbConnection>();
  const conn = getConnection() as any;
  const ins = useRef(onInsert); ins.current = onInsert;
  const upd = useRef(onUpdate); upd.current = onUpdate;
  useEffect(() => {
    const table = conn?.db?.[accessor];
    if (!table || !isActive) return;
    const i = (_ctx: any, row: any) => ins.current?.(row);
    const u = (_ctx: any, prev: any, row: any) => upd.current?.(prev, row);
    table.onInsert(i);
    table.onUpdate?.(u);
    return () => { table.removeOnInsert(i); table.removeOnUpdate?.(u); };
  }, [conn, isActive, accessor]);
}

/**
 * Combat FX of players the viewer cannot see (the Spire's floor seen from the
 * overworld, or another run seen from inside) never reach the FX stores.
 */
function combatEventVisible(conn: any, row: CombatEvent): boolean {
  const players = conn?.db?.player?.identity;
  const myId = conn?.identity;
  if (!players || !myId) return true;
  const viewer = players.find(myId) ?? null;
  const hexes = useBossStore.getState().myRunHexes;
  for (const id of [row.attacker, row.defender]) {
    const p = players.find(id);
    if (p && !isPlayerVisible(p, viewer, hexes)) return false;
  }
  return true;
}

/** Feeds the tick clock and the combat FX store from table updates. */
const TableSync = () => {
  const { getConnection } = useSpacetimeDB<DbConnection>();
  const connRef = useRef<any>(null);
  connRef.current = getConnection();
  useEffect(startWorldLivenessMonitor, []);
  useRowListener('world', (row) => onWorldTick(row.tick), (_old, row) => onWorldTick(row.tick));
  const me = useMyIdentityHex();
  const meRef = useRef(me);
  meRef.current = me;
  // combat_event is an event table: rows only ever arrive through onInsert.
  useRowListener('combatEvent', (row: CombatEvent) => {
    if (!combatEventVisible(connRef.current, row)) return;
    useCombatFxStore.getState().pushEvent(row);
    useFirstDayStore.getState().onEvent(meRef.current, row);
  });
  // Training dummy blows and emotes: event tables too.
  useRowListener('dummyEvent', (row) => useSocialStore.getState().pushDummyHit(row));
  useRowListener('emoteEvent', (row) => useSocialStore.getState().pushEmote(row));
  // Social notices (trade requests and results, invite results): only your own show.
  useRowListener('socialEvent', (row: SocialEvent) => {
    if (meRef.current && identityHex(row.to) === meRef.current) useToastStore.getState().show(row.text);
  });
  // The Boulders' Giant: blows, slams, defeats, rewards and raid announcements (an event table).
  useRowListener('giantEvent', (row) => useGiantStore.getState().pushEvent(row, meRef.current));
  // Clatterhorn and the Sunken Spire: rows, notices and swing cues into useBossStore.
  return <BossSync />;
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
      <ProgressSync />
      <FrontierSync />
      {children}
    </SpacetimeDBProvider>
  );
};

export default SpacetimeProvider;
