import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, Color, DoubleSide, InstancedMesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import { CLATTER_DIR8, CLATTER_GLADE, CLATTER_HOME, CLATTER_STONES, ClatterState, tileToWorld } from '@sim';
import { LowPolyBuilder, linear, seeded } from '../../Components/3D/nodes/lowPoly';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';
import { useBossStore } from '../bossStore';
import { useClatterFxStore } from './clatterFx';

/**
 * Clatterhorn's Glade dressing (FINAL_SPEC 7.2): the 8 standing stones
 * (instanced and mossy; their runes glow while the beetle lies flipped, the
 * stone it hit brightest) and a ring of pale mushrooms on the glade border,
 * never raycast. Mounted with the overworld props by GameComponent (WP9).
 */
export type ClatterGladeProps = Record<string, never>;

const STONE = linear(0x8a8d86), STONE_DARK = linear(0x6a6d68), MOSS = linear(0x6f8f3e), MOSS_DARK = linear(0x557232);
const STEM = linear(0xefe6d2), CAP = linear(0xf4ece0), CAP_SPOT = linear(0xd9c9b3);
const noRaycast = () => null;

function buildStone(): BufferGeometry {
  const b = new LowPolyBuilder();
  b.rock(new Vector3(0, 0.82, 0), 0.6, new Vector3(0.78, 1.55, 0.6), { segments: 7, seed: 101, jitter: 0.14, colors: [STONE, STONE_DARK, STONE], top: MOSS });
  b.rock(new Vector3(0.05, 0.1, 0.02), 0.5, new Vector3(1.1, 0.35, 0.95), { segments: 6, seed: 102, colors: [MOSS_DARK, STONE_DARK], top: MOSS });
  return b.build();
}

/** A rune (an algiz-like mark) on the +z face: three strokes as thin quads. */
function buildRune(): BufferGeometry {
  const b = new LowPolyBuilder();
  const white = new Color(1, 1, 1);
  const stroke = (x0: number, y0: number, x1: number, y1: number, w: number) => {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * w, ny = (dx / len) * w;
    const a = new Vector3(x0 + nx, y0 + ny, 0), bb = new Vector3(x1 + nx, y1 + ny, 0);
    const c = new Vector3(x1 - nx, y1 - ny, 0), d = new Vector3(x0 - nx, y0 - ny, 0);
    b.triangle(a, d, c, white); b.triangle(a, c, bb, white);
  };
  stroke(0, -0.32, 0, 0.32, 0.035);
  stroke(0, 0.05, -0.17, 0.3, 0.03);
  stroke(0, 0.05, 0.17, 0.3, 0.03);
  return b.build();
}

function buildMushroom(): BufferGeometry {
  const b = new LowPolyBuilder();
  b.log(new Vector3(0, 0, 0), new Vector3(0.02, 0.2, 0), 0.04, 0.03, { sides: 5, rings: 2, seed: 111, bark: [STEM], cap: STEM });
  b.rock(new Vector3(0.02, 0.22, 0), 0.12, new Vector3(1, 0.45, 1), { segments: 6, seed: 112, colors: [CAP_SPOT, CAP], top: CAP });
  return b.build();
}

let geos: { stone: BufferGeometry; rune: BufferGeometry; mushroom: BufferGeometry } | null = null;
const gladeGeos = () => geos ??= { stone: buildStone(), rune: buildRune(), mushroom: buildMushroom() };
let mats: { stone: MeshStandardMaterial; rune: MeshBasicMaterial; mushroom: MeshStandardMaterial } | null = null;
const gladeMats = () => mats ??= {
  stone: new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 }),
  rune: new MeshBasicMaterial({ color: '#3f6a60', transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, side: DoubleSide }),
  mushroom: new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, emissive: new Color('#c8d8c0'), emissiveIntensity: 0.12 }),
};

/** Mushroom spots on the glade border (world x, z, yaw, scale): deterministic. */
export function mushroomRing(): [number, number, number, number][] {
  const rand = seeded(1337);
  const out: [number, number, number, number][] = [];
  const x0 = CLATTER_GLADE.x0 - 0.5, x1 = CLATTER_GLADE.x1 + 0.5, z0 = CLATTER_GLADE.z0 - 0.5, z1 = CLATTER_GLADE.z1 + 0.5;
  const edges: [number, number, number, number][] = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
  for (const [ax, az, bx, bz] of edges) {
    const len = Math.hypot(bx - ax, bz - az), n = Math.round(len / 1.5);
    for (let i = 0; i < n; i++) {
      const t = (i + rand() * 0.6) / n;
      const [wx, , wz] = tileToWorld({ x: ax + (bx - ax) * t + (rand() - 0.5) * 0.3, z: az + (bz - az) * t + (rand() - 0.5) * 0.3 });
      out.push([wx, wz, rand() * Math.PI * 2, 0.8 + rand() * 0.7]);
    }
  }
  return out;
}

/** Index into CLATTER_STONES of the stone a flipped beetle hit (two past its centre along its last charge), or -1. */
export function struckStone(row: { state: number; x: number; z: number; dir: number } | null): number {
  if (!row || row.state !== ClatterState.Flipped) return -1;
  const d = CLATTER_DIR8[row.dir & 7];
  const x = row.x + 2 * d[0], z = row.z + 2 * d[1];
  return CLATTER_STONES.findIndex((s) => s.x === x && s.z === z);
}

const DIM = new Color('#3f6a60'), BRIGHT = new Color('#9fffe6'), GOLD = new Color('#ffd36e');

export default function ClatterGlade(_props: ClatterGladeProps) {
  const stones = useRef<InstancedMesh>(null);
  const runes = useRef<InstancedMesh>(null);
  const shrooms = useRef<InstancedMesh>(null);
  const struckRune = useRef<Object3D>(null);
  const flipped = useBossStore((s) => s.clatter?.state === ClatterState.Flipped);
  const struck = useBossStore((s) => struckStone(s.clatter));
  const low = useSettingsStore((s) => s.graphics === 'low');
  const g = gladeGeos(), m = gladeMats();
  const ring = useMemo(mushroomRing, []);
  const glow = useRef(0);

  const placements = useMemo(() => CLATTER_STONES.map((s, i) => {
    const [x, , z] = tileToWorld(s);
    const [hx, , hz] = tileToWorld(CLATTER_HOME);
    const yaw = Math.atan2(hx - x, hz - z);
    return { x, z, yaw, tilt: ((i * 37) % 7 - 3) * 0.02 };
  }), []);

  useLayoutEffect(() => {
    const o = new Object3D();
    const st = stones.current, rn = runes.current;
    if (st?.setMatrixAt && rn?.setMatrixAt) {
      placements.forEach(({ x, z, yaw, tilt }, i) => {
        o.position.set(x, 0, z); o.rotation.set(tilt, yaw, -tilt); o.scale.setScalar(1); o.updateMatrix();
        st.setMatrixAt(i, o.matrix);
        // The rune faces the glade's heart, on the stone's inner face.
        o.position.set(x + Math.sin(yaw) * 0.36, 0.95, z + Math.cos(yaw) * 0.36); o.rotation.set(0, yaw, 0); o.updateMatrix();
        rn.setMatrixAt(i, o.matrix);
      });
      st.instanceMatrix.needsUpdate = true; rn.instanceMatrix.needsUpdate = true;
    }
    const sh = shrooms.current;
    if (sh?.setMatrixAt) {
      ring.forEach(([x, z, yaw, s], i) => {
        o.position.set(x, 0, z); o.rotation.set(0, yaw, 0); o.scale.setScalar(s); o.updateMatrix();
        sh.setMatrixAt(i, o.matrix);
      });
      sh.instanceMatrix.needsUpdate = true;
    }
  }, [placements, ring, low]);

  useFrame((_, delta) => {
    const reduced = useSettingsStore.getState().reduceMotion;
    const now = performance.now();
    const flareK = Math.max(0, 1 - (now - useClatterFxStore.getState().flipAt) / 900);
    const target = flipped ? 1 : 0;
    glow.current += (target - glow.current) * Math.min(1, delta * 4);
    const pulse = flipped && !reduced ? 0.15 * Math.sin(now * 0.008) : 0;
    const k = Math.min(1, glow.current * (0.85 + pulse) + flareK * 0.5);
    m.rune.color.copy(DIM).lerp(BRIGHT, k);
    m.rune.opacity = 0.55 + 0.45 * k;
    const sr = struckRune.current;
    if (sr) {
      sr.visible = struck >= 0;
      if (struck >= 0) {
        const p = placements[struck];
        sr.position.set(p.x + Math.sin(p.yaw) * 0.38, 0.95, p.z + Math.cos(p.yaw) * 0.38);
        sr.rotation.set(0, p.yaw, 0);
      }
    }
  });

  return (
    <group name="clatter-glade">
      <instancedMesh ref={stones} args={[g.stone, m.stone, CLATTER_STONES.length]} raycast={noRaycast} castShadow receiveShadow />
      <instancedMesh ref={runes} args={[g.rune, m.rune, CLATTER_STONES.length]} raycast={noRaycast} />
      <mesh ref={struckRune as any} geometry={g.rune} visible={false} raycast={noRaycast} scale={[1.25, 1.25, 1.25]}>
        <meshBasicMaterial color={GOLD} transparent opacity={0.95} depthWrite={false} toneMapped={false} side={DoubleSide} />
      </mesh>
      {!low && <instancedMesh key="shrooms" ref={shrooms} args={[g.mushroom, m.mushroom, ring.length]} raycast={noRaycast} />}
    </group>
  );
}
