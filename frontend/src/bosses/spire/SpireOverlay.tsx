import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { MeshBasicMaterial, RingGeometry, type Group } from 'three';
import { TILE_ORIGIN, spireBulletDamage, spireEnraged, spireFightBullets, type Tile } from '@sim';
import { useMyPlayer, useTick } from '../../spacetime/hooks';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';
import { audio } from '../../audio';
import { useBossStore } from '../bossStore';
import DangerTiles from '../DangerTiles';
import { assistDots, chargeTelegraph, fightSafety, hoverVerdict, overlayDanger, type HoverVerdict } from './overlayModel';
import { SPIRE_BLOCKED, spireView } from './spireView';

/**
 * The danger overlay on the server timeline (FINAL_SPEC 7.5), recomputed when
 * the tick changes to τ (not every frame): red danger tiles for τ+1 (striped),
 * amber for τ+2, charge telegraphs for volleys firing in (τ, τ+3], the cyan
 * true-tile marker on your authoritative row tile, dodge-assist dots and the
 * safe-move hover. Always drawn at every graphics tier: it is gameplay.
 */
export type SpireOverlayProps = Record<string, never>;

const EMPTY_BULLETS = new Int32Array(0);
const EMPTY_KEYS: ReadonlySet<number> = new Set();
const markerGeo = new RingGeometry(0.5, 0.6, 4, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 4);
const hoverGeo = new RingGeometry(0.34, 0.46, 24).rotateX(-Math.PI / 2);
const HOVER_COLOR = { safe: '#5ff2a0', risky: '#ffb547', hit: '#ff4d5e' } as const;
const hoverMat = new MeshBasicMaterial({ color: HOVER_COLOR.safe, toneMapped: false, transparent: true, opacity: 0.95, depthWrite: false, fog: false });
const markerMat = new MeshBasicMaterial({ color: '#5ff0ff', toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false, fog: false });

interface HoverInput { bullets: Int32Array; tick: number; me: Tile | null; safety: ReturnType<typeof fightSafety>; phase: number; startTick: number }

/**
 * The safe-move hover, polled from the floor's pointer state and recomputed when the tile or the tick changes.
 * Its own component with one persistent ring, so a hovered-tile change neither re-renders the danger layers nor
 * mounts a material; only the '-N' label of a hit mounts.
 */
function SpireHover({ input }: { input: HoverInput }) {
  const [hit, setHit] = useState<{ tile: Tile; damage: number } | null>(null);
  const live = useRef(input);
  live.current = input;
  const group = useRef<Group>(null);
  const seen = useRef({ seq: -1, tick: -1, mx: NaN, mz: NaN, n: -1 });
  useFrame(() => {
    const c = live.current, h = spireView.hover, k = seen.current;
    const mx = c.me ? c.me.x : NaN, mz = c.me ? c.me.z : NaN;
    if (k.seq === spireView.hoverSeq && k.tick === c.tick && Object.is(k.mx, mx) && Object.is(k.mz, mz) && k.n === c.bullets.length) return;
    k.seq = spireView.hoverSeq; k.tick = c.tick; k.mx = mx; k.mz = mz; k.n = c.bullets.length;
    const damage = spireBulletDamage(c.phase, spireEnraged(c.startTick, c.tick + 1));
    const v: HoverVerdict | null = h && c.me ? hoverVerdict(c.bullets, c.tick, c.me, h, c.safety, SPIRE_BLOCKED, damage) : null;
    const g = group.current;
    if (g) {
      g.visible = !!v;
      if (v) { g.position.set(v.tile.x - TILE_ORIGIN, 0.06, v.tile.z - TILE_ORIGIN); hoverMat.color.set(HOVER_COLOR[v.kind]); }
    }
    const next = v?.kind === 'hit' ? { tile: v.tile, damage: v.damage } : null;
    setHit((old) => (old?.tile.x === next?.tile.x && old?.tile.z === next?.tile.z && old?.damage === next?.damage ? old : next));
  });
  return <group ref={group} visible={false}>
    <mesh geometry={hoverGeo} material={hoverMat} raycast={() => null} renderOrder={5} />
    {hit && <Html center position={[0, 0.5, 0]} zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
      <div className="spire-hover-hit">-{hit.damage}</div>
    </Html>}
  </group>;
}

export default function SpireOverlay(_props: SpireOverlayProps) {
  const tick = useTick();
  const me = useMyPlayer();
  const fight = useBossStore((s) => s.fight);
  const run = useBossStore((s) => s.myRun);
  const assist = useSettingsStore((s) => s.dodgeAssist);
  const bullets = fight ? spireFightBullets(fight) : EMPTY_BULLETS;
  const meTile: Tile | null = me ? { x: me.x, z: me.z } : null;
  const meKey = meTile ? `${meTile.x},${meTile.z}` : '';

  const danger = useMemo(() => overlayDanger(bullets, tick), [bullets, tick]);
  const tele = useMemo(() => chargeTelegraph(bullets, tick), [bullets, tick]);
  const runKey = run ? String(run.id) : '';
  const safety = useMemo(() => (fight && runKey ? fightSafety(runKey, fight, bullets, SPIRE_BLOCKED) : null),
    // Rebuilt only when the pattern rotates (curStart/prevStart move with `bullets`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runKey, bullets]);
  const dots = useMemo(() => (assist && meTile ? assistDots(safety, tick, meTile) : EMPTY_KEYS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assist, safety, tick, meKey]);

  // Pillars glow while their volley charges; one warn per tick a new volley enters the window.
  const warned = useRef(new Set<number>());
  useEffect(() => {
    let mask = 0;
    for (const p of tele.pillars) mask |= 1 << p;
    spireView.pillarGlow = mask;
    let fresh = false;
    for (const F of tele.fireTicks) if (!warned.current.has(F)) { warned.current.add(F); fresh = true; }
    for (const F of warned.current) if (F < tick - 4) warned.current.delete(F);
    if (fresh) audio.play('warn', { volume: 0.45 });
  }, [tele, tick]);
  useEffect(() => () => { spireView.pillarGlow = 0; }, []);


  return <>
    <DangerTiles tiles={danger.amber} color="#ffb547" opacity={0.18} />
    <DangerTiles tiles={danger.red} color="#ff4d5e" opacity={0.42} stripes y={0.034} />
    <DangerTiles tiles={tele.tiles} color="#c9a7ff" opacity={0.4} size={0.42} y={0.038} />
    {assist && <DangerTiles tiles={dots} color="#5ff2a0" opacity={0.9} size={0.2} y={0.044} />}
    {meTile && <mesh geometry={markerGeo} material={markerMat} position={[meTile.x - TILE_ORIGIN, 0.05, meTile.z - TILE_ORIGIN]} raycast={() => null} renderOrder={4} />}
    <SpireHover input={{ bullets, tick, me: meTile, safety, phase: fight?.phase ?? 1, startTick: run?.startTick ?? 0 }} />
  </>;
}
