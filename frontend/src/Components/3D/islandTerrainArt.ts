import { BufferGeometry, Color, DataTexture, Float32BufferAttribute, LinearFilter, MeshStandardMaterial, RedFormat } from 'three';
import { GRID_SIZE, TILE_ORIGIN, inGiantHeadland, terrainField } from '@sim';
import { linear } from './nodes/lowPoly';

const grass = linear(0x7ca655), deepGrass = linear(0x578644), sand = linear(0xecd099), ash = linear(0x8b897c), trail = linear(0xceba91);
export const terrainMaterial = new MeshStandardMaterial({vertexColors:true, roughness:1, flatShading:true});
/** Clip small triangles against the continuous shore, keeping soft coves and riverbanks. */
export function createTerrainGeometry(field: (x:number,z:number)=>number, roadAt: (x:number,z:number)=>number, size=GRID_SIZE, offset={x:0,z:0}, step=.5, rocks=true) {
  const positions: number[] = [], colors: number[] = [];
  type V = {x:number;z:number;d:number};
  const vertex = (v: V) => {
    positions.push(v.x-TILE_ORIGIN, Math.min(0,v.d*.15-.15),v.z-TILE_ORIGIN);
    const wx=v.x+offset.x,wz=v.z+offset.z;
    const patch = .5+.2*Math.sin(wx*.28+Math.sin(wz*.17))+.18*Math.sin(wz*.37-wx*.14)+.07*Math.sin(wx*2.7+wz*3.1);
    const c = new Color().copy(deepGrass).lerp(grass,patch);
    if(rocks && inGiantHeadland(v) && Math.max(v.x,v.z)>49) c.copy(ash).multiplyScalar(.85+patch*.25);
    else c.lerp(sand, Math.max(0,1-v.d/1.7));
    const road = roadAt(v.x,v.z);
    const wornEdge = .1*Math.sin(wx*2.3+wz*.9)+.07*Math.sin(wz*2.7-wx*.6);
    if(v.d>.5) c.lerp(trail,Math.max(0,Math.min(1,(1.05+wornEdge-road)*2.7))*(.78+patch*.12));
    c.toArray(colors,colors.length);
  };
  const clip = (tri: V[]) => {
    const poly: V[] = [];
    for(let i=0;i<3;i++){
      const a=tri[i],b=tri[(i+1)%3];
      if(a.d>=0)poly.push(a);
      if((a.d>=0)!==(b.d>=0)){const t=a.d/(a.d-b.d);poly.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,d:0});}
    }
    for(let i=1;i<poly.length-1;i++){vertex(poly[0]);vertex(poly[i]);vertex(poly[i+1]);}
  };
  // Cache field samples; adjacent cells share identical coastline intersections.
  const n=size/step+1, values=new Float32Array(n*n);
  for(let z=0;z<n;z++)for(let x=0;x<n;x++) values[z*n+x]=field(x*step-.5,z*step-.5);
  for(let z=0;z<n-1;z++)for(let x=0;x<n-1;x++){
    const a={x:x*step-.5,z:z*step-.5,d:values[z*n+x]},b={x:(x+1)*step-.5,z:z*step-.5,d:values[z*n+x+1]},c={x:(x+1)*step-.5,z:(z+1)*step-.5,d:values[(z+1)*n+x+1]},d={x:x*step-.5,z:(z+1)*step-.5,d:values[(z+1)*n+x]};
    clip([a,d,b]);clip([b,d,c]);
  }
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));g.setAttribute('color',new Float32BufferAttribute(colors,3));g.computeVertexNormals();g.computeBoundingSphere();return g;
}
/**
 * Signed coastal distance in a small texture, shared by the river and ocean shader:
 * texel value (8 - d) / 32, two texels per tile over the whole grid.
 *
 * Built lazily (the ocean's first mount), never at import, and in two passes:
 * the field is sampled on a coarse 2-tile lattice and interpolated (fast, so the
 * first frame already has shallows and foam), then every coarse cell near the
 * shore, where foam and shallows need it exact, is refined a few milliseconds a
 * frame (refineCoastTexture). Open water and inland ground stay interpolated.
 */
export const COAST_TEXELS_PER_TILE = 2;
const COAST_CELL = 4;
const encodeCoast = (d: number) => Math.round(Math.max(0, Math.min(1, (8 - d) / 32)) * 255);
export interface CoastBuild { data: Uint8Array; n: number; samples: number; /** Coarse cells still to refine (cell index). */ pending: number[]; field: (x:number,z:number)=>number }
const coastAt = (t: number) => (t + .5) / COAST_TEXELS_PER_TILE - .5;
export function startCoastData(field: (x:number,z:number)=>number = terrainField, size = GRID_SIZE): CoastBuild {
  const n = size * COAST_TEXELS_PER_TILE, G = COAST_CELL, cells = Math.ceil(n / G), data = new Uint8Array(n * n), pending: number[] = [];
  const coarse = new Float32Array((cells + 1) * (cells + 1));
  for (let j = 0; j <= cells; j++) for (let i = 0; i <= cells; i++) coarse[j * (cells + 1) + i] = field(coastAt(i * G), coastAt(j * G));
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const a = coarse[j * (cells + 1) + i], b = coarse[j * (cells + 1) + i + 1], c = coarse[(j + 1) * (cells + 1) + i], d = coarse[(j + 1) * (cells + 1) + i + 1];
    const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
    if (Math.min(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d)) < 3.5 || (lo < 0 && hi >= 0) || (hi - lo > 7 && hi > -26 && lo < 10)) pending.push(j * cells + i);
    for (let z = j * G; z < Math.min(n, j * G + G); z++) for (let x = i * G; x < Math.min(n, i * G + G); x++) {
      const tx = (x - i * G) / G, tz = (z - j * G) / G;
      data[z * n + x] = encodeCoast((a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz);
    }
  }
  return { data, n, samples: coarse.length, pending, field };
}
/** Refine pending shore cells (nearest `focus` texel first when given) until `budgetMs` runs out. Returns cells refined. */
export function refineCoastData(build: CoastBuild, budgetMs = Infinity): number {
  const { data, n, pending, field } = build, G = COAST_CELL, cells = Math.ceil(n / G), start = performance.now();
  let done = 0;
  while (pending.length && (done === 0 || performance.now() - start < budgetMs)) {
    for (let batch = 0; batch < 8 && pending.length; batch++, done++) {
      const k = pending.pop()!, i = k % cells, j = (k - i) / cells;
      for (let z = j * G; z < Math.min(n, j * G + G); z++) for (let x = i * G; x < Math.min(n, i * G + G); x++) { data[z * n + x] = encodeCoast(field(coastAt(x), coastAt(z))); build.samples++; }
    }
  }
  return done;
}
/** The whole texture's data at once (tests and tools). */
export function buildCoastData(field: (x:number,z:number)=>number = terrainField, size = GRID_SIZE): CoastBuild {
  const build = startCoastData(field, size);
  refineCoastData(build);
  return build;
}
let coast: { texture: DataTexture; build: CoastBuild } | undefined;
export function getCoastTexture(): DataTexture {
  if (!coast) {
    const build = startCoastData();
    // Refine around the island first: pending is consumed from the end.
    const cells = Math.ceil(build.n / COAST_CELL);
    build.pending.sort((p, q) => { const d = (k: number) => Math.hypot(k % cells, Math.floor(k / cells)); return d(q) - d(p); });
    const texture = new DataTexture(build.data, build.n, build.n, RedFormat);
    texture.minFilter = LinearFilter; texture.magFilter = LinearFilter; texture.needsUpdate = true;
    coast = { texture, build };
  }
  return coast.texture;
}
/** Spend up to `budgetMs` refining the shore; re-uploads the texture when anything changed. */
export function refineCoastTexture(budgetMs = 3): boolean {
  if (!coast || !coast.build.pending.length) return false;
  if (refineCoastData(coast.build, budgetMs)) coast.texture.needsUpdate = true;
  return true;
}
