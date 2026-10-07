import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { RingGeometry } from 'three';
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

  // Safe-move hover: polled from the floor's pointer state, recomputed when the tile or the tick changes.
  const [hover, setHover] = useState<HoverVerdict | null>(null);
  const live = useRef({ bullets, tick, me: meTile, safety, phase: fight?.phase ?? 1, startTick: run?.startTick ?? 0 });
  live.current = { bullets, tick, me: meTile, safety, phase: fight?.phase ?? 1, startTick: run?.startTick ?? 0 };
  const seen = useRef('');
  useFrame(() => {
    const c = live.current, h = spireView.hover;
    const key = `${spireView.hoverSeq}:${c.tick}:${c.me?.x},${c.me?.z}:${c.bullets.length}`;
    if (key === seen.current) return;
    seen.current = key;
    const damage = spireBulletDamage(c.phase, spireEnraged(c.startTick, c.tick + 1));
    const v = h && c.me ? hoverVerdict(c.bullets, c.tick, c.me, h, c.safety, SPIRE_BLOCKED, damage) : null;
    setHover((old) => (old?.kind === v?.kind && old?.tile.x === v?.tile.x && old?.tile.z === v?.tile.z ? old : v));
  });

  return <>
    <DangerTiles tiles={danger.amber} color="#ffb547" opacity={0.18} />
    <DangerTiles tiles={danger.red} color="#ff4d5e" opacity={0.42} stripes y={0.034} />
    <DangerTiles tiles={tele.tiles} color="#c9a7ff" opacity={0.4} size={0.42} y={0.038} />
    {assist && <DangerTiles tiles={dots} color="#5ff2a0" opacity={0.9} size={0.2} y={0.044} />}
    {meTile && <mesh geometry={markerGeo} position={[meTile.x - TILE_ORIGIN, 0.05, meTile.z - TILE_ORIGIN]} raycast={() => null} renderOrder={4}>
      <meshBasicMaterial color="#5ff0ff" toneMapped={false} transparent opacity={0.9} depthWrite={false} />
    </mesh>}
    {hover && <group position={[hover.tile.x - TILE_ORIGIN, 0.06, hover.tile.z - TILE_ORIGIN]}>
      <mesh geometry={hoverGeo} raycast={() => null} renderOrder={5}>
        <meshBasicMaterial color={HOVER_COLOR[hover.kind]} toneMapped={false} transparent opacity={0.95} depthWrite={false} />
      </mesh>
      {hover.kind === 'hit' && <Html center position={[0, 0.5, 0]} zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
        <div className="spire-hover-hit">-{hover.damage}</div>
      </Html>}
    </group>}
  </>;
}
