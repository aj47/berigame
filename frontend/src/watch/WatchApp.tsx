import React, { useEffect, useRef, useState } from 'react';
import { useSpacetimeDB } from 'spacetimedb/react';
import { PlayerState } from '@sim';
import '../App.css';
import './watch.css';
import GameComponent from '../Components/3D/GameComponent';
import SpacetimeProvider from '../spacetime/SpacetimeProvider';
import { playerView } from '../spacetime/playerView';
import { onWatchPassExpired, setViewerSubject, setWatchPass, useViewerStore, WATCH_PARAMS, watchPass, type WatchPass } from '../spacetime/viewer';
import { useLoadingStore } from '../store';
import { Director } from './director';
import OverviewMap from './OverviewMap';
import { resolvePlayer } from './watchParams';
import { keepPass, keptPass } from './passStore';

const params = WATCH_PARAMS!;
const PASS_WORLD = params.world ?? window.location.origin;
const PASS_PATH = '/api/agent/v1/spectators';
const PASS_RETRY_MS = 5000;
/** A pass with less than this left is replaced ahead of the next reconnect. */
const PASS_RENEW_MS = 12 * 3600_000;
const PASS_CHECK_MS = 3600_000;
const SUBJECT_MS = 1000;
/** Self-healing for a run nobody is watching: the page starts over rather than sit broken in a scene. */
const OFFLINE_RELOAD_MS = 5 * 60_000;
const CRASH_RELOAD_MS = 5000;

class WatchFailed extends Error {
  constructor(message: string, readonly fatal: boolean, readonly retryMs = PASS_RETRY_MS) { super(message); }
}

async function requestPass(): Promise<WatchPass> {
  const response = await fetch(`${params.world ?? ''}${PASS_PATH}`, { method: 'POST', headers: params.key ? { Authorization: `Bearer ${params.key}` } : {} });
  if (response.status === 401) throw new WatchFailed('This world needs its watch key.', true);
  if (response.status === 403) throw new WatchFailed('This world has no watch key set, so it cannot be watched.', true);
  // Passes are rationed per address (a few an hour): wait as long as the gateway says.
  if (response.status === 429) throw new WatchFailed('Waiting for a viewer pass…', false, Math.max(PASS_RETRY_MS, Number(response.headers.get('Retry-After')) * 1000 || 0));
  if (!response.ok) throw new WatchFailed('Waiting for the world…', false);
  const body = await response.json() as WatchPass;
  if (!body.token || !body.uri || !body.database) throw new WatchFailed('Waiting for the world…', false);
  return body;
}

/** Fetches a pass, then keeps a fresh one on hand for the next reconnect. Retries for as long as the page lives. */
function useWatchPass(): { ready: boolean; note: string } {
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState('Connecting…');
  useEffect(() => {
    let alive = true, timer = 0, busy = false, lastRefused = 0;
    const fetchPass = async () => {
      if (busy) return;
      busy = true;
      try {
        const pass = await requestPass();
        if (!alive) return;
        setWatchPass(pass);
        keepPass(PASS_WORLD, pass);
        setReady(true);
      } catch (error) {
        if (!alive) return;
        const failure = error instanceof WatchFailed ? error : new WatchFailed('Waiting for the world…', false);
        setNote(failure.message);
        if (!failure.fatal) timer = window.setTimeout(() => void fetchPass(), failure.retryMs);
      } finally { busy = false; }
    };
    // A server that is simply down refuses every attempt: no need to ask the gateway each time.
    onWatchPassExpired(() => {
      keepPass(PASS_WORLD, null);
      if (Date.now() - lastRefused < PASS_RETRY_MS * 6) return;
      lastRefused = Date.now();
      void fetchPass();
    });
    // A reload reuses this tab's pass rather than taking another of the world's MAX_SPECTATORS rows.
    const kept = keptPass(PASS_WORLD, PASS_RENEW_MS);
    if (kept) { setWatchPass(kept); setReady(true); }
    else void fetchPass();
    const check = window.setInterval(() => {
      const pass = watchPass();
      if (pass && Date.parse(pass.expiresAt) - Date.now() < PASS_RENEW_MS) void fetchPass();
    }, PASS_CHECK_MS);
    return () => { alive = false; window.clearTimeout(timer); window.clearInterval(check); };
  }, []);
  return { ready, note };
}

/** Puts the right character in the viewer's seat: the named one, or the director's pick. */
function SubjectTracker() {
  const { getConnection } = useSpacetimeDB();
  const director = useRef(new Director({ holdMs: params.holdMs }));
  useEffect(() => {
    const update = () => {
      const conn = getConnection() as any;
      if (!conn?.db?.player) return;
      const rows = [...playerView(conn).iter()] as any[];
      if (params.mode === 'director') {
        setViewerSubject(director.current.step(rows.map((p) => ({
          hex: p.identity.toHexString(), hp: p.hp, online: p.online, dead: p.state === PlayerState.Dead,
          target: p.hostile && p.combatTarget ? p.combatTarget.toHexString() : null,
        })), performance.now()));
      } else if (params.player) setViewerSubject(resolvePlayer(params.player, rows));
    };
    update();
    const timer = window.setInterval(update, SUBJECT_MS);
    return () => window.clearInterval(timer);
  }, [getConnection]);
  return null;
}

/** Nothing on screen unless something is wrong. */
function WatchStatus() {
  const connected = useLoadingStore((s: any) => s.websocketConnected);
  const loaded = useLoadingStore((s: any) => s.gameDataLoaded);
  const subject = useViewerStore((s) => s.subject);
  useEffect(() => {
    if (connected) return;
    const timer = window.setTimeout(() => window.location.reload(), OFFLINE_RELOAD_MS);
    return () => window.clearTimeout(timer);
  }, [connected]);
  const everLoaded = useRef(false);
  if (loaded) everLoaded.current = true;
  if (!everLoaded.current) return <div className="watch-curtain" role="status">Connecting…</div>;
  if (params.mode !== 'overview' && !subject) return <div className="watch-curtain" role="status">{params.mode === 'director' ? 'Waiting for players…' : `Waiting for ${params.player ?? 'a player'}…`}</div>;
  return connected && loaded ? null : <div className="watch-pill" role="status">Reconnecting…</div>;
}

function WatchStage() {
  const subject = useViewerStore((s) => s.subject);
  const scene = params.mode !== 'overview';
  return <>
    {scene && <SubjectTracker />}
    <div className="watch-stage">
      {scene ? subject && <GameComponent spectator /> : <OverviewMap />}
    </div>
    <WatchStatus />
  </>;
}

/** A render failure reloads the page instead of leaving a dead source in an OBS scene. */
class WatchBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    console.error('Watch view failed; reloading', error);
    window.setTimeout(() => window.location.reload(), CRASH_RELOAD_MS);
  }
  render() { return this.state.failed ? <div className="watch-curtain" role="status">Reconnecting…</div> : this.props.children; }
}

/** /watch: a read-only picture of the world for OBS, with no login and nothing to click (docs/SPECTATOR.md). */
export default function WatchApp() {
  const { ready, note } = useWatchPass();
  if (!ready) return <div className="watch-curtain" role="status">{note}</div>;
  return <WatchBoundary><SpacetimeProvider><WatchStage /></SpacetimeProvider></WatchBoundary>;
}
