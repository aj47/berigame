import { describe, expect, it } from 'vitest';
import { FOREST_TREES, GRID_SIZE, LEDGER_CLERKS, RIDGE_TILES, terrainField, trailDistance } from '@sim';
import { WAYSTONES } from '@sim/expanse';
import { CHUNK, CHUNKS_PER_SIDE, VIEW_RADIUS, chunkKeyOf, chunksNear, viewCellOf } from '../Components/3D/world/chunks';
import { TERRAIN_COARSE_STEP, TERRAIN_FINE_STEP, buildTerrainChunk } from '../Components/3D/world/terrainGeometry';
import { terrainKeep, terrainPlan } from '../Components/3D/world/TerrainChunks';
import { ridgeChunks, treeChunks, treeStyleAt } from '../Components/3D/world/sceneryLayout';
import { SCATTER_ATTEMPTS, scatterChunk } from '../Components/3D/world/scatterChunks';
import { expanseProps } from '../Components/3D/world/expanseLayout';
import { buildCoastData, createTerrainGeometry, startCoastData } from '../Components/3D/islandTerrainArt';

const spawn = viewCellOf({ x: 25, z: 25, region: 'bramblewild' });
const crossroads = viewCellOf({ x: 172, z: 124, region: 'bramblewild' });
const tris = (g: { getAttribute(n: string): { count: number } } | null) => (g ? g.getAttribute('position').count / 3 : 0);

describe('world chunks: which chunks a player sees', () => {
  it('quantizes you to a view cell, clamps the Meadows onto the grid and uses spawn with no row', () => {
    expect(viewCellOf(null)).toBe(spawn);
    expect(viewCellOf({ x: 26, z: 30 })).toBe(spawn);
    expect(viewCellOf({ x: 10, z: 60, region: 'settlement' }).split(',').map(Number)[0]).toBe((GRID_SIZE - 1) >> 3);
  });

  it('mounts near chunks nearest first and never the far corner', () => {
    const scatter = chunksNear(spawn, VIEW_RADIUS.scatter);
    expect(scatter[0].key).toBe('0,0');
    expect(scatter.length).toBeLessThanOrEqual(9);
    const keys = new Set(chunksNear(spawn, VIEW_RADIUS.trees).map(c => c.key));
    expect(keys.has('0,0')).toBe(true);
    expect(keys.has('7,7')).toBe(false);
    expect(keys.has('6,6')).toBe(false);
    const terrain = terrainPlan(spawn);
    expect(terrain.some(c => c.key === '7,7')).toBe(false);
    expect(terrain.length).toBeLessThan(CHUNKS_PER_SIDE * CHUNKS_PER_SIDE);
    expect(terrain.find(c => c.key === '0,0')!.step).toBe(TERRAIN_FINE_STEP);
    expect(terrain.filter(c => c.step === TERRAIN_FINE_STEP).length).toBeLessThanOrEqual(16);
    expect(terrain.some(c => c.step === TERRAIN_COARSE_STEP)).toBe(true);
    // Every planned chunk (and its stand-in resolution) survives a prune from the same cell.
    const keep = terrainKeep(spawn);
    for (const c of terrain) expect(keep.has(`${c.key}@${c.step}`)).toBe(true);
    expect([...keep].some(k => k.startsWith('7,7@'))).toBe(false);
  });

  it('mounts everything for the dev map review (no game connection)', () => {
    expect(chunksNear(null, 0)).toHaveLength(CHUNKS_PER_SIDE * CHUNKS_PER_SIDE);
  });
});

describe('world chunks: terrain geometry', () => {
  it('builds the island corner exactly like the old single mesh', () => {
    const chunk = buildTerrainChunk(0, 0)!;
    const old = createTerrainGeometry(terrainField, trailDistance, CHUNK);
    const a = chunk.getAttribute('position').array, b = old.getAttribute('position').array;
    expect(a.length).toBe(b.length);
    const ca = chunk.getAttribute('color').array, cb = old.getAttribute('color').array;
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]), Math.abs(ca[i] - cb[i]));
    expect(worst).toBeLessThan(1e-4);
  });

  it('keeps every chunk inside its triangle budget, with real bounds', () => {
    const budgetFine = (CHUNK / TERRAIN_FINE_STEP) ** 2 * 2 * 2, budgetCoarse = (CHUNK / TERRAIN_COARSE_STEP) ** 2 * 2 * 2;
    const t0 = performance.now();
    const isle = buildTerrainChunk(0, 0)!, town = buildTerrainChunk(5, 3)!, far = buildTerrainChunk(6, 6, TERRAIN_COARSE_STEP)!;
    const ms = performance.now() - t0;
    for (const [g, budget] of [[isle, budgetFine], [town, budgetFine], [far, budgetCoarse]] as const) {
      expect(tris(g)).toBeGreaterThan(100);
      expect(tris(g)).toBeLessThanOrEqual(budget);
      expect(g.boundingBox).not.toBeNull();
      expect(g.boundingSphere!.radius).toBeLessThan(CHUNK);
    }
    // Neighbouring chunks meet without overlap: the island chunk ends where chunk 1,0 starts.
    expect(isle.boundingBox!.max.x).toBeLessThanOrEqual(CHUNK - 25.5 + 1e-6);
    console.info(`terrain chunk tris: isle ${tris(isle)}, crossroads ${tris(town)}, starfall@1 ${tris(far)}; 3 chunks in ${ms.toFixed(0)} ms`);
  });

  it('keeps a whole view of terrain inside a triangle budget (spawn and Crossroads)', () => {
    for (const cell of [spawn, crossroads]) {
      const t0 = performance.now();
      let total = 0, meshes = 0;
      for (const c of terrainPlan(cell)) { const g = buildTerrainChunk(c.cx, c.cz, c.step); if (g) { total += tris(g); meshes++; } }
      expect(total).toBeLessThan(400_000);
      console.info(`terrain view from ${cell}: ${meshes} chunk meshes, ${total} tris, built in ${(performance.now() - t0).toFixed(0)} ms`);
    }
  }, 30_000);

  it('gives mainland ground its biome colours', () => {
    const snow = buildTerrainChunk(5, 0)!.getAttribute('color').array;
    const isle = buildTerrainChunk(0, 0)!.getAttribute('color').array;
    const mean = (c: ArrayLike<number>) => { let s = 0; for (let i = 0; i < c.length; i++) s += c[i]; return s / c.length; };
    expect(mean(snow)).toBeGreaterThan(mean(isle) * 1.5);
  });
});

describe('world chunks: scenery', () => {
  it('puts every forest trunk in exactly one chunk list, one draw per style per chunk', () => {
    const chunks = treeChunks();
    let total = 0, draws = 0;
    for (const byStyle of chunks.values()) for (const list of Object.values(byStyle)) { total += list!.count; draws++; }
    expect(total).toBe(FOREST_TREES.length);
    expect(draws).toBeLessThanOrEqual(chunks.size * 2);
    expect(treeStyleAt({ x: 25, z: 25 })).toBe('broadleaf');
    expect(treeStyleAt({ x: 190, z: 38 })).toBe('snowpine');
    expect(treeStyleAt({ x: 212, z: 206 })).toBe('crystal');
    const near = chunksNear(spawn, VIEW_RADIUS.trees).reduce((n, c) => n + Object.keys(chunks.get(c.key) ?? {}).length, 0);
    console.info(`trees: ${FOREST_TREES.length} trunks in ${chunks.size} chunks (${draws} draws total, ${near} mounted from spawn)`);
  });

  it('walls every ridge tile with rock, per chunk', () => {
    let rocks = 0;
    for (const list of ridgeChunks().values()) rocks += list.count;
    expect(rocks).toBeGreaterThanOrEqual(RIDGE_TILES.length);
    expect(rocks).toBeLessThan(RIDGE_TILES.length * 6);
  });

  it('scatters bounded, biome-aware ground cover per chunk', () => {
    const isle = scatterChunk(0, 0), snow = scatterChunk(5, 1), fen = scatterChunk(1, 5), dunes = scatterChunk(4, 6), star = scatterChunk(6, 6);
    expect(isle.tuft!.count).toBeGreaterThan(20);
    expect(snow.snowTuft!.count).toBeGreaterThan(5);
    expect(fen.reed!.count).toBeGreaterThan(5);
    expect(dunes.dryTuft!.count).toBeGreaterThan(5);
    expect(star.shard!.count).toBeGreaterThan(0);
    expect(snow.tuft?.count ?? 0).toBe(0);
    let instances = 0;
    for (const c of chunksNear(spawn, VIEW_RADIUS.scatter)) for (const l of Object.values(scatterChunk(c.cx, c.cz))) {
      if (l!.count && l !== undefined) instances += l.count;
    }
    for (const s of [isle, snow, fen, dunes, star]) for (const [kind, l] of Object.entries(s)) expect(l!.count).toBeLessThanOrEqual(kind === 'palm' ? 120 : SCATTER_ATTEMPTS);
    console.info(`ground cover mounted from spawn: ${instances} instances`);
  });

  it('places a desk at every ledger clerk and a stone at every waystone, on dry ground', () => {
    const props = expanseProps();
    expect(props.filter(p => p.kind === 'clerk')).toHaveLength(LEDGER_CLERKS.length);
    expect(props.filter(p => p.kind === 'waystone')).toHaveLength(WAYSTONES.length);
    for (const kind of ['gatehouse', 'stall', 'stiltHut', 'palm', 'rimStone', 'watchtower', 'signpost'] as const) expect(props.some(p => p.kind === kind)).toBe(true);
    for (const p of props) if (p.kind !== 'stiltHut') expect(terrainField(p.x, p.z)).toBeGreaterThan(0);
    for (const c of LEDGER_CLERKS) {
      const desk = props.find(p => p.kind === 'clerk' && p.label?.startsWith(c.name))!;
      expect(Math.hypot(desk.x - c.x, desk.z - c.z)).toBeLessThanOrEqual(5);
      expect(desk.chunk).toBe(chunkKeyOf(desk.x, desk.z));
    }
  });
});

describe('coast texture', () => {
  it('samples the field far fewer times than once per texel, exact near the shore', () => {
    expect(startCoastData().samples).toBeLessThan(20_000);
    const { data, n, samples } = buildCoastData();
    expect(n).toBe(GRID_SIZE * 2);
    expect(samples).toBeLessThan(n * n * .6);
    const encode = (d: number) => Math.round(Math.max(0, Math.min(1, (8 - d) / 32)) * 255);
    for (const [x, z] of [[60, 50], [300, 50], [250, 250], [400, 400], [20, 300]]) {
      const d = terrainField((x + .5) / 2 - .5, (z + .5) / 2 - .5);
      expect(Math.abs(data[z * n + x] - encode(d))).toBeLessThanOrEqual(Math.abs(d) < 3 ? 0 : 6);
    }
    console.info(`coast texture: ${samples} field samples for ${n * n} texels`);
  }, 20_000);
});

describe('world modules', () => {
  it('load without building terrain or the coast texture at import', async () => {
    const t0 = performance.now();
    const mods = await Promise.all([import('../Components/3D/AlphaIsland'), import('../Components/3D/IslandLandmarks'), import('../Components/3D/IslandDetails'), import('../Objects/GroundPlane')]);
    for (const m of mods) expect(m.default).toBeTypeOf('function');
    const { terrainCacheSize } = await import('../Components/3D/world/terrainGeometry');
    expect(terrainCacheSize()).toBe(0);
    console.info(`world modules imported in ${(performance.now() - t0).toFixed(0)} ms`);
  }, 20_000);
});
