import React, { useId } from 'react';
import { BOULDER_LINE, GRID_SIZE, ISLE_SIZE } from '@sim/constants';
import {
  BRIDGES, BROOK, FOREST_TREES, LANDMARKS, TRAILS,
  groveBoundary, insideGrove, terrainField, terrainLand,
} from '@sim/terrain';
import { BIOMES, CAUSEWAYS, EXPANSE_BRIDGES, EXPANSE_LANDMARKS, RIDGES, WAYSTONES, biomeOf, type BiomeId } from '@sim/expanse';
import './islandMap.css';

export type IslandRegion = 'grove' | 'coast' | 'boulders';
type Point = { x: number; z: number };
type IslandMapProps = {
  selected: IslandRegion;
  onSelect: (region: IslandRegion) => void;
};

const WIDTH = 760;
const HEIGHT = 640;
const SCALE = 2.3;
const project = ({ x, z }: Point) => ({ x: 150 + x * SCALE, y: 22 + z * SCALE });
const pointString = (point: Point) => {
  const { x, y } = project(point);
  return `${x.toFixed(2)},${y.toFixed(2)}`;
};

/** The sampled lattice: every whole tile from PAD tiles outside the grid to PAD tiles past it. */
const PAD = 5, N = GRID_SIZE + PAD * 2 + 1;
type Lattice = Float32Array;
type Bounds = { x0: number; z0: number; x1: number; z1: number };
const FULL: Bounds = { x0: -PAD, z0: -PAD, x1: GRID_SIZE + PAD, z1: GRID_SIZE + PAD };
const at = (field: Lattice, x: number, z: number) => field[(z + PAD) * N + x + PAD];
const derive = (base: Lattice, f: (value: number, x: number, z: number, i: number) => number): Lattice => {
  const out = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) out[i] = f(base[i], i % N - PAD, Math.floor(i / N) - PAD, i);
  return out;
};

/** Trace a sampled field's zero line, preserving the coves, lakes and rivers without a tile grid. */
function contour(field: Lattice, bounds: Bounds = FULL): string {
  const segments: [Point, Point][] = [];
  const key = (p: Point) => `${p.x.toFixed(5)},${p.z.toFixed(5)}`;
  const triangle = (vertices: Point[], values: number[]) => {
    const crossings: Point[] = [];
    for (let edge = 0; edge < 3; edge++) {
      const next = (edge + 1) % 3;
      if ((values[edge] > 0) === (values[next] > 0)) continue;
      const t = values[edge] / (values[edge] - values[next]);
      crossings.push({
        x: vertices[edge].x + t * (vertices[next].x - vertices[edge].x),
        z: vertices[edge].z + t * (vertices[next].z - vertices[edge].z),
      });
    }
    if (crossings.length === 2 && key(crossings[0]) !== key(crossings[1])) segments.push([crossings[0], crossings[1]]);
  };
  // The padded domain keeps every coastline contour closed.
  for (let z = bounds.z0; z < bounds.z1; z++) {
    for (let x = bounds.x0; x < bounds.x1; x++) {
      const values = [at(field, x, z), at(field, x + 1, z), at(field, x + 1, z + 1), at(field, x, z + 1)];
      if (values.every(v => v > 0) || values.every(v => v <= 0)) continue;
      const vertices = [{ x, z }, { x: x + 1, z }, { x: x + 1, z: z + 1 }, { x, z: z + 1 }];
      triangle([vertices[0], vertices[1], vertices[2]], [values[0], values[1], values[2]]);
      triangle([vertices[0], vertices[2], vertices[3]], [values[0], values[2], values[3]]);
    }
  }
  const connections = new Map<string, number[]>();
  segments.forEach((segment, index) => segment.forEach(point => {
    const id = key(point);
    const list = connections.get(id);
    if (list) list.push(index); else connections.set(id, [index]);
  }));
  const visited = new Set<number>();
  const paths: string[] = [];
  segments.forEach((segment, index) => {
    if (visited.has(index)) return;
    visited.add(index);
    const points = [...segment];
    let current = segment[1];
    while (key(current) !== key(segment[0])) {
      const next = connections.get(key(current))?.find(i => !visited.has(i));
      if (next === undefined) break;
      visited.add(next);
      const edge = segments[next];
      current = key(edge[0]) === key(current) ? edge[1] : edge[0];
      points.push(current);
    }
    paths.push(`M${points.map(pointString).join('L')}Z`);
  });
  return paths.join('');
}

// Geometry is derived from the same terrain as the game.
const groveField = (x: number, z: number) => (1.001 - (Math.abs(x - 25) / 17) ** 2.8 - (Math.abs(z - 25) / 17) ** 2.8) * 8;
/** Positive past the boulder line on the Giant's headland; Eastreach and the southern wilds stay Coast. */
const bouldersField = (x: number, z: number) => Math.min(Math.max(x, z) - BOULDER_LINE, x - 30, z - 32, 66 - x, 66 - z);
const ISLE: Bounds = { x0: -PAD, z0: -PAD, x1: ISLE_SIZE, z1: ISLE_SIZE };
const MAINLAND_BIOMES = (Object.keys(BIOMES) as BiomeId[]).filter(id => id !== 'isle');
const linePath = (points: readonly Point[]) => `M${points.map(pointString).join('L')}`;
const hex = (value: number) => `#${value.toString(16).padStart(6, '0')}`;

/** Exposed for tests: the terrain is sampled once per page, on first render rather than at import. */
export let islandMapSamples = 0;
let geometry: ReturnType<typeof buildGeometry> | null = null;
function buildGeometry() {
  islandMapSamples++;
  // One terrain sample per lattice point; every contour below reads this array.
  const terrain = new Float32Array(N * N);
  const biomes = new Uint8Array(N * N).fill(255);
  for (let i = 0; i < terrain.length; i++) {
    const x = i % N - PAD, z = Math.floor(i / N) - PAD;
    // The outer ring is sea, so contours close even where the King's Road runs off east to the Meadows.
    const edge = x === -PAD || z === -PAD || x === GRID_SIZE + PAD || z === GRID_SIZE + PAD;
    terrain[i] = edge ? -10 : terrainField(x, z);
    if (terrain[i] > -2 && x >= 0 && z >= 0 && x < GRID_SIZE && z < GRID_SIZE) biomes[i] = MAINLAND_BIOMES.indexOf(biomeOf({ x, z }) as BiomeId);
  }
  const regionPaths: Record<IslandRegion, string> = {
    grove: contour(derive(terrain, (v, x, z) => Math.min(v, groveField(x, z))), ISLE),
    coast: contour(derive(terrain, (v, x, z) => x >= ISLE_SIZE || z >= ISLE_SIZE ? -1 : Math.min(v, -groveField(x, z), -bouldersField(x, z))), ISLE),
    boulders: contour(derive(terrain, (v, x, z) => Math.min(v, bouldersField(x, z))), ISLE),
  };
  const biomeAreas = MAINLAND_BIOMES.map((id, b) => {
    let sx = 0, sz = 0, n = 0;
    const field = derive(terrain, (v, x, z, i) => {
      if (biomes[i] !== b) return Math.min(v, -1);
      if (v > 2) { sx += x; sz += z; n++; }
      return v;
    });
    return { id, name: BIOMES[id].name, colors: BIOMES[id].ground.map(hex), path: contour(field), label: { x: sx / (n || 1), z: sz / (n || 1) } };
  });
  const brambles: Point[] = [];
  for (let z = 0; z < 52; z++) for (let x = 0; x < 52; x++) if ((x + z) % 3 === 0 && groveBoundary({ x, z })) brambles.push({ x, z });
  return {
    landPath: contour(terrain),
    shallowsPath: contour(derive(terrain, v => v + 1.3)),
    offshorePath: contour(derive(terrain, v => v + 3.2)),
    regionPaths, biomeAreas, brambles,
    trees: FOREST_TREES.filter(point => point.x < ISLE_SIZE && point.z < ISLE_SIZE && terrainLand(point) && insideGrove(point)),
  };
}
/** The atlas geometry, built on first use and shared by every render. */
export function islandMapGeometry() {
  return geometry ??= buildGeometry();
}
const regions: { id: IslandRegion; name: string; point: Point }[] = [
  { id: 'grove', name: 'Grove', point: { x: 25, z: 29 } },
  { id: 'coast', name: 'Coast', point: { x: 84, z: 22 } },
  { id: 'boulders', name: 'Boulders', point: { x: 56, z: 58 } },
];
/** The island's landmarks sit close at this scale; only these keep a caption. */
const ISLAND_CAPTIONS = new Set(['harbour', 'giant', 'eastreach', 'mossvale', 'sunfall', 'glade']);
const labelOffsets: Record<string, { x: number; y: number; anchor?: 'start' | 'middle' | 'end' }> = {
  harbour: { x: 0, y: -9, anchor: 'middle' },
  giant: { x: 0, y: -22, anchor: 'middle' },
  eastreach: { x: 0, y: -8, anchor: 'middle' },
  mossvale: { x: 0, y: -8, anchor: 'middle' },
  sunfall: { x: 0, y: 13, anchor: 'middle' },
  glade: { x: -8, y: 3, anchor: 'end' },
  kingsgate: { x: 0, y: -8, anchor: 'middle' },
  frostmere: { x: -8, y: 3, anchor: 'end' },
  rimewatch: { x: 0, y: -8, anchor: 'middle' },
  crossroads: { x: 0, y: 13, anchor: 'middle' },
  orchards: { x: 0, y: -8, anchor: 'middle' },
  fenhold: { x: 8, y: 3 },
  oasis: { x: 8, y: 13 },
  'redwall-gap': { x: -8, y: -4, anchor: 'end' },
  crater: { x: -8, y: 3, anchor: 'end' },
};
const MAINLAND_IDS = new Set<string>(EXPANSE_LANDMARKS.map(l => l.id));

export default function IslandMap({ selected, onSelect }: IslandMapProps) {
  const id = useId().replace(/:/g, '');
  const { landPath, shallowsPath, offshorePath, regionPaths, biomeAreas, brambles, trees } = islandMapGeometry();
  return (
    <div className="island-map" role="group" aria-label="Explore Bramblewild's three regions and the Expanse around it">
      <svg className="island-map__art" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={`${id}-sea`} cx="45%" cy="40%" r="76%">
            <stop offset="0" stopColor="#285e53" />
            <stop offset="1" stopColor="#123c36" />
          </radialGradient>
          <linearGradient id={`${id}-land`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e0cca1" />
            <stop offset="1" stopColor="#bca77c" />
          </linearGradient>
          <linearGradient id={`${id}-woodland`} x1="0" y1="0" x2=".7" y2="1">
            <stop offset="0" stopColor="#809b68" />
            <stop offset="1" stopColor="#a0aa78" />
          </linearGradient>
          {biomeAreas.map(biome => <linearGradient key={biome.id} id={`${id}-${biome.id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={biome.colors[0]} />
            <stop offset="1" stopColor={biome.colors[1]} />
          </linearGradient>)}
          <pattern id={`${id}-chart`} width="44" height="44" patternUnits="userSpaceOnUse">
            <path d="M22 19v6m-3-3h6" fill="none" stroke="#b8cdad" strokeWidth=".6" opacity=".17" />
          </pattern>
          <clipPath id={`${id}-land-clip`}><path d={landPath} fillRule="evenodd" /></clipPath>
          <filter id={`${id}-land-shadow`} x="-15%" y="-15%" width="130%" height="135%">
            <feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#082b27" floodOpacity=".5" />
          </filter>
          <g id={`${id}-tree`}>
            <ellipse cx="1" cy="5" rx="7" ry="3.3" fill="#254e38" opacity=".18" />
            <path d="M0-2V5" stroke="#655b39" strokeWidth="1.6" />
            <path d="M0-13C-7-13-9-3-4 0c-1 5 7 5 8 1C11-2 7-13 0-13Z" fill="#426b44" stroke="#d3d5a5" strokeWidth=".65" />
            <path d="M-2-9c-3 1-4 4-3 6" fill="none" stroke="#94ae73" strokeWidth="1.1" />
            <circle cx="2.5" cy="-7" r="1.35" fill="#e4b583" />
            <circle cx="-2.5" cy="-3" r="1.35" fill="#d89b76" />
          </g>
          <g id={`${id}-rock`}>
            <path d="m-9 5 4-12 7-5L10 4 2 8Z" fill="#786f5e" stroke="#ded0ae" strokeWidth=".8" />
            <path d="m-5-7 5 2 2 13M0-5l2-7" fill="none" stroke="#b5ab8f" strokeWidth=".7" />
          </g>
        </defs>
        <rect width={WIDTH} height={HEIGHT} fill={`url(#${id}-sea)`} />
        <rect width={WIDTH} height={HEIGHT} fill={`url(#${id}-chart)`} />
        <rect x="13" y="13" width={WIDTH - 26} height={HEIGHT - 26} rx="14" fill="none" stroke="#dacbad" strokeOpacity=".15" />
        <path d={`M34 64V34h30m${WIDTH - 128} 0h30v30M34 ${HEIGHT - 64}v30h30m${WIDTH - 128} 0h30v-30`} fill="none" stroke="#dcca9c" strokeWidth="1" opacity=".4" />
        <text x="36" y="57" className="island-map__eyebrow">FIELD ATLAS</text>
        <text x="36" y="73" className="island-map__edition">BRAMBLEWILD</text>
        <text x="36" y="86" className="island-map__edition">&amp; THE EXPANSE</text>

        <path d={offshorePath} fill="#739a7f" fillOpacity=".055" stroke="#93b8a0" strokeOpacity=".15" strokeWidth="1" fillRule="evenodd" />
        <path d={shallowsPath} fill="#83a18a" fillOpacity=".2" stroke="#b4c5a5" strokeOpacity=".25" strokeWidth=".7" fillRule="evenodd" />
        <path d={landPath} fill={`url(#${id}-land)`} stroke="#e8d7ad" strokeWidth="1.6" fillRule="evenodd" filter={`url(#${id}-land-shadow)`} />
        {biomeAreas.map(biome => <path key={biome.id} className={`island-map__biome island-map__biome--${biome.id}`} d={biome.path} fill={`url(#${id}-${biome.id})`} fillOpacity=".82" fillRule="evenodd" />)}
        <path d={regionPaths.grove} fill={`url(#${id}-woodland)`} stroke="#5a7750" strokeOpacity=".6" strokeWidth="1" fillRule="evenodd" />
        <path d={regionPaths.boulders} fill="#97937b" stroke="#c5b898" strokeWidth="1" fillRule="evenodd" />
        <g clipPath={`url(#${id}-land-clip)`}>
          <path d={linePath(BROOK)} stroke="#3a7566" strokeWidth="6" fill="none" opacity=".3" />
          {RIDGES.map(ridge => <path key={ridge.id} d={linePath(ridge.points)} stroke="#5f574b" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5 2" fill="none" opacity=".85" />)}
          {TRAILS.map((trail, i) => <path key={i} d={linePath(trail)} stroke="#e6d3a6" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
          {TRAILS.map((trail, i) => <path key={i} d={linePath(trail)} stroke="#99855f" strokeWidth=".6" strokeDasharray="2 3" fill="none" opacity=".65" />)}
          {brambles.map(point => {
            const p = project(point);
            return <path key={`${point.x}-${point.z}`} d={`M${p.x - 1.5},${p.y + 1}l1.5-2.2 1.5 2.2`} fill="none" stroke="#49623d" strokeWidth="1" strokeLinecap="round" opacity=".7" />;
          })}
          {trees.map((point, i) => {
            const p = project(point);
            return <use key={i} href={`#${id}-tree`} transform={`translate(${p.x} ${p.y}) scale(${i % 3 === 0 ? .55 : .64})`} />;
          })}
          {[{ x: 57, z: 43 }, { x: 60, z: 47 }, { x: 58, z: 51 }, { x: 50, z: 58 }, { x: 43, z: 59 }, { x: 52, z: 51 }].map((point, i) => {
            const p = project(point);
            return <use key={i} href={`#${id}-rock`} transform={`translate(${p.x} ${p.y}) scale(${i % 2 ? .5 : .62})`} />;
          })}
        </g>
        {CAUSEWAYS.map(c => {
          const a = project(c.from), b = project(c.to);
          return <path key={c.id} d={`M${a.x} ${a.y}L${b.x} ${b.y}`} stroke="#efe0b9" strokeOpacity=".5" strokeWidth={c.width * SCALE * 2} strokeLinecap="round" fill="none" className="island-map__causeway" />;
        })}
        {[...BRIDGES, ...EXPANSE_BRIDGES].map(bridge => {
          const p = project(bridge);
          const width = bridge.width * SCALE;
          const height = bridge.depth * SCALE * .7;
          return <g key={bridge.id} transform={`translate(${p.x} ${p.y})`}>
            <rect x={-width / 2} y={-height / 2} width={width} height={height} rx="1" fill="#bda170" stroke="#725b3c" strokeWidth=".8" />
            <path d={`M${-width / 2 - 1.5} ${-height / 2}h${width + 3}m${-width - 3} ${height}h${width + 3}`} fill="none" stroke="#f0dab1" strokeWidth="1" />
          </g>;
        })}
        <path className="island-map__selection" d={regionPaths[selected]} fill="#f6dc9a" fillOpacity=".06" stroke="#f0d69b" strokeWidth="1.6" strokeDasharray="4 4" fillRule="evenodd" />
        {biomeAreas.map(biome => {
          const p = project(biome.label);
          return <text key={biome.id} x={p.x} y={p.y} textAnchor="middle" className={`island-map__biome-label island-map__biome-label--${biome.id}`}>{biome.name.toUpperCase()}</text>;
        })}
        <text x={project({ x: GRID_SIZE, z: 14 }).x} y={project({ x: GRID_SIZE, z: 14 }).y} textAnchor="end" className="island-map__road-label">to the Meadows →</text>
        {WAYSTONES.map(stone => {
          const p = project(stone);
          return <path key={stone.id} className="island-map__waystone" d={`M${p.x} ${p.y - 4.5}l2.6 4.2-2.6 3.3-2.6-3.3Z`} fill="#e8ecef" stroke="#2b3a48" strokeWidth=".8" />;
        })}
        {LANDMARKS.map(landmark => {
          const p = project(landmark);
          const offset = labelOffsets[landmark.id] ?? { x: 8, y: 3 };
          const caption = MAINLAND_IDS.has(landmark.id) || ISLAND_CAPTIONS.has(landmark.id);
          return <g key={landmark.id} className={`island-map__landmark island-map__landmark--${landmark.id}`}>
            {landmark.id !== 'giant' && <><circle cx={p.x} cy={p.y} r="2.8" fill="#f1dfb5" stroke="#536448" strokeWidth="1" /><circle cx={p.x} cy={p.y} r=".9" fill="#536448" /></>}
            {caption && <text x={p.x + offset.x} y={p.y + offset.y} textAnchor={offset.anchor ?? 'start'}>{'short' in landmark && MAINLAND_IDS.has(landmark.id) ? landmark.short : landmark.name}</text>}
          </g>;
        })}
        <g transform={`translate(70 170)`} className="island-map__compass">
          <circle r="18" fill="none" stroke="currentColor" strokeWidth=".65" opacity=".3" />
          <path d="M0-24 4-4 0 0-4-4Zm0 48 4-20L0 0l-4 4Z" fill="currentColor" opacity=".75" />
          <path d="M-24 0-4-4 0 0-4 4ZM24 0 4-4 0 0l4 4Z" fill="currentColor" opacity=".35" />
          <circle r="2" fill="#1d5149" stroke="currentColor" strokeWidth="1" />
          <text y="-31" textAnchor="middle">N</text>
        </g>
        <g className="island-map__sea-marks" fill="none" stroke="#a4bba1" strokeWidth=".8" opacity=".3">
          <path d="M60 311q5-4 10 0t10 0m-14 7q5-4 10 0t10 0M470 210q5-4 10 0t10 0m-14 7q5-4 10 0t10 0M690 560q5-4 10 0t10 0m-14 7q5-4 10 0t10 0M90 470q5-4 10 0t10 0" />
        </g>
        <g transform={`translate(24 ${HEIGHT - 132})`} className="island-map__legend">
          <text className="island-map__sea-label" x="0" y="0">Beyond the brambles.</text>
          <path d="M0 22h23" stroke="#e6d3a6" strokeWidth="2" strokeDasharray="3 3" />
          <text x="32" y="25">Roads</text>
          <circle cx="11" cy="43" r="3.1" fill="none" stroke="#e6d3a6" strokeWidth="1" />
          <text x="32" y="46">Places</text>
          <path d="M0 64h23" stroke="#5f574b" strokeWidth="4" strokeDasharray="5 2" />
          <text x="32" y="67">Ridges</text>
          <path d="M11 79l2.6 4.2-2.6 3.3-2.6-3.3Z" fill="#e8ecef" stroke="#2b3a48" strokeWidth=".8" />
          <text x="32" y="87">Waystones</text>
        </g>
        <text x={WIDTH - 36} y={HEIGHT - 26} textAnchor="end" className="island-map__edition">A SMALL ISLAND. A WIDE WORLD OF STORIES.</text>
      </svg>
      {regions.map((region, index) => {
        const p = project(region.point);
        return (
          <button
            key={region.id}
            type="button"
            className={`island-map__region${selected === region.id ? ' is-selected' : ''}`}
            style={{ left: `${p.x / WIDTH * 100}%`, top: `${p.y / HEIGHT * 100}%` }}
            onClick={() => onSelect(region.id)}
            aria-pressed={selected === region.id}
            aria-label={`Explore the ${region.name}`}
            title={region.name}
          >
            <span className="island-map__number" aria-hidden="true">0{index + 1}</span>
            <span className="island-map__region-name">{region.name}</span>
          </button>
        );
      })}
    </div>
  );
}
