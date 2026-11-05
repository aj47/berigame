import { BRIDGES, ClatterState, DROP_BOXES, FOREST_TREES, GRID_SIZE, LANDMARKS, RIDGE_TILES, TRAILS, inGiantHeadland, inSpireFloor, isBridge, terrainField } from '@sim';
import { BIOMES, CAUSEWAYS, EXPANSE_BRIDGES, EXPANSE_TRAILS, LEDGER_CLERKS, WAYSTONES, biomeOf, type BiomeId } from '@sim';
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
  if (destination.region === 'bramblewild' && inSpireFloor(destination)) return null;
  return regionLand(destination.region, destination) ? destination : null;
}
const plots = PLOTS.filter(p => p.region === 'settlement');
const town = homePoint(REGIONS.settlement.spawn, 'settlement');
type Rgb = readonly [number, number, number];
const hexRgb = (hex: number): Rgb => [hex >> 16 & 255, hex >> 8 & 255, hex & 255];
const mixRgb = (a: Rgb, b: Rgb, amount: number): Rgb => {
  const t = Math.max(0, Math.min(1, amount));
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
};
/** Low-frequency ground variation, in 0..1, so open land is not flat. */
const patchAt = (x: number, z: number) => .5 + .25 * Math.sin(x * .38 + Math.sin(z * .23)) + .25 * Math.sin(z * .51 - x * .14);
const SAND: Rgb = [224, 206, 155], FROST_SHORE: Rgb = [206, 216, 220], RIDGE_ROCK: Rgb = [112, 104, 94];
const BIOME_GROUND = Object.fromEntries(Object.values(BIOMES).map(b => [b.id, b.ground.map(hexRgb)])) as Record<BiomeId, Rgb[]>;

/**
 * Map colour of an Expanse land tile: its biome's two ground colours
 * (expanse.ts BIOMES) blended by a gentle patch, washed toward the shore
 * within two tiles of water. `depth` is the terrain field at the tile.
 */
export function biomeLandRgb(biome: BiomeId, x: number, z: number, depth: number): Rgb {
  const [a, b] = BIOME_GROUND[biome];
  const ground = mixRgb(a, b, patchAt(x, z));
  const coastal = Math.max(0, 1 - depth / 2);
  return coastal ? mixRgb(ground, biome === 'frostpine' ? FROST_SHORE : SAND, coastal * .85) : ground;
}

/** Shallow-water shades by depth below the shoreline; null in open sea (the background shows). */
function waterRgb(depth: number): Rgb | null {
  if (depth < -4.5) return null;
  return depth < -2.3 ? [60, 137, 145] : depth < -.9 ? [102, 166, 165] : [152, 193, 178];
}

// The static map: one pixel per home-frame tile (with a 4-tile sea margin),
// sampled once on first draw. Geography never changes at runtime, so the
// per-frame paint only draws people, nodes and markers over it.
const GEO_MARGIN = 4;
const GEO_WIDTH = HOME_GRID.width + GEO_MARGIN * 2, GEO_HEIGHT = HOME_GRID.height + GEO_MARGIN * 2;
const GEO_X0 = -GEO_MARGIN, GEO_Z0 = MEADOW_OFFSET.z - GEO_MARGIN;
let fieldSamples: Float32Array | null = null;
/**
 * The terrain field (Bramblewild's, then the Meadows' east of the seam) at
 * every home-frame tile plus the margin, sampled once and shared by the map
 * and the ocean's coast texture.
 */
export function homeFieldSamples(): { samples: Float32Array; width: number; height: number; x0: number; z0: number } {
  if (!fieldSamples) {
    fieldSamples = new Float32Array(GEO_WIDTH * GEO_HEIGHT);
    for (let i = 0; i < fieldSamples.length; i++) {
      const x = i % GEO_WIDTH + GEO_X0, z = Math.floor(i / GEO_WIDTH) + GEO_Z0;
      fieldSamples[i] = x >= MEADOW_OFFSET.x ? meadowField(x - MEADOW_OFFSET.x, z - MEADOW_OFFSET.z) : terrainField(x, z);
    }
  }
  return { samples: fieldSamples, width: GEO_WIDTH, height: GEO_HEIGHT, x0: GEO_X0, z0: GEO_Z0 };
}
interface Geography { pixels: Uint8ClampedArray; biomeLabels: { name: string; x: number; z: number }[] }
let geography: Geography | null = null;
/** Exposed for tests: how many times the tile geography has been sampled (once per session). */
export let homeGeographySamples = 0;
function homeGeography(): Geography {
  if (geography) return geography;
  homeGeographySamples++;
  const pixels = new Uint8ClampedArray(GEO_WIDTH * GEO_HEIGHT * 4);
  const ridge = new Set(RIDGE_TILES.map(t => t.z * GRID_SIZE + t.x));
  const sums = new Map<BiomeId, [number, number, number]>();
  const field = homeFieldSamples().samples;
  for (let i = 0; i < GEO_WIDTH * GEO_HEIGHT; i++) {
    const x = i % GEO_WIDTH + GEO_X0, z = Math.floor(i / GEO_WIDTH) + GEO_Z0;
    const meadow = x >= MEADOW_OFFSET.x;
    const localX = x - MEADOW_OFFSET.x, localZ = z - MEADOW_OFFSET.z;
    const depth = field[i];
    let rgb: Rgb | null;
    // The Spire's sealed floor is drawn as the sea it sits in (it is not reachable land).
    if (!homeLand({ x, z }) || (!meadow && inSpireFloor({ x, z }))) rgb = waterRgb(depth);
    else if (!meadow && isBridge({ x, z })) rgb = [201, 168, 120];
    else if (!meadow && ridge.has(z * GRID_SIZE + x)) rgb = mixRgb(RIDGE_ROCK, [140, 131, 116], patchAt(x, z));
    else {
      const biome: BiomeId = meadow ? 'isle' : biomeOf({ x, z });
      if (biome !== 'isle') {
        rgb = biomeLandRgb(biome, x, z, depth);
        const sum = sums.get(biome) ?? [0, 0, 0];
        sum[0] += x; sum[1] += z; sum[2]++; sums.set(biome, sum);
      } else {
        const patch = patchAt(x, z), coastal = Math.max(0, 1 - depth / 2);
        rgb = mixRgb([92, 131, 81], [139, 162, 103], patch);
        if (!meadow && inGiantHeadland({ x, z }) && Math.max(x, z) > 49) rgb = mixRgb([126, 132, 119], [164, 159, 129], patch);
        else if (coastal) rgb = mixRgb([142, 159, 103], SAND, coastal);
        // The same small starting clearings used by the woodland scenery.
        else if (meadow && plots.some(p => localX >= p.x && localX < p.x + 8 && localZ >= p.z && localZ < p.z + 8)) rgb = mixRgb([128, 155, 95], [157, 174, 116], patch);
      }
    }
    if (!rgb) continue;
    pixels[i * 4] = rgb[0]; pixels[i * 4 + 1] = rgb[1]; pixels[i * 4 + 2] = rgb[2]; pixels[i * 4 + 3] = 255;
  }
  const biomeLabels = [...sums].map(([id, [sx, sz, n]]) => ({ name: BIOMES[id].name.toUpperCase(), x: sx / n, z: sz / n }));
  return (geography = { pixels, biomeLabels });
}

type LayerCanvas = HTMLCanvasElement | OffscreenCanvas;
type Layer2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
let layersUnsupported = false;
/** An offscreen canvas for a cached layer, or null where canvas 2D is unavailable (tests, old browsers). */
export function createLayerCanvas(width: number, height: number): { canvas: LayerCanvas; ctx: Layer2D } | null {
  if (layersUnsupported) return null;
  // jsdom has canvases without a 2D context; tests paint straight into their own context.
  if (typeof OffscreenCanvas === 'undefined' && typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return null;
  try {
    const canvas: LayerCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d') as Layer2D | null;
    if (ctx) return { canvas, ctx };
  } catch { /* fall through */ }
  layersUnsupported = true;
  return null;
}
/** Testing hook: forget cached layers (and whether canvases are available). */
export function resetMapLayers() { layers.clear(); tileImages.clear(); layersUnsupported = false; staticLayerBuilds = 0; }
const tileImages = new Map<string, LayerCanvas | null>();
/** A one-pixel-per-tile image of a geography, built once. */
export function tileImage(key: string, width: number, height: number, pixels: () => Uint8ClampedArray): LayerCanvas | null {
  if (tileImages.has(key)) return tileImages.get(key)!;
  const layer = createLayerCanvas(width, height);
  if (layer) {
    const image = layer.ctx.createImageData(width, height);
    image.data.set(pixels());
    layer.ctx.putImageData(image, 0, 0);
  }
  tileImages.set(key, layer?.canvas ?? null);
  return layer?.canvas ?? null;
}
/** Fallback with no offscreen canvas: one fillRect per run of equal pixels. */
export function paintTilePixels(ctx: Layer2D, pixels: Uint8ClampedArray, width: number, height: number, left: number, top: number, scale: number) {
  for (let row = 0; row < height; row++) for (let col = 0; col < width;) {
    const i = (row * width + col) * 4;
    let end = col + 1;
    if (pixels[i + 3]) while (end < width && pixels[i + (end - col) * 4 + 3] && pixels[i + (end - col) * 4] === pixels[i] && pixels[i + (end - col) * 4 + 1] === pixels[i + 1] && pixels[i + (end - col) * 4 + 2] === pixels[i + 2]) end++;
    else { while (end < width && !pixels[(row * width + end) * 4 + 3]) end++; col = end; continue; }
    ctx.fillStyle = `rgb(${pixels[i]},${pixels[i + 1]},${pixels[i + 2]})`;
    ctx.fillRect(left + col * scale, top + row * scale, (end - col) * scale + .2, scale + .2);
    col = end;
  }
}
const layers = new Map<string, LayerCanvas>();
/** Exposed for tests: static layers painted so far (once per view, size and pixel ratio). */
export let staticLayerBuilds = 0;
/**
 * Draw a static layer `size` CSS pixels square, painting it offscreen the first
 * time and blitting the cached pixels afterwards. Without offscreen canvases
 * the layer is painted straight into `ctx`.
 */
export function drawStaticLayer(ctx: CanvasRenderingContext2D, key: string, size: number, paint: (layer: Layer2D) => void) {
  const dpr = Math.max(1, (ctx.getTransform?.() as DOMMatrix | undefined)?.a || 1);
  const pixels = Math.max(1, Math.round(size * dpr)), id = `${key}:${pixels}:${size}`;
  let canvas = layers.get(id);
  if (!canvas) {
    const layer = createLayerCanvas(pixels, pixels);
    if (!layer) { paint(ctx); return; }
    staticLayerBuilds++;
    layer.ctx.setTransform(pixels / size, 0, 0, pixels / size, 0, 0);
    paint(layer.ctx);
    canvas = layer.canvas;
    // A handful of sizes are live at once (the small map, the open map's views).
    if (layers.size >= 8) layers.delete(layers.keys().next().value!);
    layers.set(id, canvas);
  }
  ctx.drawImage(canvas, 0, 0, size, size);
}

type Projection = ReturnType<typeof homeMapProjection>;
/** Shared strokes for routes, labels and dots, in one projection. */
function mapPen(ctx: Layer2D, { scale, x, z }: Projection) {
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
    ctx.lineWidth = Math.max(primary ? 1.6 : 1, (primary ? 2.6 : 1.6) * scale); ctx.stroke();
    ctx.strokeStyle = primary ? '#e5d3a3' : 'rgba(194,191,142,.48)';
    ctx.lineWidth = Math.max(primary ? .9 : .35, (primary ? 1.55 : .45) * scale); ctx.stroke();
  };
  const dot = (p: MapPoint, color: string, radius = 1.6) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x(p.x), z(p.z), radius, 0, Math.PI * 2); ctx.fill();
  };
  const label = (text: string, p: MapPoint, font: string, color = '#f4e8c8') => {
    ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(38,70,62,.88)'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    ctx.strokeText(text, x(p.x), z(p.z)); ctx.fillStyle = color; ctx.fillText(text, x(p.x), z(p.z));
  };
  return { route, dot, label };
}
/** The King's Road: the island's harbour road, then on across Frostpine to the Meadows' town. */
const KINGS_ROAD: readonly MapPoint[] = [{ x: 46, z: 29 }, { x: 49, z: 25 }, { x: 64, z: 25 }, { x: 100, z: 25 }, ...EXPANSE_TRAILS[0], town];
/** A waystone: a pale standing stone with a blue rune. */
function waystoneGlyph(ctx: Layer2D, px: number, pz: number, k: number) {
  ctx.fillStyle = '#e8ecef'; ctx.strokeStyle = '#2b3a48'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, pz - k * 1.3); ctx.lineTo(px + k * .7, pz); ctx.lineTo(px, pz + k * .9); ctx.lineTo(px - k * .7, pz); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#4f8fd6'; ctx.fillRect(px - k * .18, pz - k * .45, k * .36, k * .6);
}

/** A ledger clerk: an open cream ledger on a dark desk. */
export function ledgerClerkGlyph(ctx: Layer2D, px: number, pz: number, k: number) {
  ctx.fillStyle = '#4a3622'; ctx.fillRect(px - k - .8, pz - k * .7 - .8, k * 2 + 1.6, k * 1.4 + 1.6);
  ctx.fillStyle = '#f6ecd0'; ctx.fillRect(px - k, pz - k * .7, k * 2, k * 1.4);
  ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = Math.max(.6, k * .25);
  ctx.beginPath(); ctx.moveTo(px, pz - k * .7); ctx.lineTo(px, pz + k * .7); ctx.stroke();
}
/** Everything on the home map that never moves: geography, roads, places and labels. */
function paintHomeStatic(ctx: Layer2D, size: number, view: HomeMapView) {
  const detailed = size >= 200;
  const projection = homeMapProjection(size, view), { scale, x, z } = projection;
  const { route, dot, label } = mapPen(ctx, projection);
  const geo = homeGeography();
  ctx.clearRect(0, 0, size, size);
  const sea = ctx.createLinearGradient(0, 0, size, size);
  sea.addColorStop(0, '#2d6976'); sea.addColorStop(.52, '#357f89'); sea.addColorStop(1, '#245969');
  ctx.fillStyle = sea; ctx.fillRect(0, 0, size, size);

  // Quiet water marks across the whole frame leave the coastline and live markers easy to read.
  const frame = HOME_MAP_VIEWS.overview, rows = Math.ceil(frame.span / 18);
  ctx.strokeStyle = 'rgba(191,222,210,.12)'; ctx.lineWidth = detailed ? .7 : .4;
  for (let row = 0; row < rows; row++) for (let col = 0; col < rows; col++) {
    const px = frame.x + 4 + col * 18 + (row % 2) * 8, pz = frame.z + 21 + row * 18;
    if (homeLand({ x: px, z: pz }) || homeLand({ x: px + 4, z: pz })) continue;
    ctx.beginPath(); ctx.moveTo(x(px), z(pz)); ctx.quadraticCurveTo(x(px + 2), z(pz + .6), x(px + 4), z(pz)); ctx.stroke();
  }
  const image = tileImage('home', GEO_WIDTH, GEO_HEIGHT, () => geo.pixels);
  if (image) {
    // Downscaled tiles blend; enlarged tiles stay crisp.
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.drawImage(image, x(GEO_X0 - .5), z(GEO_Z0 - .5), GEO_WIDTH * scale, GEO_HEIGHT * scale);
    ctx.imageSmoothingEnabled = true;
  } else paintTilePixels(ctx, geo.pixels, GEO_WIDTH, GEO_HEIGHT, x(GEO_X0 - .5), z(GEO_Z0 - .5), scale);
  if (detailed) {
    ctx.fillStyle = 'rgba(40,78,54,.27)';
    const r = Math.max(.6, 1.25 * scale);
    for (const tree of FOREST_TREES) {
      ctx.beginPath(); ctx.arc(x(tree.x), z(tree.z), r, 0, Math.PI * 2); ctx.fill();
    }
  }

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
  route(KINGS_ROAD, true);
  for (const bridge of [...BRIDGES, ...EXPANSE_BRIDGES]) {
    ctx.fillStyle = '#d6bd88';
    ctx.fillRect(x(bridge.x - bridge.width / 2), z(bridge.z - .6), bridge.width * scale, Math.max(1, 1.2 * scale));
  }
  // Causeways: a pale stone edge either side of the dry ground.
  if (detailed) for (const c of CAUSEWAYS) {
    const dx = c.to.x - c.from.x, dz = c.to.z - c.from.z, len = Math.hypot(dx, dz) || 1, nx = -dz / len * c.width, nz = dx / len * c.width;
    ctx.strokeStyle = 'rgba(232,222,196,.55)'; ctx.lineWidth = .8;
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(x(c.from.x + nx * side), z(c.from.z + nz * side)); ctx.lineTo(x(c.to.x + nx * side), z(c.to.z + nz * side)); ctx.stroke();
    }
  }
  // Coast drop boxes (deposit to your vault): gold squares ringed in dark wood.
  if (detailed) for (const box of DROP_BOXES) {
    dot(box, '#3a2c1d', 4);
    ctx.fillStyle = '#e3b65c'; ctx.fillRect(x(box.x) - 2.2, z(box.z) - 2.2, 4.4, 4.4);
  }
  for (const stone of WAYSTONES) waystoneGlyph(ctx, x(stone.x), z(stone.z), detailed ? 3.2 : 1.6);
  for (const clerk of LEDGER_CLERKS) ledgerClerkGlyph(ctx, x(clerk.x), z(clerk.z), detailed ? 2.6 : 1.3);

  if (detailed) {
    if (view !== 'settlement') for (const biome of geo.biomeLabels) label(biome.name, biome, `600 ${view === 'overview' ? 9 : 10}px system-ui`, '#fbefcf');
    if (view === 'overview') {
      label('BRAMBLEWILD', { x: 30, z: -8 }, '600 12px system-ui');
      label('THE MEADOWS', { x: MEADOW_OFFSET.x + 66, z: MEADOW_OFFSET.z - 8 }, '600 13px system-ui');
      label('EASTREACH', { x: 97, z: 54 }, '600 10px system-ui');
      label('SOUTHERN WILDS', { x: 64, z: 128 }, '600 10px system-ui');
    }
    if (view !== 'settlement') label('King’s Road', { x: 186, z: 17 }, '10px system-ui');
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

  if (detailed && view === 'bramblewild') homeMapLandmarkPositions(size).forEach((p, index) => {
    ctx.strokeStyle = '#536342'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(p.anchorX, p.anchorZ); ctx.lineTo(p.x, p.z); ctx.stroke();
    ctx.fillStyle = '#f5e4b7'; ctx.beginPath(); ctx.arc(p.x, p.z, LANDMARK_RADIUS, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.font = `700 ${index >= 9 ? 9 : 11}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#364936'; ctx.fillText(String(index + 1), p.x, p.z);
  });
}

export function drawHomeMap(ctx: CanvasRenderingContext2D, m: MinimapModel, size: number, view: HomeMapView = 'overview') {
  if (size <= 0) return;
  const detailed = size >= 200;
  // Terrain, resources, destinations and players use the same district frame.
  const projection = homeMapProjection(size, view), { scale, x, z } = projection;
  ctx.save();
  drawStaticLayer(ctx, `home:${view}`, size, layer => paintHomeStatic(layer, size, view));
  const { dot, label } = mapPen(ctx, projection);

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
  // Boss markers stay on the small map (outside `detailed`).
  drawBossMarkers(ctx, m, x, scale, size, z);
  drawGoalMarker(ctx, m, x, scale, size, z);
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

/**
 * Clatterhorn (a teal beetle glyph with 'Z', '!' or its return countdown) and
 * the Spire Gate (an obsidian arch with the parties inside). Drawn at every
 * map size, so both show on the small map too.
 */
export function drawBossMarkers(ctx: CanvasRenderingContext2D, m: Pick<MinimapModel, 'clatter' | 'spire'>, px: (v: number) => number, scale: number, size: number, pz: (v: number) => number = px): void {
  const font = Math.min(12, Math.max(8, Math.round(size / 13)));
  const tag = (text: string, x: number, y: number, color: string) => {
    ctx.font = `700 ${font}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(20,16,12,0.85)';
    ctx.fillStyle = color;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  };
  if (m.spire) {
    const x = px(m.spire.x), y = pz(m.spire.z), k = Math.max(3.5, scale * 1.6);
    ctx.fillStyle = m.spire.active > 0 ? '#b79bff' : '#3b2f55';
    ctx.strokeStyle = '#1c1630';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x - k, y + k); ctx.lineTo(x - k, y - k * 0.2); ctx.arc(x, y - k * 0.2, k, Math.PI, 0); ctx.lineTo(x + k, y + k);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const count = m.spire.active + m.spire.queued;
    if (count > 0) tag(m.spire.queued ? `${m.spire.active}+${m.spire.queued}` : String(m.spire.active), x, Math.max(font + 1, y - k * 1.3), '#e9e3ff');
  }
  if (m.clatter) {
    const x = px(m.clatter.x), y = pz(m.clatter.z), k = Math.max(3.5, scale * 1.8);
    const resting = m.clatter.state === ClatterState.Dormant || m.clatter.state === ClatterState.Burrowed;
    ctx.globalAlpha = resting ? 0.6 : 1;
    ctx.fillStyle = '#2e7d6f';
    ctx.strokeStyle = '#13302b';
    ctx.lineWidth = 1.2;
    // Beetle: an oval shell split down the back, with a forked horn.
    ctx.beginPath();
    ctx.ellipse(x, y, k * 0.8, k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - k * 0.6); ctx.lineTo(x, y + k);
    ctx.moveTo(x, y - k); ctx.lineTo(x - k * 0.45, y - k * 1.45);
    ctx.moveTo(x, y - k); ctx.lineTo(x + k * 0.45, y - k * 1.45);
    ctx.stroke();
    ctx.globalAlpha = 1;
    tag(m.clatter.label, x, Math.max(font + 1, y - k * 1.5), m.clatter.label === '!' ? '#ffcf7a' : '#e9e3ff');
  }
}

/**
 * Where the goal chip leads: a gold ring with a slow pulse and a pennant, at
 * every map size, so the small map always shows the way.
 */
export function drawGoalMarker(ctx: CanvasRenderingContext2D, m: Pick<MinimapModel, 'target'>, px: (v: number) => number, scale: number, size: number, pz: (v: number) => number = px, nowMs = Date.now()): void {
  if (!m.target) return;
  const x = px(m.target.x), y = pz(m.target.z), k = Math.max(4.5, scale * 2.2);
  const phase = (nowMs % 1600) / 1600;
  ctx.save();
  ctx.globalAlpha = 0.7 * (1 - phase);
  ctx.strokeStyle = '#ffd54a';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, k * (1 + phase * 1.2), 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 3.2; ctx.strokeStyle = 'rgba(32,24,10,.85)';
  ctx.beginPath(); ctx.arc(x, y, k, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1.8; ctx.strokeStyle = '#ffd54a';
  ctx.beginPath(); ctx.arc(x, y, k, 0, Math.PI * 2); ctx.stroke();
  // Pennant above the ring.
  const top = y - k - Math.max(6, k * 1.2);
  ctx.strokeStyle = 'rgba(32,24,10,.9)'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(x, y - k); ctx.lineTo(x, top); ctx.stroke();
  ctx.fillStyle = '#ffd54a';
  ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + Math.max(5, k), top + Math.max(2.5, k * 0.45)); ctx.lineTo(x, top + Math.max(5, k * 0.9)); ctx.closePath();
  ctx.fill(); ctx.stroke();
  if (m.target.label && size >= 200) {
    const font = Math.min(12, Math.max(9, Math.round(size / 40)));
    ctx.font = `700 ${font}px system-ui, sans-serif`;
    ctx.textAlign = x > size * 0.75 ? 'right' : 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(20,16,12,0.85)'; ctx.fillStyle = '#ffe48a';
    const tx = x > size * 0.75 ? x - k - 4 : x + k + 4;
    ctx.strokeText(m.target.label, tx, y); ctx.fillText(m.target.label, tx, y);
  }
  ctx.restore();
}
