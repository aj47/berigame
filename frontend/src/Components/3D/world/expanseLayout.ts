import { DROP_BOXES, LEDGER_CLERKS, terrainField, trailDistance, type Tile } from '@sim';
import { EXPANSE_LAKES, EXPANSE_LANDMARKS, WAYSTONES, onRidge } from '@sim/expanse';
import { chunkKeyOf } from './chunks';

/**
 * Where the mainland's props stand: waystones, the ledger clerks' desks,
 * Kingsgate's gatehouse, Crossroads' stalls, Fenhold's stilt huts, the Oasis
 * palms, the Crater's rim stones, Rimewatch's tower and a signpost by every
 * landmark. Pure and deterministic; props keep off roads and each other.
 */
export type PropKind = 'waystone' | 'clerk' | 'gatehouse' | 'stall' | 'stiltHut' | 'palm' | 'rimStone' | 'watchtower' | 'signpost';
export interface PlacedProp { kind: PropKind; x: number; z: number; yaw: number; scale: number; variant: number; label?: string; chunk: string }

const taken: Tile[] = [];
function spot(c: Tile, rMin: number, rMax: number, opts: { phase?: number; clear?: number; road?: number; wet?: boolean } = {}): Tile | null {
  const clear = opts.clear ?? 2.2, road = opts.road ?? 1.9;
  for (let r = rMin; r <= rMax; r += .5) for (let k = 0; k < 16; k++) {
    const a = (opts.phase ?? 0) + k * Math.PI * 2 / 16;
    const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    if (terrainField(x, z) < (opts.wet ? -1.5 : 1) || trailDistance(x, z) < road || onRidge({ x: Math.round(x), z: Math.round(z) })) continue;
    if (taken.some(t => Math.hypot(t.x - x, t.z - z) < clear)) continue;
    const t = { x, z };
    taken.push(t);
    return t;
  }
  return null;
}

let layout: PlacedProp[] | undefined;
export function expanseProps(): PlacedProp[] {
  if (layout) return layout;
  const out: PlacedProp[] = [];
  taken.length = 0;
  taken.push(...DROP_BOXES, ...WAYSTONES);
  const put = (kind: PropKind, t: Tile | null, yaw = 0, scale = 1, variant = 0, label?: string) => {
    if (t) out.push({ kind, x: t.x, z: t.z, yaw, scale, variant, label, chunk: chunkKeyOf(t.x, t.z) });
  };
  const face = (from: Tile, to: Tile) => Math.atan2(to.x - from.x, to.z - from.z);
  // A waystone stands just north of its tile, so whoever comes back there appears in front of it.
  for (const w of WAYSTONES) put('waystone', { x: w.x, z: w.z - .7 }, 0, 1, 0, w.name);
  for (const c of LEDGER_CLERKS) {
    const t = spot(c, c.id === 'market' ? 3 : 1.5, 5, { phase: .6 });
    put('clerk', t, t ? face(t, c) : 0, 1, 0, `${c.name} · ledger commissions`);
  }
  const lm = Object.fromEntries(EXPANSE_LANDMARKS.map(l => [l.id, l]));
  put('gatehouse', { x: lm.kingsgate.x, z: lm.kingsgate.z }, 0, 1.1);
  taken.push({ x: lm.kingsgate.x, z: lm.kingsgate.z + 3.4 }, { x: lm.kingsgate.x, z: lm.kingsgate.z - 3.4 });
  for (let i = 0; i < 4; i++) { const t = spot(lm.crossroads, 4, 9, { phase: i * 1.7, clear: 2.8 }); put('stall', t, t ? face(t, lm.crossroads) : 0, 1, i); }
  for (let i = 0; i < 4; i++) { const t = spot(lm.fenhold, 3.5, 9, { phase: i * 1.9, clear: 3.2, wet: true, road: 2.2 }); put('stiltHut', t, i * 1.3, .95 + (i % 2) * .1, i); }
  const oasis = EXPANSE_LAKES.find(l => l.id === 'oasis')!;
  for (let i = 0; i < 11; i++) {
    const a = i / 11 * Math.PI * 2, x = oasis.x + Math.cos(a) * (oasis.rx + 1.4), z = oasis.z + Math.sin(a) * (oasis.rz + 1.4);
    if (terrainField(x, z) > .2 && trailDistance(x, z) > 1.6) put('palm', { x, z }, i * 2.4, .85 + (i % 3) * .12);
  }
  const crater = EXPANSE_LAKES.find(l => l.id === 'crater')!;
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * Math.PI * 2, r = crater.rx + 2.6 + (i % 3) * .5, x = crater.x + Math.cos(a) * r, z = crater.z + Math.sin(a) * r;
    if (terrainField(x, z) > .6 && trailDistance(x, z) > 2.2) put('rimStone', { x, z }, i * 1.9, .75 + (i % 4) * .18, i);
  }
  put('watchtower', spot(lm.rimewatch, 2, 5, { clear: 3 }), 0, 1);
  for (const l of EXPANSE_LANDMARKS) put('signpost', spot(l, 2, 5, { phase: 2.3, road: 1.4 }), .6, 1, 0, l.name);
  return layout = out;
}
