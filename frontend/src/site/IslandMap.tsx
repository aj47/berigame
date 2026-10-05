import React, { useId } from 'react';
import { BOULDER_LINE, GRID_SIZE } from '@sim/constants';
import {
  BRIDGES, BROOK, FOREST_TREES, LANDMARKS, TRAILS,
  groveBoundary, insideGrove, terrainField, terrainLand,
} from '@sim/terrain';
import './islandMap.css';

export type IslandRegion = 'grove' | 'coast' | 'boulders';
type Point = { x: number; z: number };
type IslandMapProps = {
  selected: IslandRegion;
  onSelect: (region: IslandRegion) => void;
};

const WIDTH = 760;
const HEIGHT = 510;
const SCALE = 3.6;
const project = ({ x, z }: Point) => ({ x: 160 + x * SCALE, y: 22 + z * SCALE });
const pointString = (point: Point) => {
  const { x, y } = project(point);
  return `${x.toFixed(2)},${y.toFixed(2)}`;
};

/** Trace continuous terrain, preserving the coves, lake and brook without a tile grid. */
function contour(field: (x: number, z: number) => number): string {
  const step = 1;
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
  // This padded domain keeps every coastline contour closed.
  for (let z = -5; z < GRID_SIZE + 5; z += step) {
    for (let x = -5; x < GRID_SIZE + 5; x += step) {
      const vertices = [{ x, z }, { x: x + step, z }, { x: x + step, z: z + step }, { x, z: z + step }];
      const values = vertices.map(p => field(p.x, p.z));
      triangle([vertices[0], vertices[1], vertices[2]], [values[0], values[1], values[2]]);
      triangle([vertices[0], vertices[2], vertices[3]], [values[0], values[2], values[3]]);
    }
  }
  const connections = new Map<string, number[]>();
  segments.forEach((segment, index) => segment.forEach(point => {
    const id = key(point);
    connections.set(id, [...(connections.get(id) ?? []), index]);
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

// Geometry is shared by every render and is derived from the same terrain as the game.
const groveField = (x: number, z: number) => (1.001 - (Math.abs(x - 25) / 17) ** 2.8 - (Math.abs(z - 25) / 17) ** 2.8) * 8;
/** Positive past the boulder line on the Giant's headland; Eastreach and the southern wilds stay Coast. */
const bouldersField = (x: number, z: number) => Math.min(Math.max(x, z) - BOULDER_LINE, x - 30, z - 32, 66 - x, 66 - z);
const landPath = contour(terrainField);
const regionPaths: Record<IslandRegion, string> = {
  grove: contour((x, z) => Math.min(terrainField(x, z), groveField(x, z))),
  coast: contour((x, z) => Math.min(terrainField(x, z), -groveField(x, z), -bouldersField(x, z))),
  boulders: contour((x, z) => Math.min(terrainField(x, z), bouldersField(x, z))),
};
const shallowsPath = contour((x, z) => terrainField(x, z) + 1.3);
const offshorePath = contour((x, z) => terrainField(x, z) + 3.2);
const linePath = (points: readonly Point[]) => `M${points.map(pointString).join('L')}`;
const brambles: Point[] = [];
for (let z = 0; z < GRID_SIZE; z++) {
  for (let x = 0; x < GRID_SIZE; x++) {
    if ((x + z) % 3 === 0 && groveBoundary({ x, z })) brambles.push({ x, z });
  }
}
const trees = FOREST_TREES.filter(point => terrainLand(point) && insideGrove(point));
const regions: { id: IslandRegion; name: string; point: Point }[] = [
  { id: 'grove', name: 'Grove', point: { x: 28, z: 27 } },
  { id: 'coast', name: 'Coast', point: { x: 42, z: 16 } },
  { id: 'boulders', name: 'Boulders', point: { x: 55, z: 54 } },
];
const labelOffsets: Record<string, { x: number; y: number; anchor?: 'start' | 'middle' | 'end' }> = {
  beacon: { x: 0, y: -15, anchor: 'middle' },
  pool: { x: -15, y: -7, anchor: 'end' },
  mill: { x: -13, y: 4, anchor: 'end' },
  camp: { x: 14, y: 5 },
  willow: { x: -14, y: -8, anchor: 'end' },
  feast: { x: -5, y: 20, anchor: 'middle' },
  market: { x: 10, y: 19 },
  harbour: { x: 14, y: 5 },
  ruins: { x: 14, y: -14 },
  giant: { x: 0, y: -33, anchor: 'middle' },
  eastreach: { x: 0, y: -10, anchor: 'middle' },
  tarn: { x: 10, y: 4 },
  saltmarsh: { x: 10, y: 4 },
  mossvale: { x: 0, y: -10, anchor: 'middle' },
  hollow: { x: 0, y: 16, anchor: 'middle' },
  sunfall: { x: 0, y: -10, anchor: 'middle' },
};

export default function IslandMap({ selected, onSelect }: IslandMapProps) {
  const id = useId().replace(/:/g, '');
  return (
    <div className="island-map" role="group" aria-label="Explore Bramblewild's three regions">
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
          <pattern id={`${id}-chart`} width="44" height="44" patternUnits="userSpaceOnUse">
            <path d="M22 19v6m-3-3h6" fill="none" stroke="#b8cdad" strokeWidth=".6" opacity=".17" />
          </pattern>
          <clipPath id={`${id}-land-clip`}><path d={landPath} fillRule="evenodd" /></clipPath>
          <filter id={`${id}-land-shadow`} x="-15%" y="-15%" width="130%" height="135%">
            <feDropShadow dx="0" dy="7" stdDeviation="6" floodColor="#082b27" floodOpacity=".5" />
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
        <rect x="13" y="13" width={WIDTH - 26} height="484" rx="14" fill="none" stroke="#dacbad" strokeOpacity=".15" />
        <path d={`M34 64V34h30m${WIDTH - 128} 0h30v30M34 446v30h30m${WIDTH - 128} 0h30v-30`} fill="none" stroke="#dcca9c" strokeWidth="1" opacity=".4" />
        <text x="36" y="57" className="island-map__eyebrow">FIELD ATLAS</text>
        <text x="36" y="73" className="island-map__edition">BRAMBLEWILD</text>

        <path d={offshorePath} fill="#739a7f" fillOpacity=".055" stroke="#93b8a0" strokeOpacity=".15" strokeWidth="1" fillRule="evenodd" />
        <path d={shallowsPath} fill="#83a18a" fillOpacity=".2" stroke="#b4c5a5" strokeOpacity=".25" strokeWidth=".7" fillRule="evenodd" />
        <path d={landPath} fill={`url(#${id}-land)`} stroke="#e8d7ad" strokeWidth="2" fillRule="evenodd" filter={`url(#${id}-land-shadow)`} />
        <path d={regionPaths.grove} fill={`url(#${id}-woodland)`} stroke="#5a7750" strokeOpacity=".6" strokeWidth="1" fillRule="evenodd" />
        <path d={regionPaths.boulders} fill="#97937b" stroke="#c5b898" strokeWidth="1" fillRule="evenodd" />
        <g clipPath={`url(#${id}-land-clip)`}>
          <path d={linePath(BROOK)} stroke="#3a7566" strokeWidth="10" fill="none" opacity=".3" />
          {TRAILS.map((trail, i) => <path key={i} d={linePath(trail)} stroke="#e6d3a6" strokeWidth="3.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
          {TRAILS.map((trail, i) => <path key={i} d={linePath(trail)} stroke="#99855f" strokeWidth=".7" strokeDasharray="2 3" fill="none" opacity=".65" />)}
          {brambles.map(point => {
            const p = project(point);
            return <path key={`${point.x}-${point.z}`} d={`M${p.x - 2},${p.y + 1}l2-3 2 3`} fill="none" stroke="#49623d" strokeWidth="1.3" strokeLinecap="round" opacity=".7" />;
          })}
          {trees.map((point, i) => {
            const p = project(point);
            return <use key={i} href={`#${id}-tree`} transform={`translate(${p.x} ${p.y}) scale(${i % 3 === 0 ? .86 : 1})`} />;
          })}
          {[{ x: 57, z: 43 }, { x: 60, z: 47 }, { x: 58, z: 51 }, { x: 50, z: 58 }, { x: 43, z: 59 }, { x: 52, z: 51 }].map((point, i) => {
            const p = project(point);
            return <use key={i} href={`#${id}-rock`} transform={`translate(${p.x} ${p.y}) scale(${i % 2 ? .8 : 1})`} />;
          })}
        </g>
        {BRIDGES.map(bridge => {
          const p = project(bridge);
          const width = bridge.width * SCALE;
          const height = bridge.depth * SCALE * .65;
          return <g key={bridge.id} transform={`translate(${p.x} ${p.y})`}>
            <rect x={-width / 2} y={-height / 2} width={width} height={height} rx="1" fill="#bda170" stroke="#725b3c" strokeWidth="1" />
            {Array.from({ length: 8 }, (_, i) => <path key={i} d={`M${-width / 2 + i * width / 7} ${-height / 2}v${height}`} stroke="#735c3b" strokeWidth=".8" opacity=".7" />)}
            <path d={`M${-width / 2 - 2} ${-height / 2}h${width + 4}m${-width - 4} ${height}h${width + 4}`} fill="none" stroke="#f0dab1" strokeWidth="1.3" />
          </g>;
        })}
        <path className="island-map__selection" d={regionPaths[selected]} fill="#f6dc9a" fillOpacity=".06" stroke="#f0d69b" strokeWidth="1.8" strokeDasharray="4 4" fillRule="evenodd" />
        {LANDMARKS.map(landmark => {
          const p = project(landmark);
          const offset = labelOffsets[landmark.id] ?? { x: 10, y: 4 };
          return <g key={landmark.id} className={`island-map__landmark island-map__landmark--${landmark.id}`}>
            {landmark.id !== 'giant' && <><circle cx={p.x} cy={p.y} r="3.6" fill="#f1dfb5" stroke="#536448" strokeWidth="1.2" /><circle cx={p.x} cy={p.y} r="1.2" fill="#536448" /></>}
            <text x={p.x + offset.x} y={p.y + offset.y} textAnchor={offset.anchor ?? 'start'}>{landmark.name}</text>
          </g>;
        })}
        <g transform={`translate(${WIDTH - 55} 85)`} className="island-map__compass">
          <circle r="22" fill="none" stroke="currentColor" strokeWidth=".65" opacity=".3" />
          <path d="M0-29 5-5 0 0-5-5Zm0 58 5-24L0 0l-5 5Z" fill="currentColor" opacity=".75" />
          <path d="M-29 0-5-5 0 0-5 5ZM29 0 5-5 0 0l5 5Z" fill="currentColor" opacity=".35" />
          <circle r="2.3" fill="#1d5149" stroke="currentColor" strokeWidth="1" />
          <text y="-37" textAnchor="middle">N</text>
        </g>
        <g className="island-map__sea-marks" fill="none" stroke="#a4bba1" strokeWidth=".8" opacity=".3">
          <path d="M74 311q5-4 10 0t10 0m-14 7q5-4 10 0t10 0M420 170q5-4 10 0t10 0m-14 7q5-4 10 0t10 0M690 300q5-4 10 0t10 0m-14 7q5-4 10 0t10 0M300 262q5-4 10 0t10 0" />
        </g>
        <g transform="translate(24 392)" className="island-map__legend">
          <text className="island-map__sea-label" x="0" y="0">Beyond the brambles.</text>
          <path d="M0 22h23" stroke="#e6d3a6" strokeWidth="2" strokeDasharray="3 3" />
          <text x="32" y="25">Worn paths</text>
          <circle cx="11" cy="43" r="3.1" fill="none" stroke="#e6d3a6" strokeWidth="1" />
          <text x="32" y="46">Places to discover</text>
        </g>
        <text x="604" y="478" textAnchor="end" className="island-map__edition">A SMALL ISLAND. A WORLD OF STORIES.</text>
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
