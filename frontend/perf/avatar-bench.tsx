/**
 * Headless avatar render benchmark: the game's real avatar components (RenderOnlineUsers,
 * PlayerController, DebugBridge) over a mocked SpacetimeDB store, at the game camera.
 * ?n=32   avatars including your own (a grid around spawn; the outer ones are off screen)
 * ?spread=3  tiles between neighbours (default 3: at 32+ avatars the outer rows are off screen)
 * ?still  nobody walks (for screenshots)
 * ?quality=low|medium|high|auto  the graphics tier (default medium); auto adapts like the game
 * ?dpr=2  pins the pixel ratio over the tier's
 * Exposes window.__bench = { ready, frames(ms) } and the game's __berigameRender.
 */
import React, { Suspense, useEffect } from 'react';
import * as animator from '../src/animation/avatarAnimator';
import { createRoot } from 'react-dom/client';
import { Canvas, addAfterEffect, addEffect, useFrame, useThree } from '@react-three/fiber';
import { Identity } from 'spacetimedb';
import { HAIR_COLORS, HAIR_STYLES, ROBE_COLORS, SKIN_TONES, SPAWN_TILE, TICK_MS, WRAP_COLORS, tileToWorld } from '@sim';
import { benchStore } from './mockSpacetime';
import { onWorldTick } from '../src/spacetime/tickClock';
import { useLoadingStore } from '../src/store';
import RenderOnlineUsers from '../src/Components/3D/RenderOnlineUsers';
import PlayerController from '../src/Components/3D/PlayerController';
import DebugBridge from '../src/Components/3D/DebugBridge';
import AlphaIsland from '../src/Components/3D/AlphaIsland';
import AdaptiveQuality from '../src/Components/3D/AdaptiveQuality';
import { QUALITY, useGraphicsTier } from '../src/Components/3D/renderQuality';
import { useSettingsStore, type Settings } from '../src/spacetime/stores/settingsStore';
import '../src/App.css';

const params = new URLSearchParams(location.search);
const N = Math.max(1, Number(params.get('n') ?? 32));
const still = params.has('still');
const ts = { __timestamp_micros_since_unix_epoch__: 0n };
const ids = Array.from({ length: N }, (_, i) => new Identity(BigInt(i + 1) * 0x9e3779b97f4a7c15n));
const cols = Math.ceil(Math.sqrt(N));
const spread = Number(params.get('spread') ?? 3);
const home = ids.map((_, i) => i === 0 ? { x: SPAWN_TILE.x, z: SPAWN_TILE.z } : { x: SPAWN_TILE.x + Math.round(spread * ((i % cols) - cols / 2 + 0.5)), z: SPAWN_TILE.z + Math.round(spread * (Math.floor(i / cols) - cols / 2 + 1)) });
const names = ['Bryn', 'Oskar', 'Maelis', 'Tamsin', 'Ivo', 'Rook', 'Wren', 'Juno'];
const row = (i: number, tick: number) => {
  const step = !still && i % 2 === 1 && tick % 4 < 2 ? 1 : 0;
  return {
    identity: ids[i], name: `${names[i % names.length]}${i}`, online: true, connections: 1, lastSeenAt: ts,
    x: home[i].x + step, z: home[i].z, facing: 2, targetX: undefined, targetZ: undefined,
    hp: i === 2 || i === 3 ? 6 : i === 0 ? 8 : 10, maxHp: 10, state: 0, respawnTick: 0, stance: 0, fightState: 0,
    combatTarget: i === 0 ? ids[1 % N] : undefined, hostile: i === 0, nextSwingTick: 0, lastExchangeTick: 0, outOfRangeTicks: 0,
    pending: 0, pendingId: 0n, harvestTreeId: 0, harvestEndTick: 0, eatCooldownUntilTick: 0, lastInputTick: 0,
    weapon: i % 5 === 4 ? 'stick' : '',
  };
};
benchStore.identity = ids[0];
benchStore.set('appearance', ids.map((identity, i) => ({ identity, hairStyle: i % HAIR_STYLES.length, skinTone: i % SKIN_TONES.length, hairColor: (i * 3) % HAIR_COLORS.length, robeColor: (i * 5) % ROBE_COLORS.length, wrapColor: (i * 7) % WRAP_COLORS.length })));
let tick = 1;
let players = ids.map((_, i) => row(i, tick));
const publish = () => {
  benchStore.set('player', players);
  benchStore.set('world', [{ id: 0, tick, tickStartedAt: ts }]);
  benchStore.set('chat_message', N > 4 ? [{ id: 1n, sender: ids[4], text: 'Anyone seen the brambles?', tick: tick - 1, sentAt: ts }] : []);
  onWorldTick(tick);
};
publish();
setInterval(() => {
  tick++;
  // Like the SDK: only rows that changed are new objects.
  players = players.map((p, i) => { const next = row(i, tick); return next.x === p.x ? p : next; });
  publish();
}, TICK_MS);
useLoadingStore.setState({ websocketConnected: true, gameDataLoaded: true } as any);

function GameCamera() {
  const { camera, scene } = useThree();
  (window as any).__benchScene = scene;
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    // Splits a frame into useFrame work (update) and gl.render (matrices, before-render hooks, draw submission).
    // With EXT_disjoint_timer_query_webgl2 (hardware GPUs), each gl.render is also timed on the GPU.
    const context = gl.getContext() as WebGL2RenderingContext;
    const timer = context.getExtension('EXT_disjoint_timer_query_webgl2');
    const pending: WebGLQuery[] = [];
    const render = gl.render;
    gl.render = function (s, c) {
      renderStart = performance.now();
      const query = timer && recording && pending.length < 8 ? context.createQuery() : null;
      if (query) context.beginQuery(timer.TIME_ELAPSED_EXT, query);
      render.call(this, s, c);
      if (query) { context.endQuery(timer.TIME_ELAPSED_EXT); pending.push(query); }
      while (pending.length && context.getQueryParameter(pending[0], context.QUERY_RESULT_AVAILABLE)) {
        const done = pending.shift()!;
        if (!context.getParameter(timer!.GPU_DISJOINT_EXT)) gpu.push(context.getQueryParameter(done, context.QUERY_RESULT) / 1e6);
        context.deleteQuery(done);
      }
    };
    return () => { gl.render = render; };
  }, [gl]);
  useEffect(() => {
    const [x, , z] = tileToWorld(SPAWN_TILE);
    const polar = 0.78, azimuth = 0.45, distance = 18;
    camera.position.set(x + distance * Math.sin(polar) * Math.sin(azimuth), distance * Math.cos(polar), z + distance * Math.sin(polar) * Math.cos(azimuth));
    camera.lookAt(x, 0, z);
  }, [camera]);
  return null;
}

const frames: number[] = [];
const work: number[] = [];
const update: number[] = [];
const gpu: number[] = [];
let renderStart = 0;
// React commit time of the avatar components (ticks re-render them), from <Profiler>.
let reactMs = 0, reactCommits = 0;
const onRender = (_id: string, _phase: string, actual: number) => { if (recording) { reactMs += actual; reactCommits++; } };
let recording = false;
let started = 0;
// CPU cost of one r3f frame: every useFrame plus gl.render (WebGL calls are queued, not waited on).
addEffect(() => { started = performance.now(); });
addAfterEffect(() => { if (recording) { work.push(performance.now() - started); update.push(renderStart - started); } });
function FrameProbe() {
  const gl = useThree((state) => state.gl);
  useFrame((_, dt) => {
    if (recording) frames.push(dt * 1000);
    // DebugBridge publishes these in dev builds only; a production bench build needs them too.
    if (!import.meta.env.DEV) (window as any).__berigameRender = { calls: gl.info.render.calls, triangles: gl.info.render.triangles, pixelRatio: gl.getPixelRatio() };
  });
  return null;
}
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length);
  return { count: sorted.length, mean, p50: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted[sorted.length - 1] };
};
(window as any).__bench = {
  ready: false,
  async frames(ms: number) {
    const view = (animator as any).animationView;
    const skippedBefore = view?.skipped ?? 0;
    frames.length = 0; work.length = 0; update.length = 0; gpu.length = 0; reactMs = 0; reactCommits = 0; recording = true;
    await new Promise((r) => setTimeout(r, ms));
    recording = false;
    return { interval: stats(frames), work: stats(work), update: stats(update), gpu: gpu.length ? stats(gpu) : null, reactMsPerSecond: reactMs / (ms / 1000), reactCommits, skippedAnimatorUpdates: (view?.skipped ?? 0) - skippedBefore };
  },
};

const Ready = () => { useEffect(() => { setTimeout(() => { (window as any).__bench.ready = true; }, 500); }, []); return null; };

const graphics = (params.get('quality') ?? 'medium') as Settings['graphics'];
useSettingsStore.setState({ graphics });
const fixedDpr = params.has('dpr') ? Number(params.get('dpr')) : null;
function Bench() {
  const quality = QUALITY[useGraphicsTier()];
  return <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
    <Canvas id="three-canvas" dpr={fixedDpr ?? quality.dpr} shadows="percentage" camera={{ position: [8, 12, 15], fov: 42, near: 0.1, far: 180 }} gl={{ antialias: true }}>
      {graphics === 'auto' && <AdaptiveQuality />}
      <GameCamera />
      <FrameProbe />
      <Suspense fallback={null}>
        <AlphaIsland />
        <React.Profiler id="avatars" onRender={onRender}>
          <RenderOnlineUsers />
          <PlayerController setPlayerRef={() => {}} />
        </React.Profiler>
        <DebugBridge />
        <Ready />
      </Suspense>
    </Canvas>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Bench />);
