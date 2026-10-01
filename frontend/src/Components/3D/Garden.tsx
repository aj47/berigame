import React, { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Html } from '@react-three/drei';
import { BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, MeshStandardMaterial } from 'three';
import {
  GARDEN_CROPS, GARDEN_EXTRA_PLOT_LEVEL, GARDEN_MAX_PLOTS, GARDEN_PLOT_TILES, GardenStage, countItem, formatGardenTime,
  gardenPlotAt, gardenPlotCountForXp, gardenRemainingMs, gardenStage, getGardenCrop, getItemDef, inGardenReach,
  tileToWorld, worldToTile, type GardenPlant,
} from '@sim';
import { useGameActions } from '../../spacetime/actions';
import { useGardenPlots, useInventoryRows, useMyPlayer, useMySkills } from '../../spacetime/hooks';
import { gardenClockNow, subscribeGardenClock, useGardenStore } from '../../spacetime/stores/gardenStore';
import { useToastStore } from '../../spacetime/stores/toastStore';
import { useLoadingStore, useUserInputStore } from '../../store';
import { merged, part } from './envArt';
import { slotsFromRows } from '../itemUi';
import type { HoverTarget } from './hoverTarget';

/*
 * The garden terrace: one merged, vertex-coloured mesh for the frame and the
 * four soil beds (always drawn, so everyone sees bare soil there), plus one
 * merged mesh per planted plot of YOURS (only your rows reach this client).
 * Geometries are built once per (crop, stage) and shared; the only per-second
 * work is a label string, and memoized plots skip re-renders when it is equal.
 */

const WOOD = 0x8a6a45, WOOD_DARK = 0x6b4a2e, SOIL = 0x5a3b24, SOIL_DARK = 0x4a2f1c, LEAF = 0x4f9a3f, LEAF_LIGHT = 0x6cb85a, STRAW = 0xc9a86a;

const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);

/** Plot centres relative to the terrace origin (the NW plot's tile centre). */
const ORIGIN = GARDEN_PLOT_TILES[0];
const rel = (i: number): [number, number] => [GARDEN_PLOT_TILES[i].x - ORIGIN.x, GARDEN_PLOT_TILES[i].z - ORIGIN.z];

let terraceGeo: BufferGeometry | null = null;
function terrace(): BufferGeometry {
  if (terraceGeo) return terraceGeo;
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < GARDEN_PLOT_TILES.length; i++) {
    const [x, z] = rel(i);
    parts.push(part(box(0.84, 0.14, 0.84), SOIL, [x, 0.07, z], [1, 1, 1], [0, 0, 0], 0.25, 11 + i));
    // Furrows.
    for (const dz of [-0.22, 0, 0.22]) parts.push(part(box(0.7, 0.04, 0.07), SOIL_DARK, [x, 0.155, z + dz], [1, 1, 1], [0, 0, 0], 0.2, 20 + i));
  }
  // A low plank frame around the 2x2 patch, with corner posts.
  const lo = -0.5, hi = 1.5, mid = 0.5, len = 2.05;
  parts.push(part(box(len, 0.12, 0.08), WOOD, [mid, 0.08, lo], [1, 1, 1], [0, 0, 0], 0.2, 31));
  parts.push(part(box(len, 0.12, 0.08), WOOD, [mid, 0.08, hi], [1, 1, 1], [0, 0, 0], 0.2, 32));
  parts.push(part(box(0.08, 0.12, len), WOOD, [lo, 0.08, mid], [1, 1, 1], [0, 0, 0], 0.2, 33));
  parts.push(part(box(0.08, 0.12, len), WOOD, [hi, 0.08, mid], [1, 1, 1], [0, 0, 0], 0.2, 34));
  for (const [x, z] of [[lo, lo], [hi, lo], [lo, hi], [hi, hi]]) parts.push(part(box(0.13, 0.3, 0.13), WOOD_DARK, [x, 0.15, z], [1, 1, 1], [0, 0, 0], 0.2, 35));
  // A little sign post on the south-west corner.
  parts.push(part(new CylinderGeometry(0.04, 0.05, 0.7, 5), WOOD_DARK, [lo - 0.15, 0.35, hi + 0.12], [1, 1, 1], [0, 0, 0], 0.2, 40));
  parts.push(part(box(0.46, 0.24, 0.05), WOOD, [lo - 0.15, 0.62, hi + 0.12], [1, 1, 1], [0, 0.3, 0], 0.2, 41));
  terraceGeo = merged(parts);
  return terraceGeo;
}

let lockGeo: BufferGeometry | null = null;
/** Straw laid over a plot you cannot use yet (it opens at Foraging 5). */
function lockCover(): BufferGeometry {
  if (lockGeo) return lockGeo;
  const parts: BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) parts.push(part(box(0.78, 0.03, 0.12), STRAW, [0, 0.17, -0.3 + k * 0.15], [1, 1, 1], [0, (k % 2 ? 0.12 : -0.1), 0], 0.35, 50 + k));
  lockGeo = merged(parts);
  return lockGeo;
}

const hex = (css: string) => parseInt(css.replace('#', ''), 16);
const plantGeoCache = new Map<string, BufferGeometry>();
/** One merged geometry per crop and growth stage. */
function plantGeometry(itemId: string, stage: GardenStage): BufferGeometry {
  const key = `${itemId}:${stage}`;
  let g = plantGeoCache.get(key);
  if (g) return g;
  const berry = hex(getItemDef(itemId)?.color ?? '#4F46E5');
  const parts: BufferGeometry[] = [];
  if (stage === GardenStage.Seed) {
    parts.push(part(new IcosahedronGeometry(0.16, 0), SOIL_DARK, [0, 0.16, 0], [1, 0.45, 1], [0, 0, 0], 0.2, 1));
    parts.push(part(new IcosahedronGeometry(0.045, 0), berry, [0.02, 0.23, 0.02], [1, 1, 1], [0, 0, 0], 0.1, 2));
  } else if (stage === GardenStage.Sprout) {
    parts.push(part(new CylinderGeometry(0.018, 0.025, 0.28, 4), LEAF, [0, 0.29, 0], [1, 1, 1], [0, 0, 0], 0.2, 3));
    parts.push(part(new ConeGeometry(0.09, 0.2, 4), LEAF_LIGHT, [0.08, 0.4, 0], [1, 0.4, 1], [0, 0, -1.1], 0.2, 4));
    parts.push(part(new ConeGeometry(0.09, 0.2, 4), LEAF_LIGHT, [-0.08, 0.38, 0], [1, 0.4, 1], [0, 0, 1.1], 0.2, 5));
  } else {
    parts.push(part(new CylinderGeometry(0.03, 0.04, 0.25, 5), WOOD_DARK, [0, 0.27, 0], [1, 1, 1], [0, 0, 0], 0.2, 6));
    parts.push(part(new IcosahedronGeometry(0.3, 0), LEAF, [0, 0.52, 0], [1, 0.8, 1], [0, 0.4, 0], 0.25, 7));
    parts.push(part(new IcosahedronGeometry(0.2, 0), LEAF_LIGHT, [0.15, 0.66, -0.08], [1, 0.8, 1], [0, 1.1, 0], 0.25, 8));
    const spots: [number, number, number][] = [[0.24, 0.5, 0.14], [-0.22, 0.55, 0.16], [0.05, 0.7, 0.24], [-0.14, 0.45, -0.2], [0.2, 0.62, -0.18], [-0.02, 0.78, -0.05]];
    const r = stage === GardenStage.Ripe ? 0.09 : 0.035;
    for (let i = 0; i < spots.length; i++) {
      parts.push(part(new IcosahedronGeometry(r, 0), stage === GardenStage.Ripe ? berry : 0x9fcf7a, spots[i], [1, 1, 1], [0, 0, 0], 0.15, 10 + i));
    }
  }
  g = merged(parts);
  plantGeoCache.set(key, g);
  return g;
}

const useNowMs = () => useSyncExternalStore(subscribeGardenClock, gardenClockNow);

interface PlotProps { index: number; itemId: string; stage: GardenStage; label: string; ripe: boolean }

const GardenPlantMesh = React.memo(({ index, itemId, stage, label, ripe }: PlotProps) => {
  const [x, z] = rel(index);
  const geo = plantGeometry(itemId, stage);
  return (
    <group position={[x, 0, z]}>
      <mesh geometry={geo} material={material} castShadow raycast={noRaycast} />
      <Html position={[0, 1.05, 0]} center zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`garden-label${ripe ? ' garden-label-ripe' : ''}`} data-garden-plot={index}>{label}</div>
      </Html>
    </group>
  );
});

const noRaycast = () => {};

export interface GardenPlotView { index: number; plant: GardenPlant | null; locked: boolean }

/** The terrace plus your own plants and the tap menu. */
const Garden = () => {
  const rows = useGardenPlots();
  const skills = useMySkills();
  const me = useMyPlayer();
  const inventory = useInventoryRows();
  const now = useNowMs();
  const setClickedOtherObject = useUserInputStore((s: any) => s.setClickedOtherObject);
  const { plantGarden, harvestGarden, setTarget } = useGameActions();
  const queue = useGardenStore((s) => s.queue);
  const clear = useGardenStore((s) => s.clear);
  const queued = useGardenStore((s) => s.queued);
  const show = useToastStore((s) => s.show);
  // Wait for the loading screen to lift, so the returning-player toast is actually seen.
  const loaded = useLoadingStore((s: any) => s.gameDataLoaded && !s.isLoading);

  const unlocked = gardenPlotCountForXp(skills?.foragingXp ?? 0);
  const plots: GardenPlotView[] = useMemo(() => {
    const out: GardenPlotView[] = [];
    for (let i = 0; i < GARDEN_MAX_PLOTS; i++) out.push({ index: i, plant: null, locked: i >= unlocked });
    for (const r of rows) if (r.plot < GARDEN_MAX_PLOTS) out[r.plot].plant = { itemId: r.itemId, plantedAtMs: Number(r.plantedAtMicros / 1000n) };
    return out;
  }, [rows, unlocked]);

  const ripeCount = plots.reduce((n, p) => n + (p.plant && gardenRemainingMs(p.plant, now) === 0 ? 1 : 0), 0);

  // "Your garden is ripe" once per session on login, then whenever another plot ripens.
  const lastRipe = useRef<number | null>(null);
  useEffect(() => {
    if (!loaded || !me) return;
    const prev = lastRipe.current;
    lastRipe.current = ripeCount;
    if (prev === null) {
      if (ripeCount > 0) show(`Your garden is ripe — ${ripeCount} plot${ripeCount === 1 ? '' : 's'} ready`);
    } else if (ripeCount > prev) show(ripeCount === 1 ? 'A plot in your garden is ripe' : `Your garden is ripe — ${ripeCount} plots ready`);
  }, [loaded, me, ripeCount, show]);

  const run = useCallback((kind: 'plant' | 'harvest', plot: number, itemId?: string) => {
    if (!me) return;
    if (inGardenReach(me, plot)) {
      clear();
      if (kind === 'plant') plantGarden(plot, itemId!);
      else harvestGarden(plot);
      return;
    }
    const q = queue({ kind, plot, itemId });
    setTarget(q.target.x, q.target.z);
  }, [me, clear, queue, plantGarden, harvestGarden, setTarget]);

  // Run a queued action once you arrive; drop it if you walked off elsewhere.
  useEffect(() => {
    if (!queued || !me) return;
    if (inGardenReach(me, queued.plot)) {
      clear();
      if (queued.kind === 'plant') plantGarden(queued.plot, queued.itemId!);
      else harvestGarden(queued.plot);
    } else if (me.targetX === undefined || me.targetX !== queued.target.x || me.targetZ !== queued.target.z) {
      // Allow the tick the move request takes to land before giving up.
      const t = setTimeout(() => {
        const q = useGardenStore.getState().queued;
        if (q === queued) clear();
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [queued, me, clear, plantGarden, harvestGarden]);

  const slots = useMemo(() => slotsFromRows(inventory), [inventory]);

  const hoverTarget: HoverTarget = (point) => {
    const index = Math.max(0, gardenPlotAt(worldToTile(point.x, point.z)));
    const view = plots[index];
    const left = view.plant ? gardenRemainingMs(view.plant, Date.now()) : 0;
    const name = view.plant ? getItemDef(view.plant.itemId)?.name ?? 'Berries' : '';
    const seeds = GARDEN_CROPS.some(crop => countItem(slots, crop.itemId) > 0);
    return {
      title: `Your garden · plot ${index + 1}`, action: 'Click for garden options', radius: .5, tile: GARDEN_PLOT_TILES[index],
      detail: view.locked ? `Opens at Foraging level ${GARDEN_EXTRA_PLOT_LEVEL}` : view.plant ? left > 0 ? `${name} · ready in ${formatGardenTime(left)}` : `${name} · ready to harvest` : seeds ? 'Empty plot · choose a berry to plant' : 'Empty plot · bring a berry to plant',
      tone: view.locked || left > 0 || (!view.plant && !seeds) ? 'muted' : 'ready',
    };
  };

  const onClick = (e: any) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    const tile = worldToTile(e.point.x, e.point.z);
    let index = gardenPlotAt(tile);
    if (index < 0) index = 0;
    const view = plots[index];
    const close = () => setClickedOtherObject(null);
    const options: { label: string; onClick: () => void; disabled?: boolean }[] = [];
    if (view.locked) {
      options.push({ label: `Opens at Foraging level ${GARDEN_EXTRA_PLOT_LEVEL}`, onClick: close, disabled: true });
    } else if (!view.plant) {
      for (const crop of GARDEN_CROPS) {
        const have = countItem(slots, crop.itemId);
        const name = getItemDef(crop.itemId)?.name ?? crop.itemId;
        options.push({
          label: `Plant ${name} · ${formatGardenTime(crop.growMs)} → ${crop.yield}${have ? '' : ' (none in bag)'}`,
          disabled: have === 0,
          onClick: () => { close(); run('plant', index, crop.itemId); },
        });
      }
    } else {
      const crop = getGardenCrop(view.plant.itemId);
      const name = getItemDef(view.plant.itemId)?.name ?? 'berries';
      const left = gardenRemainingMs(view.plant, Date.now());
      if (left === 0) options.push({ label: `Harvest ${crop?.yield ?? ''} ${name}`, onClick: () => { close(); run('harvest', index); } });
      else options.push({ label: `${name} growing · ${formatGardenTime(left)} left`, onClick: close, disabled: true });
    }
    setClickedOtherObject({ connectionId: `Your garden · plot ${index + 1}`, e, dropdownOptions: options });
  };

  const [ox, , oz] = tileToWorld(ORIGIN);
  return (
    <group position={[ox, 0, oz]} name="garden-terrace" userData={{ hoverTarget }}>
      <mesh geometry={terrace()} material={material} receiveShadow onClick={onClick} />
      {plots.map((p) => p.locked && (() => { const [x, z] = rel(p.index); return <mesh key={`lock-${p.index}`} position={[x, 0, z]} geometry={lockCover()} material={material} raycast={noRaycast} />; })())}
      {plots.map((p) => {
        if (!p.plant) return null;
        const left = gardenRemainingMs(p.plant, now);
        return (
          <GardenPlantMesh key={p.index} index={p.index} itemId={p.plant.itemId} stage={gardenStage(p.plant, now)}
            ripe={left === 0} label={left === 0 ? 'Ripe!' : formatGardenTime(left)} />
        );
      })}
    </group>
  );
};

export default React.memo(Garden);
