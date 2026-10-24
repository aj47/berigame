import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRID_SIZE, areaOf, isBridge, terrainField, trailDistance } from '@sim';
import { BIOMES, biomeOf, onRidge, type BiomeId } from '../../../shared/sim/expanse';
import * as art from '../frontier/homeMapArt';
import { drawMinimap, legacyTileRgb, minimapModel } from '../Components/minimapModel';

/** A 2D context that counts what is drawn into it. */
function recorder(calls: Record<string, number> = {}) {
  const ctx = new Proxy({}, {
    get: (_target, name: string) => {
      if (name === 'calls') return calls;
      if (name === 'getTransform') return () => ({ a: 2 });
      if (name === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (name === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      return (..._args: unknown[]) => { calls[name] = (calls[name] ?? 0) + 1; };
    },
    set: () => true,
  });
  return ctx as CanvasRenderingContext2D & { calls: Record<string, number> };
}
class FakeOffscreenCanvas {
  width: number; height: number; ctx = recorder();
  constructor(width: number, height: number) { this.width = width; this.height = height; }
  getContext() { return this.ctx; }
}

const empty = { meHex: null, players: [], trees: [], groundItems: [], tick: 0 };
const interior = (biome: BiomeId) => {
  for (let z = 0; z < GRID_SIZE; z++) for (let x = 0; x < GRID_SIZE; x++) {
    if (biomeOf({ x, z }) === biome && terrainField(x, z) > 3 && trailDistance(x, z) > 2 && !onRidge({ x, z })) return { x, z };
  }
  throw new Error(`no interior tile in ${biome}`);
};
const within = (rgb: readonly number[], [a, b]: readonly [number, number]) => rgb.every((c, i) => {
  const lo = Math.min(a >> (16 - i * 8) & 255, b >> (16 - i * 8) & 255), hi = Math.max(a >> (16 - i * 8) & 255, b >> (16 - i * 8) & 255);
  return c >= lo - 1 && c <= hi + 1;
});

describe('biome colours', () => {
  it('paints Expanse land in its biome ground colours, washed toward the shore', () => {
    for (const biome of ['frostpine', 'hearthvale', 'glimmerfen', 'dunes', 'starfall'] as const) {
      const t = interior(biome);
      expect(within(art.biomeLandRgb(biome, t.x, t.z, terrainField(t.x, t.z)), BIOMES[biome].ground)).toBe(true);
      // The legacy (no Meadows) map uses the same biome colours.
      expect(within(legacyTileRgb(t.x, t.z)!, BIOMES[biome].ground)).toBe(true);
    }
    const dunes = art.biomeLandRgb('dunes', 128, 200, 5), shore = art.biomeLandRgb('dunes', 128, 200, .2);
    expect(shore).not.toEqual(dunes);
  });
  it('keeps the original island palette and draws open sea as nothing', () => {
    const grove = Array.from({ length: 40 * 40 }, (_, k) => ({ x: k % 40, z: Math.floor(k / 40) }))
      .find(t => areaOf(t) === 'grove' && trailDistance(t.x, t.z) > 1 && terrainField(t.x, t.z) >= 1.8 && !isBridge(t))!;
    expect(legacyTileRgb(grove.x, grove.z)).toEqual([0x75, 0xa3, 0x54]);
    expect(legacyTileRgb(GRID_SIZE - 1, GRID_SIZE - 1)).toBeNull();
  });
});

describe('static map layers', () => {
  beforeEach(() => { vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas); art.resetMapLayers(); });
  afterEach(() => { vi.unstubAllGlobals(); art.resetMapLayers(); });

  it('paints the home map geography once and only blits it on later frames', () => {
    const model = minimapModel({ ...empty, home: { claims: [] } });
    const frame = recorder();
    drawMinimap(frame, model, 480, 'overview');
    expect(art.staticLayerBuilds).toBe(1);
    const firstFills = frame.calls.fillRect ?? 0;
    for (let i = 0; i < 4; i++) drawMinimap(frame, model, 480, 'overview');
    expect(art.staticLayerBuilds).toBe(1);
    expect(art.homeGeographySamples).toBeLessThanOrEqual(1);
    expect(frame.calls.drawImage).toBe(5);
    // Per frame, only live markers are drawn: no per-tile fills.
    expect((frame.calls.fillRect ?? 0) - firstFills).toBeLessThan(200);
    drawMinimap(frame, model, 480, 'bramblewild');
    drawMinimap(frame, model, 120, 'bramblewild');
    expect(art.staticLayerBuilds).toBe(3);
    drawMinimap(frame, model, 120, 'bramblewild');
    expect(art.staticLayerBuilds).toBe(3);
  });

  it('caches the legacy map the same way', () => {
    const frame = recorder();
    for (let i = 0; i < 3; i++) drawMinimap(frame, minimapModel(empty), 120);
    expect(art.staticLayerBuilds).toBe(1);
    expect(frame.calls.drawImage).toBe(3);
    expect(frame.calls.fillRect ?? 0).toBeLessThan(60);
  });

  it('still paints straight into the context without offscreen canvases', () => {
    vi.unstubAllGlobals();
    art.resetMapLayers();
    const frame = recorder();
    drawMinimap(frame, minimapModel({ ...empty, home: { claims: [] } }), 240, 'bramblewild');
    expect(art.staticLayerBuilds).toBe(0);
    expect(frame.calls.fillRect).toBeGreaterThan(1000);
    expect(frame.calls.drawImage).toBeUndefined();
  });
});
