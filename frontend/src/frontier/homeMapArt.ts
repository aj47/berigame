import { BRIDGES, FOREST_TREES, GRID_SIZE, LANDMARKS, TRAILS, inGiantHeadland, isBridge, terrainField } from '@sim';
import { PLOTS, REGIONS, type Location } from '../../../shared/sim/frontier/catalog';
import { HOME_GRID, homeLand, homeLocation, homePoint, MEADOW_OFFSET } from '../../../shared/sim/frontier/homeMap';
import { meadowField, regionLand } from '../../../shared/sim/frontier/regions';
import type { MinimapModel } from '../Components/minimapModel';

type MapPoint = { x: number; z: number };
export type HomeMapView = 'overview' | 'bramblewild' | 'settlement';
const LANDMARK_RADIUS = 9;
/** Square district frames keep the original island readable at every screen size. */
export const HOME_MAP_VIEWS = {
  overview: { x: -4, z: MEADOW_OFFSET.z - 4 - Math.floor((HOME_GRID.width - HOME_GRID.height) / 2), span: HOME_GRID.width + 8 },
  bramblewild: { x: -4, z: -4, span: GRID_SIZE + 8 },
  settlement: { x: MEADOW_OFFSET.x - 4, z: MEADOW_OFFSET.z - 4, span: 136 },
} as const;
export function homeMapProjection(size: number, view: HomeMapView = 'overview') {
  const bounds = HOME_MAP_VIEWS[view], scale = size / bounds.span;
  return {
    scale, x: (v: number) => (v - bounds.x) * scale, z: (v: number) => (v - bounds.z) * scale,
    pointAt: (x: number, y: number) => ({ x: bounds.x + x / scale, z: bounds.z + y / scale }),
  };
}
/** The legacy single-district map paints tile corners at integers and markers at cell centres. */
export function legacyMapProjection(size: number) {
  const scale = size / GRID_SIZE;
  return { scale, center: (v: number) => (v + .5) * scale, pointAt: (x: number, y: number) => ({ x: x / scale - .5, z: y / scale - .5 }) };
}
export function homeMapLandmarkPositions(size: number) {
  const { x, z } = homeMapProjection(size, 'bramblewild');
  const placed: { x: number; z: number; anchorX: number; anchorZ: number }[] = [];
  for (const place of LANDMARKS) {
    const anchorX = x(place.x), anchorZ = z(place.z);
    // Widening rings: the nearest free spot keeps each number beside its place.
    const offsets = [[0, 0], ...[18, 26, 36, 46].flatMap(r => [[0, -r], [r, 0], [0, r], [-r, 0], [r, -r], [-r, r], [r, r], [-r, -r]])];
    const candidates = offsets.map(([dx, dz]) => ({ x: Math.max(10, Math.min(size - 10, anchorX + dx)), z: Math.max(10, Math.min(size - 10, anchorZ + dz)), anchorX, anchorZ }));
    placed.push(candidates.find(p => placed.every(other => Math.hypot(other.x - p.x, other.z - p.z) >= 20)) ?? candidates[0]);
  }
  return placed;
}
/** Convert canvas-relative CSS pixels to a walkable region-local tile; DPR is irrelevant. */
export function mapDestinationAt(x: number, y: number, size: number, view: HomeMapView = 'overview', connected = true): Location | null {
  if (![x, y, size].every(Number.isFinite) || size <= 0 || x < 0 || y < 0 || x >= size || y >= size) return null;
  // Number circles can be displaced for readability. Their hit area follows the artwork.
  if (connected && view === 'bramblewild' && size >= 200) {
    const landmark = homeMapLandmarkPositions(size).findIndex(p => Math.hypot(p.x - x, p.z - y) <= LANDMARK_RADIUS);
    if (landmark >= 0) {
      const { x, z } = LANDMARKS[landmark];
      return regionLand('bramblewild', { x, z }) ? { region: 'bramblewild', x, z } : null;
    }
  }
  const point = (connected ? homeMapProjection(size, view) : legacyMapProjection(size)).pointAt(x, y);
  const tile = { x: Math.round(point.x), z: Math.round(point.z) };
  const destination: Location = connected ? homeLocation(tile) : { region: 'bramblewild', ...tile };
  return regionLand(destination.region, destination) ? destination : null;
}
const plots = PLOTS.filter(p => p.region === 'settlement');
const town = homePoint(REGIONS.settlement.spawn, 'settlement');
const mix = (a: number[], b: number[], amount: number) =>
  `rgb(${a.map((channel, i) => Math.round(channel + (b[i] - channel) * Math.max(0, Math.min(1, amount)))).join(',')})`;

// Sample the real shoreline once, including its shallow-water fringe. Geography
// stays fixed while ownership and people are painted over it on each update.
const GEO_WIDTH = HOME_GRID.width + 8, GEO_HEIGHT = HOME_GRID.height + 8;
const geography = Array.from({ length: GEO_WIDTH * GEO_HEIGHT }, (_, i) => {
  const x = i % GEO_WIDTH - 4, z = Math.floor(i / GEO_WIDTH) + MEADOW_OFFSET.z - 4;
  const meadow = x >= MEADOW_OFFSET.x;
  const localX = x - MEADOW_OFFSET.x, localZ = z - MEADOW_OFFSET.z;
  const depth = meadow ? meadowField(localX, localZ) : terrainField(x, z);
  if (!homeLand({ x, z })) {
    if (depth < -4.5) return null;
    return { x, z, color: depth < -2.3 ? '#3c8991' : depth < -.9 ? '#66a6a5' : '#98c1b2' };
  }
  if (!meadow && isBridge({ x, z })) return { x, z, color: '#c9a878' };
  const patch = .5 + .25 * Math.sin(x * .38 + Math.sin(z * .23)) + .25 * Math.sin(z * .51 - x * .14);
  const coastal = Math.max(0, 1 - depth / 2);
  let color = mix([92, 131, 81], [139, 162, 103], patch);
  if (!meadow && inGiantHeadland({ x, z }) && Math.max(x, z) > 49) color = mix([126, 132, 119], [164, 159, 129], patch);
  else if (coastal) color = mix([142, 159, 103], [224, 206, 155], coastal);
  else if (meadow && plots.some(p => localX >= p.x && localX < p.x + 8 && localZ >= p.z && localZ < p.z + 8)) {
    // The same small starting clearings used by the woodland scenery.
    color = mix([128, 155, 95], [157, 174, 116], patch);
  }
  return { x, z, color };
});

export function drawHomeMap(ctx: CanvasRenderingContext2D, m: MinimapModel, size: number, view: HomeMapView = 'overview') {
  if (size <= 0) return;
  const detailed = size >= 200;
  // Terrain, resources, destinations and players use the same district frame.
  const { scale, x, z } = homeMapProjection(size, view);
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  const sea = ctx.createLinearGradient(0, 0, size, size);
  sea.addColorStop(0, '#2d6976'); sea.addColorStop(.52, '#357f89'); sea.addColorStop(1, '#245969');
  ctx.fillStyle = sea; ctx.fillRect(0, 0, size, size);

  // Quiet water marks leave the coastline and live markers easy to read.
  ctx.strokeStyle = 'rgba(191,222,210,.12)'; ctx.lineWidth = detailed ? .7 : .4;
  for (let row = 0; row < 12; row++) for (let col = 0; col < 16; col++) {
    const px = col * 18 + (row % 2) * 8, pz = row * 18 - 66;
    if (homeLand({ x: px, z: pz }) || homeLand({ x: px + 4, z: pz })) continue;
    ctx.beginPath(); ctx.moveTo(x(px), z(pz)); ctx.quadraticCurveTo(x(px + 2), z(pz + .6), x(px + 4), z(pz)); ctx.stroke();
  }
  for (const tile of geography) {
    if (!tile) continue;
    ctx.fillStyle = tile.color;
    ctx.fillRect(x(tile.x - .5), z(tile.z - .5), scale + .2, scale + .2);
  }
  if (detailed) {
    ctx.fillStyle = 'rgba(40,78,54,.27)';
    for (const tree of FOREST_TREES) {
      ctx.beginPath(); ctx.arc(x(tree.x), z(tree.z), 1.25 * scale, 0, Math.PI * 2); ctx.fill();
    }
  }

  const route = (points: readonly MapPoint[], primary = false) => {
    ctx.beginPath();
    let penDown = false;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const steps = Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z)) * 2);
      for (let step = 0; step <= steps; step++) {
        const t = step / (steps || 1), px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
        if (!homeLand({ x: Math.round(px), z: Math.round(pz) })) { penDown = false; continue; }
        if (penDown) ctx.lineTo(x(px), z(pz)); else ctx.moveTo(x(px), z(pz));
        penDown = true;
      }
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = primary ? 'rgba(92,90,53,.45)' : 'rgba(106,113,65,.24)';
    ctx.lineWidth = (primary ? 2.6 : 1.6) * scale; ctx.stroke();
    ctx.strokeStyle = primary ? '#e5d3a3' : 'rgba(194,191,142,.48)';
    ctx.lineWidth = (primary ? 1.55 : .45) * scale; ctx.stroke();
  };
  TRAILS.forEach(trail => route(trail));
  for (let row = 0; row < 6; row++) {
    const localZ = 6 + row * 19;
    route([
      homePoint({ x: 3, z: row === 3 ? 64 : localZ }, 'settlement'),
      homePoint({ x: 31, z: row === 3 ? 64 : localZ }, 'settlement'),
      homePoint({ x: 35, z: localZ }, 'settlement'),
      homePoint({ x: 102, z: localZ }, 'settlement'),
    ]);
  }
  route([homePoint({ x: 31, z: 7 }, 'settlement'), homePoint({ x: 31, z: 121 }, 'settlement')]);
  route([{ x: 46, z: 29 }, { x: 49, z: 25 }, { x: 64, z: 25 }, { x: 100, z: 25 }, { x: GRID_SIZE - 1, z: 25 }, town], true);
  for (const bridge of BRIDGES) {
    ctx.fillStyle = '#d6bd88';
    ctx.fillRect(x(bridge.x - bridge.width / 2), z(bridge.z - .6), bridge.width * scale, 1.2 * scale);
  }

  const claims = new Map((m.home?.claims ?? []).map(claim => [claim.id, claim]));
  for (const plot of plots) {
    const claim = claims.get(plot.id);
    if (!claim) continue;
    const at = homePoint(plot, 'settlement'), marker = homePoint(plot.marker, 'settlement');
    ctx.fillStyle = claim.mine ? 'rgba(239,209,134,.57)' : 'rgba(214,224,170,.24)';
    ctx.fillRect(x(at.x), z(at.z), 16 * scale, 16 * scale);
    ctx.strokeStyle = claim.mine ? '#f4de9c' : '#bfce9e'; ctx.lineWidth = claim.mine ? 1.3 : .65;
    ctx.strokeRect(x(at.x), z(at.z), 16 * scale, 16 * scale);
    if (detailed) {
      // A flag means claimed land, without implying a house has been built.
      ctx.strokeStyle = '#485a3b'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x(marker.x), z(marker.z) + 3); ctx.lineTo(x(marker.x), z(marker.z) - 4); ctx.stroke();
      ctx.fillStyle = claim.mine ? '#f8dc8c' : '#d4e0b3';
      ctx.beginPath(); ctx.moveTo(x(marker.x), z(marker.z) - 4); ctx.lineTo(x(marker.x) + 5, z(marker.z) - 2); ctx.lineTo(x(marker.x), z(marker.z)); ctx.closePath(); ctx.fill();
    }
  }

  const dot = (p: MapPoint, color: string, radius = 1.6) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x(p.x), z(p.z), radius, 0, Math.PI * 2); ctx.fill();
  };
  const label = (text: string, p: MapPoint, font: string, color = '#f4e8c8') => {
    ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(38,70,62,.88)'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    ctx.strokeText(text, x(p.x), z(p.z)); ctx.fillStyle = color; ctx.fillText(text, x(p.x), z(p.z));
  };
  if (detailed) {
    if (view === 'overview') {
      label('BRAMBLEWILD', { x: 30, z: -8 }, '600 12px system-ui');
      label('THE MEADOWS', { x: MEADOW_OFFSET.x + 66, z: MEADOW_OFFSET.z - 8 }, '600 13px system-ui');
      label('EASTREACH', { x: 97, z: 54 }, '600 10px system-ui');
      label('SOUTHERN WILDS', { x: 64, z: 128 }, '600 10px system-ui');
      label('Harbour trail', { x: 67, z: 17 }, '11px system-ui');
    }
    if (view !== 'bramblewild') for (const place of LANDMARKS) {
      dot(place, '#425d46', 2.5); dot(place, '#f5e4b7', 1.4);
    }
    label('Town', { x: town.x, z: town.z + 8 }, '600 9px system-ui');
  }
  // The town is a permanent landmark, so it remains visible on the small map.
  dot(town, '#475d43', detailed ? 5.5 : 2.5);
  ctx.fillStyle = '#f3deb0';
  const townSize = detailed ? 3.4 : 1.6;
  ctx.fillRect(x(town.x) - townSize * .65, z(town.z) - townSize * .15, townSize * 1.3, townSize);
  ctx.beginPath(); ctx.moveTo(x(town.x) - townSize, z(town.z)); ctx.lineTo(x(town.x), z(town.z) - townSize); ctx.lineTo(x(town.x) + townSize, z(town.z)); ctx.closePath(); ctx.fill();

  if (detailed) {
    for (const node of m.nodes) dot(node, node.ripe ? node.color : '#7e9275');
    for (const node of m.resources ?? []) {
      const timber = node.item === 'timber';
      ctx.globalAlpha = node.ready ? 1 : .4;
      dot(node, '#eadeb5', 5);
      ctx.fillStyle = timber ? '#325438' : node.color;
      if (timber) {
        ctx.beginPath(); ctx.moveTo(x(node.x), z(node.z) - 4); ctx.lineTo(x(node.x) + 3.5, z(node.z) + 3); ctx.lineTo(x(node.x) - 3.5, z(node.z) + 3); ctx.closePath(); ctx.fill();
      } else ctx.fillRect(x(node.x) - 2.5, z(node.z) - 2.5, 5, 5);
      ctx.globalAlpha = 1;
    }
    if (m.garden) dot(m.garden, m.garden.ripe ? '#ffe59b' : '#a9ca73', 2.4);
    if (m.giant) {
      dot(m.giant, m.giant.down ? '#829084' : '#7b4d51', 2.4);
      if (m.giant.label) label(m.giant.label, { x: m.giant.x, z: m.giant.z + 7 }, '8px system-ui');
    }
  }
  if (detailed && view === 'bramblewild') homeMapLandmarkPositions(size).forEach((p, index) => {
    ctx.strokeStyle = '#536342'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(p.anchorX, p.anchorZ); ctx.lineTo(p.x, p.z); ctx.stroke();
    ctx.fillStyle = '#f5e4b7'; ctx.beginPath(); ctx.arc(p.x, p.z, LANDMARK_RADIUS, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.font = '700 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#364936'; ctx.fillText(String(index + 1), p.x, p.z);
  });
  for (const bag of m.bags) { dot(bag, '#425744', 3.4); dot(bag, '#ffe09a', 2.5); }
  for (const p of m.others) {
    dot(p, '#365344', detailed ? 2.7 : 1.8);
    dot(p, p.hostile ? '#e57755' : '#e1eada', detailed ? 2 : 1.3);
  }
  if (m.me) {
    dot(m.me, 'rgba(255,244,183,.23)', detailed ? 7 : 4);
    dot(m.me, '#fff3b3', detailed ? 4 : 2.5);
    ctx.strokeStyle = '#223e30'; ctx.lineWidth = 1.3; ctx.stroke();
  }
  ctx.restore();
}
