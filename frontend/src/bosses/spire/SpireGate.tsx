import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, MeshBasicMaterial, Points, PointsMaterial, Vector3 } from 'three';
import { BossEventKind, BossId, SPIRE_CENTRE, SPIRE_GATE, tileToWorld } from '@sim';
import { LowPolyBuilder, coastMaterial, linear } from '../../Components/3D/nodes/lowPoly';
import { holdState } from '../../Components/3D/tapAssist';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';
import { useUserInputStore } from '../../store';
import { useBossStore } from '../bossStore';
import { spireActiveRuns } from '../selectors';

/**
 * The Spire Gate at (62,45) (FINAL_SPEC 7.3): an obsidian arch over a spiral
 * stair, glowing while runs are Active, motes rising from the sea. Hover
 * shows the parties inside; a click calls `useBossStore.getState().setLobbyOpen(true)`.
 * It flashes when a run starts (SpireRunStart).
 */
export type SpireGateProps = Record<string, never>;

const [GX, , GZ] = tileToWorld(SPIRE_GATE);
/** The arch faces the sunken floor. */
const YAW = Math.atan2(SPIRE_CENTRE.x - SPIRE_GATE.x, SPIRE_CENTRE.z - SPIRE_GATE.z);

/** Procedural low-poly arch and stair (about 400 triangles), one draw call with the shared Coast material. */
export function buildGateGeometry(): BufferGeometry {
  const b = new LowPolyBuilder();
  const obsidian = [0x2a2238, 0x3a2f52, 0x231c30].map(linear), edge = linear(0x5b4a8f);
  // Two leaning posts and an arc of 5 segments over them.
  const arc: Vector3[] = [];
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI * (i / 6);
    arc.push(new Vector3(Math.cos(a) * 1.05, 2.0 + Math.sin(a) * 0.75, 0));
  }
  b.log(new Vector3(-1.1, 0, 0), new Vector3(-1.05, 2.0, 0), 0.26, 0.2, { sides: 5, rings: 3, wobble: 0.04, seed: 11, bark: obsidian, cap: edge });
  b.log(new Vector3(1.1, 0, 0), new Vector3(1.05, 2.0, 0), 0.26, 0.2, { sides: 5, rings: 3, wobble: 0.04, seed: 12, bark: obsidian, cap: edge });
  for (let i = 0; i < arc.length - 1; i++) {
    b.log(arc[i], arc[i + 1], 0.19, 0.19, { sides: 5, rings: 2, seed: 20 + i, bark: obsidian, cap: edge });
  }
  // Spiral stair stones winding down through the arch.
  for (let i = 0; i < 7; i++) {
    const a = i * 0.75, r = 0.55, y = 0.06 - i * 0.12;
    const c = new Vector3(Math.cos(a) * r * 0.6, y, Math.sin(a) * r);
    b.rock(c, 0.32, new Vector3(1.1, 0.28, 0.75), { segments: 5, jitter: 0.15, seed: 40 + i, colors: obsidian, top: edge });
  }
  return b.build();
}

export default function SpireGate(_props: SpireGateProps) {
  const runs = useBossStore((s) => s.runs);
  const events = useBossStore((s) => s.events);
  const graphics = useSettingsStore((s) => s.graphics);
  const reduced = useSettingsStore((s) => s.reduceMotion);
  const active = spireActiveRuns({ runs });
  const geometry = useMemo(buildGateGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const portal = useMemo(() => new MeshBasicMaterial({ color: '#9f7bff', transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false, blending: AdditiveBlending }), []);
  useEffect(() => () => portal.dispose(), [portal]);

  // Flash on a run start.
  const flashAt = useRef(-Infinity);
  const lastSeq = useRef(events.length ? events[events.length - 1].seq : 0);
  useEffect(() => {
    for (const e of events) {
      if (e.seq <= lastSeq.current) continue;
      if (e.row.boss === BossId.Spire && e.row.kind === BossEventKind.SpireRunStart) flashAt.current = performance.now();
    }
    if (events.length) lastSeq.current = events[events.length - 1].seq;
  }, [events]);

  const activeRef = useRef(active);
  activeRef.current = active;
  useFrame(({ clock }) => {
    const glow = activeRef.current > 0 ? 0.45 + (reduced ? 0 : Math.sin(clock.elapsedTime * 2.2) * 0.12) : 0.14;
    const flash = Math.max(0, 1 - (performance.now() - flashAt.current) / 900);
    portal.opacity = Math.min(1, glow + flash * 0.55);
  });

  const onClick = (e: any) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    if (holdState.active || performance.now() < holdState.suppressClickUntil) return;
    useUserInputStore.getState().setClickedOtherObject(null);
    useBossStore.getState().setLobbyOpen(true);
  };

  return <group position={[GX, 0, GZ]} rotation={[0, YAW, 0]} name="spire-gate" onClick={onClick} userData={{ hoverTarget: {
    title: 'The Sunken Spire',
    action: 'Click to open the gate',
    detail: active === 0 ? 'No party inside' : `${active} ${active === 1 ? 'party' : 'parties'} inside`,
    click: 'panel', radius: 1.8, tone: active > 0 ? 'ready' : 'muted',
  } }}>
    <mesh geometry={geometry} material={coastMaterial()} castShadow />
    <mesh position={[0, 1.35, 0]} material={portal}>
      <planeGeometry args={[1.85, 2.7]} />
    </mesh>
    {/* Fills the arch for clicks and hover; hidden meshes without handlers of their own still bubble to the group. */}
    <mesh position={[0, 1.3, 0]} visible={false}><boxGeometry args={[2.6, 2.8, 1.4]} /><meshBasicMaterial /></mesh>
    {graphics !== 'low' && !reduced && <GateMotes />}
  </group>;
}

/** Motes rising from the sea through the arch (decorative: skipped on Low graphics and with reduced motion). */
function GateMotes() {
  const points = useMemo(() => {
    const n = 18, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = ((i * 0.618) % 1) * 1.6 - 0.8; pos[i * 3 + 1] = (i * 0.29) % 3; pos[i * 3 + 2] = ((i * 0.37) % 1) - 0.5; }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    const p = new Points(g, new PointsMaterial({ color: '#c6b5ff', size: 0.09, transparent: true, opacity: 0.75, depthWrite: false, blending: AdditiveBlending }));
    p.raycast = () => {};
    return p;
  }, []);
  useEffect(() => () => { points.geometry.dispose(); (points.material as PointsMaterial).dispose(); }, [points]);
  useFrame((_, dt) => {
    const a = points.geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < a.count; i++) { let y = a.getY(i) + dt * 0.45; if (y > 3) y = 0; a.setY(i, y); }
    a.needsUpdate = true;
  });
  return <primitive object={points} />;
}
