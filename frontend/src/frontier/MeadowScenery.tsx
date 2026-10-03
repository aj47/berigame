import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { InstancedMesh, Object3D, Group } from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Resource } from '../../../shared/sim/frontier/model';
import { resourcePresentation } from './resourcePresentation';
import { getItemDef } from '@sim';
import { PLOTS, RESOURCE_PATCHES, type RegionId } from '../../../shared/sim/frontier/catalog';
import { regionLand } from '../../../shared/sim/frontier/regions';
import { AdventureAssetView } from '../Components/3D/AdventureModels';
import { berryBodyMaterial, berryFruitMaterial, getBerryShape } from '../Components/3D/BerryTree';
import { islandForestGeometry, islandForestMaterial } from '../Components/3D/IslandLandmarks';
import { linear } from '../Components/3D/nodes/lowPoly';
import { meadowGeometry, meadowMaterial, meadowMaterials, meadowResourceGeometry, type MeadowShape } from './meadowSceneryArt';

type Decoration = { x: number; z: number; scale: number; height?: number; rotation?: number };
const noRaycast = () => null;
const blossoms = [0xef4444, 0xf59e0b, 0xffffff, 0xf472b6, 0x818cf8, 0xfde68a].map(linear);
const noise = (x: number, z: number, seed = 1) => {
  const value = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
};

function GroveInstances({ points, kind }: { points: Decoration[]; kind: MeadowShape }) {
  const ref = useRef<InstancedMesh>(null);
  const tree = kind === 'fir' || kind === 'sapling';
  useLayoutEffect(() => {
    const object = new Object3D();
    points.forEach((p, i) => {
      object.position.set(p.x - 25, 0, p.z - 25);
      object.rotation.set(0, p.rotation ?? noise(p.x, p.z, 9) * Math.PI * 2, 0);
      object.scale.set(p.scale, p.scale * (p.height ?? 1), p.scale);
      object.updateMatrix();
      ref.current?.setMatrixAt(i, object.matrix);
      if (kind === 'flowers') ref.current?.setColorAt(i, blossoms[i % blossoms.length]);
    });
    if (ref.current) {
      ref.current.instanceMatrix.needsUpdate = true;
      if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
    }
  }, [points, kind]);
  return <instancedMesh ref={ref} args={[meadowGeometry[kind], meadowMaterials[kind], points.length]}
    frustumCulled={false} castShadow={tree} receiveShadow raycast={noRaycast} dispose={null} />;
}

function ResourceShape({ item }: { item: string }) {
  if (item.startsWith('berry_')) {
    const shape = getBerryShape(item);
    return <group dispose={null}>
      <mesh geometry={shape.body} material={berryBodyMaterial} />
      <mesh geometry={shape.berries} material={berryFruitMaterial(getItemDef(item)?.color ?? '#d9423b')} />
    </group>;
  }
  if (item === 'timber') return <mesh geometry={meadowResourceGeometry.timber} material={meadowMaterial} scale={.84} dispose={null} castShadow />;
  if (item === 'resin') return <mesh geometry={islandForestGeometry} material={islandForestMaterial} scale={.84} dispose={null} />;
  const geometry = ['fibre', 'reeds', 'carrot_seed'].includes(item) ? meadowResourceGeometry.fibre
    : item === 'clay' ? meadowResourceGeometry.clay : item === 'iron_ore' ? meadowResourceGeometry.iron : meadowResourceGeometry.stone;
  return <mesh geometry={geometry} material={meadowMaterial} dispose={null} />;
}

export function ResourceModel({ item, resource }: { item: string; resource?: Partial<Resource> }) {
  const tree = useRef<Group>(null), stump = useRef<Group>(null), progress = useRef<HTMLDivElement>(null);
  useFrame(() => {
    const now = Date.now(), view = resourcePresentation(resource, now);
    if (tree.current) {
      if (item === 'timber') {
        tree.current.visible = view.treeScale > .015;
        tree.current.scale.setScalar(view.treeScale);
        tree.current.rotation.z = view.falling ? -(view.fall * view.fall) * Math.PI * .47
          : resource?.harvest ? Math.sin(now / 47) * .012 * Math.sin(view.progress * Math.PI) : 0;
        tree.current.position.y = view.falling ? -.16 * view.fall : 0;
      } else tree.current.rotation.z = resource?.harvest ? Math.sin(now / 110) * .018 : 0;
    }
    if (stump.current) stump.current.visible = item === 'timber' && view.showStump;
    if (progress.current) progress.current.style.transform = `scaleX(${view.progress})`;
  });
  return <group>
    <group ref={tree}><ResourceShape item={item}/></group>
    {item === 'timber' && <group ref={stump} visible={!!resource?.regrowsAt}>
      <mesh position={[0,.2,0]} castShadow><cylinderGeometry args={[.2,.29,.4,7]}/><meshStandardMaterial color="#755034"/></mesh>
      <mesh position={[0,.407,0]} rotation={[-Math.PI/2,0,0]}><circleGeometry args={[.19,7]}/><meshStandardMaterial color="#ccab79"/></mesh>
    </group>}
    {resource?.harvest && <Html center position={[0,item === 'timber' ? 3.3 : 1.7,0]} style={{ pointerEvents:'none' }} zIndexRange={[3,0]}>
      <div style={{ width:74,padding:'4px 6px',borderRadius:6,background:'rgba(26,39,25,.88)',color:'#fff8df',font:'10px system-ui',textAlign:'center',whiteSpace:'nowrap' }}>
        {item === 'timber' ? 'Chopping' : 'Gathering'}
        <div style={{ height:3,marginTop:3,background:'#506448',borderRadius:2,overflow:'hidden' }}><div ref={progress} style={{ height:'100%',background:'#dcc16c',transformOrigin:'left',transform:'scaleX(0)' }}/></div>
      </div>
    </Html>}
  </group>;
}

export default function MeadowScenery({ region, claimed }: { region: RegionId; claimed: string[] }) {
  const decoration = useMemo(() => {
    const points: Record<MeadowShape, Decoration[]> = { fir: [], sapling: [], shrub: [], grass: [], flowers: [], rock: [] };
    const plots = PLOTS.filter(p => p.region === region);
    const resources = RESOURCE_PATCHES.filter(p => p.region === region);
    const owned = new Set(claimed);
    const townX = region === 'settlement' ? 31 : 5;
    const inside = (x: number, z: number, radius: number) => [-1, 1].every(dx => [-1, 1].every(dz =>
      regionLand(region, { x: Math.round(x + dx * radius), z: Math.round(z + dz * radius) })));
    const touchesClaim = (x: number, z: number, radius: number) => plots.some(p => owned.has(p.id)
      && x + radius >= p.x - 1 && x - radius <= p.x + 16 && z + radius >= p.z - 1 && z - radius <= p.z + 16);
    const onRoad = (x: number, z: number, radius: number) =>
      (region === 'settlement' && x < 32 && Math.abs(z - 64) < 1.4 + radius)
      || Math.abs(x - townX) < 1.4 + radius
      || plots.some(p => Math.abs(z - (p.z - 2)) < 1.15 + radius && x < 102);
    const clear = (x: number, z: number, radius: number) => inside(x, z, radius)
      && !touchesClaim(x, z, radius) && !onRoad(x, z, radius)
      && !(region === 'settlement' && x - radius < 9 && z + radius > 60 && z - radius < 68)
      && !resources.some(p => Math.hypot(x - p.x, z - p.z) < 2.1 + radius)
      && ((x - townX) / (4.7 + radius)) ** 2 + ((z - 64) / (12 + radius)) ** 2 > 1;

    // Jittered placement and broad density patches leave irregular glades between groves.
    for (let gz = 3; gz < 126; gz += 2.6) for (let gx = 3; gx < 126; gx += 2.6) {
      const x = gx + (noise(gx, gz, 2) - .5) * 2.1;
      const z = gz + (noise(gx, gz, 3) - .5) * 2.1;
      const n = noise(gx, gz, 4);
      const grove = .48 + Math.sin(x * .15 + Math.cos(z * .07)) * .21 + Math.cos(z * .19 - x * .045) * .2;
      const plotClearing = plots.some(p => x > p.x - 1 && x < p.x + 9.2 && z > p.z - 1 && z < p.z + 9.2);
      const scale = .65 + noise(gx, gz, 5) * .42;
      if (!plotClearing && n < grove * .56 && clear(x, z, scale * 1.65)) {
        const kind = noise(gx, gz, 6) < .65 ? 'fir' : 'sapling';
        points[kind].push({ x, z, scale, height: .87 + noise(gx, gz, 8) * .29 });
        // Young understory grows beside some mature trees, rather than in an even grid.
        const sx = x + 1.05, sz = z + .65;
        if (n < .2 && clear(sx, sz, .65)) points.shrub.push({ x: sx, z: sz, scale: .85 + n });
      } else if (clear(x, z, .5)) {
        if (!plotClearing && n > .91) points.rock.push({ x, z, scale: .14 + n * .13, height: .6 });
        else if (n > .58 && n < .76) points.flowers.push({ x, z, scale: .2 + n * .08 });
        else if (n < .53) points.grass.push({ x, z, scale: .22 + n * .2 });
      }
    }

    if (region === 'settlement') {
      // The steward's clearing has the same native undergrowth as the rest of the island.
      const town: Array<[MeadowShape, number, number, number, number]> = [
        ['shrub', 35.6, 60.2, .7, Math.PI / 2], ['shrub', 35.8, 70.8, .8, 0],
        ['shrub', 27.1, 66.1, .75, Math.PI / 2],
        ['sapling', 27, 58, .8, .4], ['fir', 35.7, 78.8, .78, 2.1],
      ];
      for (const [kind, x, z, scale, rotation] of town) {
        if (!touchesClaim(x, z, scale) && inside(x, z, scale)
          && !resources.some(p => Math.hypot(x - p.x, z - p.z) < 2.1 + scale)) {
          points[kind].push({ x, z, scale, rotation });
        }
      }
    }
    return points;
  }, [region, claimed.join(',')]);

  return <group name="meadow_groves">
    {(Object.keys(decoration) as MeadowShape[]).map(kind => <GroveInstances key={kind} kind={kind} points={decoration[kind]} />)}
    {region === 'settlement' && <>
      <group position={[9,0,35]} rotation={[0,-.55,0]}><AdventureAssetView asset="workshop" scale={.8}/></group>
      <group position={[9,0,43]} rotation={[0,-.6,0]}><AdventureAssetView asset="market" scale={.7}/></group>
      <group position={[9,0,37.5]}><AdventureAssetView asset="handcart" scale={.8}/></group>
      <group position={[4,0,36.5]}><AdventureAssetView asset="feast" scale={.55}/></group>
    </>}
  </group>;
}
