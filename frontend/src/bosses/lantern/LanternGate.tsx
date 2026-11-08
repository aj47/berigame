import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three';
import { BossEventKind, BossId, LANTERN_CENTRE_TILE, LANTERN_GATE, lanternConfigOr, tileToWorld } from '@sim';
import { LowPolyBuilder, coastMaterial, linear } from '../../Components/3D/nodes/lowPoly';
import { holdState } from '../../Components/3D/tapAssist';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';
import { useUserInputStore } from '../../store';
import { useBossStore } from '../bossStore';
import { lanternActiveRuns } from '../selectors';

/**
 * The Fen Gate at (47,152): a lantern-hung jetty arch on Glimmerfen's north
 * shore, facing the Drowned Hollow. Its two lanterns glow while parties are
 * below, dim while sealed, and flash when a run starts. A click opens the
 * lobby panel (`setLanternLobbyOpen(true)`).
 */
export type LanternGateProps = Record<string, never>;

const [GX, , GZ] = tileToWorld(LANTERN_GATE);
/** The arch faces the drowned floor. */
const YAW = Math.atan2(LANTERN_CENTRE_TILE.x - LANTERN_GATE.x, LANTERN_CENTRE_TILE.z - LANTERN_GATE.z);
const LANTERN_SPOTS: readonly [number, number, number][] = [[-0.75, 1.75, 0.12], [0.75, 1.75, 0.12]];

/** Weathered posts, a crossbeam with two hooks and a short plank deck (one draw call, the shared Coast material). */
export function buildFenGateGeometry(): BufferGeometry {
  const b = new LowPolyBuilder();
  const wood = [0x6b5232, 0x7d6140, 0x5a4428].map(linear), end = linear(0x9c7c52), moss = [0x56663a, 0x4a5a31].map(linear);
  b.log(new Vector3(-1.05, -0.2, 0), new Vector3(-1.0, 2.35, 0), 0.14, 0.11, { sides: 6, rings: 3, wobble: 0.05, seed: 31, bark: wood, cap: end });
  b.log(new Vector3(1.05, -0.2, 0), new Vector3(1.0, 2.35, 0), 0.14, 0.11, { sides: 6, rings: 3, wobble: 0.05, seed: 32, bark: wood, cap: end });
  b.log(new Vector3(-1.3, 2.2, 0), new Vector3(1.3, 2.25, 0), 0.1, 0.1, { sides: 5, rings: 2, seed: 33, bark: wood, cap: end });
  // Lantern hooks hanging from the beam.
  for (const [x] of LANTERN_SPOTS) b.log(new Vector3(x, 2.2, 0.06), new Vector3(x, 1.95, 0.1), 0.02, 0.02, { sides: 4, rings: 1, seed: 34, bark: [linear(0x2b2b2b)], cap: linear(0x2b2b2b) });
  // The jetty deck running out towards the floor.
  for (let i = 0; i < 5; i++) {
    b.rock(new Vector3(0, 0.04, 0.35 + i * 0.42), 0.5, new Vector3(1.8, 0.12, 0.42), { segments: 4, jitter: 0.04, seed: 40 + i, colors: wood, top: end });
  }
  // Moss tufts at the post feet.
  b.rock(new Vector3(-1.05, 0.05, 0), 0.22, new Vector3(1.2, 0.5, 1.2), { segments: 5, jitter: 0.2, seed: 51, colors: moss });
  b.rock(new Vector3(1.05, 0.05, 0), 0.2, new Vector3(1.2, 0.5, 1.2), { segments: 5, jitter: 0.2, seed: 52, colors: moss });
  return b.build();
}

const bulbGeo = new SphereGeometry(0.16, 10, 8);

export default function LanternGate(_props: LanternGateProps) {
  const runs = useBossStore((s) => s.lanternRuns);
  const events = useBossStore((s) => s.events);
  const open = lanternConfigOr(useBossStore((s) => s.lanternConfig)).lanternOpen;
  const reduced = useSettingsStore((s) => s.reduceMotion);
  const active = lanternActiveRuns({ lanternRuns: runs });
  const geometry = useMemo(buildFenGateGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const glow = useMemo(() => new MeshBasicMaterial({ color: '#ffd77a', toneMapped: false, transparent: true, opacity: 0.9 }), []);
  useEffect(() => () => glow.dispose(), [glow]);

  const flashAt = useRef(-Infinity);
  const lastSeq = useRef(events.length ? events[events.length - 1].seq : 0);
  useEffect(() => {
    for (const e of events) {
      if (e.seq <= lastSeq.current) continue;
      if (e.row.boss === BossId.Lanternmaw && e.row.kind === BossEventKind.LanternRunStart) flashAt.current = performance.now();
    }
    if (events.length) lastSeq.current = events[events.length - 1].seq;
  }, [events]);

  const live = useRef({ active, open });
  live.current = { active, open };
  useFrame(({ clock }) => {
    const { active: a, open: o } = live.current;
    const base = !o ? 0.35 : a > 0 ? 1.15 + (reduced ? 0 : Math.sin(clock.elapsedTime * 2.6) * 0.15) : 0.8;
    const flash = Math.max(0, 1 - (performance.now() - flashAt.current) / 900);
    glow.color.setRGB(1, 0.84, 0.48).multiplyScalar(base + flash * 0.8);
  });

  const onClick = (e: any) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    if (holdState.active || performance.now() < holdState.suppressClickUntil) return;
    useUserInputStore.getState().setClickedOtherObject(null);
    useBossStore.getState().setLanternLobbyOpen(true);
  };

  return <group position={[GX, 0, GZ]} rotation={[0, YAW, 0]} name="lantern-gate" onClick={onClick} userData={{ hoverTarget: {
    title: 'The Fen Gate',
    action: 'Click to open the gate',
    detail: !open ? 'Sealed for now' : active === 0 ? 'Lanternmaw waits below' : `${active} ${active === 1 ? 'party' : 'parties'} below`,
    click: 'panel', radius: 1.8, tone: open && active > 0 ? 'ready' : 'muted',
  } }}>
    <mesh geometry={geometry} material={coastMaterial()} castShadow />
    {LANTERN_SPOTS.map((p, i) => <mesh key={i} geometry={bulbGeo} material={glow} position={p} raycast={() => null} />)}
    {/* Fills the arch for clicks and hover. */}
    <mesh position={[0, 1.2, 0.6]} visible={false}><boxGeometry args={[2.6, 2.6, 2.2]} /><meshBasicMaterial /></mesh>
  </group>;
}
