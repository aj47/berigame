import React from 'react';
import { Html } from '@react-three/drei';
import { BufferGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, MeshBasicMaterial, MeshStandardMaterial, CircleGeometry, OctahedronGeometry } from 'three';
import { HARVEST_TICKS, TICK_MS, getItemDef, tileToWorld } from '@sim';
import type { Player, Tree } from '../../module_bindings/types';
import { useGameActions } from '../../spacetime/actions';
import { useMyIdentityHex, useMyPlayer, usePlayerByHex } from '../../spacetime/hooks';
import { identityHex } from '../../spacetime/identity';
import { useUserInputStore } from '../../store';
import { merged, part, withWind } from './envArt';
import HarvestRing from '../../fx/HarvestRing';

type V3 = [number, number, number];
const BARK = 0x8a6a45, BARK_DARK = 0x6b4a2e;
const ico = (r = 1, d = 0) => new IcosahedronGeometry(r, d);
const cyl = (r0: number, r1: number, h: number, s = 6) => new CylinderGeometry(r1, r0, h, s);

/**
 * Each berry has its own silhouette so it reads from the game camera:
 * strawberry a low wide bush, blueberry a round dense shrub, greenberry a
 * tiered spire, goldberry (the best heal) a small palm with hanging fruit.
 * Each tree is one merged vertex-coloured body plus one merged berry cluster.
 */
interface Shape { body: BufferGeometry; berries: BufferGeometry; unripe: BufferGeometry; }
function shape(id: string): Omit<Shape, 'unripe'> & { unripe?: BufferGeometry } {
  let unripe: BufferGeometry | undefined;
  // Regrowing trees keep small pale berries at the same spots, so the tree still reads as a berry tree.
  const berryAt = (spots: V3[], geo: () => BufferGeometry, scale: V3) => {
    unripe = merged(spots.map((p, i) => part(geo(), 0xffffff, p, [scale[0] * .5, scale[1] * .5, scale[2] * .5], [0, i, 0], 0.18, i + 3)));
    return merged(spots.map((p, i) => part(geo(), 0xffffff, p, scale, [0, i, 0], 0.18, i + 3)));
  };
  if (id === 'berry_strawberry') {
    const body = merged([
      part(cyl(.16, .12, .7), BARK, [0, .35, 0], [1, 1, 1], [0, 0, 0], .2, 1),
      part(ico(.95, 0), 0x3e8e41, [0, 1.0, 0], [1.15, .62, 1.05], [0, .3, 0], .22, 2),
      part(ico(.7, 0), 0x57a64a, [-.45, 1.25, .2], [1, .7, 1], [0, 1, 0], .22, 3),
      part(ico(.62, 0), 0x6cb85a, [.4, 1.35, -.15], [1, .7, 1], [0, 2, 0], .22, 4),
      part(ico(.5, 0), 0x2f6e3a, [.55, .85, .5], [1, .6, 1], [0, 0, 0], .2, 5),
    ]);
    const cone = () => new ConeGeometry(.13, .3, 5).rotateX(Math.PI);
    const berries = berryAt([[-.8, .95, .55], [.2, .9, .95], [.95, 1.05, .35], [-.35, 1.55, .6], [.6, 1.5, .45], [-1.0, 1.1, -.2], [.1, 1.0, -.95], [.85, .95, -.5]], cone, [1, 1, 1]);
    return { body, berries, unripe };
  }
  if (id === 'berry_blueberry') {
    const body = merged([
      part(cyl(.17, .12, 1.1), BARK_DARK, [0, .55, 0], [1, 1, 1], [0, 0, 0], .2, 1),
      part(ico(.95, 1), 0x2f7a4a, [0, 1.65, 0], [1, .9, 1], [0, 0, 0], .2, 2),
      part(ico(.6, 0), 0x3f9458, [-.62, 1.5, .35], [1, 1, 1], [0, .5, 0], .2, 3),
      part(ico(.6, 0), 0x3f9458, [.6, 1.55, .3], [1, 1, 1], [0, 1.5, 0], .2, 4),
      part(ico(.55, 0), 0x55a866, [.05, 2.3, .05], [1, .9, 1], [0, .2, 0], .2, 5),
    ]);
    const spots: V3[] = [];
    for (const [x, y, z] of [[-.7, 1.55, .8], [.72, 1.7, .72], [0, 2.1, .85], [.95, 1.9, -.3], [-.85, 2.0, -.4], [.1, 1.4, -1.0]] as V3[])
      for (const [dx, dy, dz] of [[0, 0, 0], [.14, -.08, .02], [-.06, -.14, .08]] as V3[]) spots.push([x + dx, y + dy, z + dz]);
    const berries = berryAt(spots, () => ico(.1, 0), [1, 1, 1]);
    return { body, berries, unripe };
  }
  if (id === 'berry_greenberry') {
    const body = merged([
      part(cyl(.14, .09, 1.5), BARK, [0, .75, 0], [1, 1, 1], [0, 0, 0], .2, 1),
      part(new ConeGeometry(1.0, 1.0, 7), 0x3e8e41, [0, 1.25, 0], [1, 1, 1], [0, 0, 0], .2, 2),
      part(new ConeGeometry(.78, .9, 7), 0x55a14a, [0, 1.85, 0], [1, 1, 1], [0, .4, 0], .2, 3),
      part(new ConeGeometry(.52, .8, 6), 0x70b85a, [0, 2.4, 0], [1, 1, 1], [0, .9, 0], .2, 4),
    ]);
    const spots: V3[] = [];
    for (let i = 0; i < 7; i++) { const a = i * 0.9; const r = i % 2 ? .78 : .95; const y = i % 2 ? 1.42 : .82; spots.push([Math.cos(a) * r, y, Math.sin(a) * r]); }
    spots.push([.45, 2.02, .35], [-.4, 2.05, .3]);
    const berries = berryAt(spots, () => ico(.15, 0), [1, 1, 1]);
    return { body, berries, unripe };
  }
  // Goldberry: a leaning little palm, fruit hanging under the crown.
  const trunk = [0, 1, 2, 3].map((i) => part(cyl(.16 - i * .02, .14 - i * .02, .62), i % 2 ? BARK : BARK_DARK, [i * i * .03, .3 + i * .58, 0], [1, 1, 1], [0, 0, -i * .07], .15, i));
  const fronds = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const a = i / 7 * Math.PI * 2 + .3;
    const g = new OctahedronGeometry(1, 0).scale(.62, .07, .2).translate(.62, 0, 0).rotateZ(-.42 - (i % 2) * .18).rotateY(a);
    return part(g, i % 2 ? 0x3e8e41 : 0x5aa84a, [.2, 2.55, 0], [1, 1, 1], [0, 0, 0], .2, 10 + i);
  });
  const body = merged([...trunk, ...fronds, part(ico(.2, 0), 0x2f6e3a, [.2, 2.55, 0], [1, 1, 1], [0, 0, 0], .2, 30)]);
  const berries = berryAt([[.42, 2.32, .1], [.05, 2.3, .2], [.25, 2.28, -.22], [.3, 2.15, .28], [-.02, 2.2, -.12]], () => ico(.17, 0), [1, 1.1, 1]);
  return { body, berries, unripe };
}

const shapes = new Map<string, Shape>();
const getShape = (id: string) => { let s = shapes.get(id); if (!s) { s = shape(id) as Shape; shapes.set(id, s); } return s; };

// Shared materials: every tree uses the same few programs.
const bodyMat = withWind(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .9 }), .03, .9);
const bodyFaded = withWind(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .9, transparent: true, opacity: .38, depthWrite: false }), .03, .9);
const unripeMat = withWind(new MeshStandardMaterial({ vertexColors: true, color: '#b8cf86', flatShading: true, roughness: .9 }), .03, .9);
const berryMats = new Map<string, MeshStandardMaterial>();
const berryMat = (color: string) => {
  let m = berryMats.get(color);
  if (!m) { m = withWind(new MeshStandardMaterial({ vertexColors: true, color, emissive: color, emissiveIntensity: .18, flatShading: true, roughness: .55 }), .03, .9); berryMats.set(color, m); }
  return m;
};
const shadowGeo = new CircleGeometry(.85, 10).rotateX(-Math.PI / 2);
const shadowMat = new MeshBasicMaterial({ color: '#2f4a2a', transparent: true, opacity: .22, depthWrite: false });

interface Props { tree: Tree; tick: number; harvester: Player | null; }
const BerryTree = ({ tree, tick, harvester }: Props) => {
  const setClickedOtherObject = useUserInputStore((s: any) => s.setClickedOtherObject);
  const { startHarvest } = useGameActions();
  const me = useMyPlayer();
  const myHex = useMyIdentityHex();
  // Only your row and your target's: other players' moves do not re-render every tree.
  const target = usePlayerByHex(me?.combatTarget ? identityHex(me.combatTarget) : null);
  const faded = [me, target].some((p) => p && Math.hypot(p.x-tree.x, p.z-tree.z) < 2.3);
  const def = getItemDef(tree.itemId);
  const [wx, wy, wz] = tileToWorld(tree);
  const regrowTicks = Math.max(0, tree.cooldownUntilTick - tick);
  const busy = tree.harvester !== undefined;
  const endTick = harvester?.harvestEndTick ?? 0;
  const label = busy ? (harvester && myHex && identityHex(harvester.identity) === myHex ? 'You are harvesting' : `${harvester?.name ?? 'Someone'} is harvesting`) : regrowTicks > 0 ? `Regrowing (${Math.ceil(regrowTicks * TICK_MS / 1000)}s)` : `Harvest ${def?.name ?? 'berries'}`;
  const disabled = busy || regrowTicks > 0;
  const onClick = (e: any) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    setClickedOtherObject({ connectionId: def?.name ?? 'Berry tree', e, dropdownOptions: [{ label, disabled, onClick: () => { if (!disabled) startHarvest(tree.id); setClickedOtherObject(null); } }] });
  };
  const s = getShape(tree.itemId);
  const ripe = regrowTicks === 0;
  return <group position={[wx, wy, wz]} onClick={onClick}>
    <mesh geometry={s.body} material={faded ? bodyFaded : bodyMat} />
    <mesh geometry={shadowGeo} material={shadowMat} position={[0, .015, 0]} />
    <mesh geometry={ripe ? s.berries : s.unripe} material={ripe ? berryMat(def?.color ?? '#d9423b') : unripeMat} />
    {busy && endTick > 0 && <HarvestRing endTick={endTick} totalTicks={HARVEST_TICKS} color={def?.color} y={3.05} />}
    {(busy || regrowTicks > 0) && <Html zIndexRange={[3,0]} position={[0,busy ? 3.7 : 2.9,0]} center style={{ pointerEvents:'none' }}>
      <div className="harvest-progress"><div>{busy ? `Gathering ${def?.name}` : label}</div></div>
    </Html>}
  </group>;
};
export default React.memo(BerryTree);
