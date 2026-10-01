import { BufferGeometry, Color, Float32BufferAttribute, MeshStandardMaterial, Quaternion, Vector3 } from 'three';

/**
 * Tiny flat-shaded, vertex-coloured mesh builder shared by the M2 Coast art
 * (DriftwoodPile, TideRock, clubProp). Everything is baked into one
 * non-indexed BufferGeometry per variant, so a node is one draw call and the
 * geometry can back an InstancedMesh unchanged.
 */

/** sRGB hex -> linear vertex colour, independent of ColorManagement.legacyMode. */
export const linear = (hex: number) =>
  new Color().setRGB(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255).convertSRGBToLinear();

/** Deterministic pseudo-random in [0,1) so the shapes never change between loads. */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export class LowPolyBuilder {
  positions: number[] = [];
  colors: number[] = [];

  triangle(a: Vector3, b: Vector3, c: Vector3, color: Color) {
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) this.colors.push(color.r, color.g, color.b);
  }

  /**
   * A crooked tapering log/branch from `from` to `to` with `sides` sides and
   * capped ends. `wobble` offsets each interior ring sideways. Tris: 2*sides*(rings-1) + 2*sides.
   */
  log(from: Vector3, to: Vector3, r0: number, r1: number, opts: { sides?: number; rings?: number; wobble?: number; seed?: number; bark: Color[]; cap: Color; capStart?: boolean; capEnd?: boolean }) {
    const sides = opts.sides ?? 6, rings = opts.rings ?? 3, rand = seeded(opts.seed ?? 1);
    const axis = to.clone().sub(from);
    const turn = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis.clone().normalize());
    const ring: Vector3[][] = [];
    for (let j = 0; j < rings; j++) {
      const t = j / (rings - 1);
      const r = r0 + (r1 - r0) * t;
      const w = j > 0 && j < rings - 1 ? (opts.wobble ?? 0) : 0;
      const off = new Vector3((rand() - 0.5) * 2 * w, 0, (rand() - 0.5) * 2 * w);
      ring.push(Array.from({ length: sides }, (_, i) => {
        const angle = (2 * Math.PI * i) / sides + j * 0.3;
        return new Vector3(off.x + r * Math.cos(angle), axis.length() * t, off.z + r * Math.sin(angle)).applyQuaternion(turn).add(from);
      }));
    }
    for (let j = 0; j < rings - 1; j++) for (let i = 0; i < sides; i++) {
      const a = ring[j][i], b = ring[j][(i + 1) % sides], c = ring[j + 1][(i + 1) % sides], d = ring[j + 1][i];
      const shade = opts.bark[(i + j) % opts.bark.length];
      this.triangle(a, c, b, shade);
      this.triangle(a, d, c, shade);
    }
    if (opts.capStart !== false) for (let i = 0; i < sides; i++) this.triangle(from, ring[0][i], ring[0][(i + 1) % sides], opts.cap);
    const end = ring[rings - 1];
    const endCentre = end.reduce((s, v) => s.add(v), new Vector3()).multiplyScalar(1 / sides);
    if (opts.capEnd !== false) for (let i = 0; i < sides; i++) this.triangle(endCentre, end[(i + 1) % sides], end[i], opts.cap);
  }

  /**
   * A lumpy rock: a UV-sphere-ish hull (`segments` around, 2 bands + poles)
   * with jittered radii, flattened by `scale`. Tris: 4*segments.
   */
  rock(centre: Vector3, radius: number, scale: Vector3, opts: { segments?: number; jitter?: number; seed?: number; colors: Color[]; top?: Color }) {
    const n = opts.segments ?? 6, rand = seeded(opts.seed ?? 7), jitter = opts.jitter ?? 0.2;
    const point = (theta: number, phi: number) => {
      const r = radius * (1 - jitter / 2 + rand() * jitter);
      return new Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)).multiplyScalar(r).multiply(scale).add(centre);
    };
    const top = point(0, 0), bottom = point(0, Math.PI);
    const upper = Array.from({ length: n }, (_, i) => point((2 * Math.PI * i) / n, 1.0));
    const lower = Array.from({ length: n }, (_, i) => point((2 * Math.PI * (i + 0.5)) / n, 2.1));
    const pick = (i: number) => opts.colors[i % opts.colors.length];
    for (let i = 0; i < n; i++) {
      const i1 = (i + 1) % n;
      this.triangle(top, upper[i1], upper[i], opts.top ?? pick(i));
      this.triangle(upper[i], upper[i1], lower[i], pick(i + 1));
      this.triangle(upper[i1], lower[i1], lower[i], pick(i + 2));
      this.triangle(bottom, lower[i], lower[i1], pick(i));
    }
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

let shared: MeshStandardMaterial | null = null;
/** One vertex-colour material for every Coast node and prop. Never dispose per instance. */
export function coastMaterial(): MeshStandardMaterial {
  return shared ??= new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 });
}

/** Triangle count of a non-indexed geometry (for tests and budgets). */
export const triangleCount = (g: BufferGeometry) => g.getAttribute('position').count / 3;
