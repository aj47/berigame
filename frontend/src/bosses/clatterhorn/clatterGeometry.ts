import { BufferGeometry, Color, MeshPhysicalMaterial, MeshStandardMaterial, Vector3 } from 'three';
import { LowPolyBuilder, linear, triangleCount } from '../../Components/3D/nodes/lowPoly';

/*
 * Clatterhorn, a huge stag beetle over a 3 x 3 footprint (about 1.7 units to
 * the horn tip). Procedural flat-shaded vertex-colour parts from the shared
 * LowPolyBuilder; the model faces +z. Animation is transforms only: the body,
 * the two wing cases on hinge pivots and six legs on hip pivots. Geometries
 * are built once per page and shared; the materials belong to this module.
 */

const TEAL = linear(0x2e7d6f), TEAL_DARK = linear(0x235f55), BLUE = linear(0x3b5ba9), BLUE_DARK = linear(0x2c4580);
const PURPLE = linear(0x7e4fa8), PURPLE_DARK = linear(0x5e3a80), CHITIN = linear(0x1f2a33), CHITIN_LIGHT = linear(0x34424d);
const HORN = linear(0x3a3140), HORN_TIP = linear(0xcdb98a), BELLY = linear(0xc9a34a), BELLY_DARK = linear(0x9c7a32);
const EARTH = linear(0x6b5a48), EARTH_DARK = linear(0x4f4234), MOSS = linear(0x6f8f3e);

/** Hip pivots (x, y, z) of the left legs, front to back; right legs mirror x. */
export const CLATTER_HIPS: readonly (readonly [number, number, number])[] = [[0.62, 0.62, 0.72], [0.74, 0.6, 0.05], [0.66, 0.6, -0.62]];
/** Wing-case hinge pivots (left, right). */
export const CLATTER_WING_HINGE: readonly (readonly [number, number, number])[] = [[0.06, 1.3, 0.25], [-0.06, 1.3, 0.25]];

/** Carapace (3 segments), head, forked horn, mandibles, antennae and the pronotum's spikes. */
function buildBody(): BufferGeometry {
  const b = new LowPolyBuilder();
  // Abdomen (rear, purple), pronotum (blue) and head (teal): the iridescent gradient runs nose to tail.
  b.rock(new Vector3(0, 0.82, -0.5), 1, new Vector3(1.02, 0.6, 1.12), { segments: 16, seed: 41, jitter: 0.08, colors: [PURPLE, BLUE, PURPLE_DARK], top: PURPLE });
  b.rock(new Vector3(0, 0.86, 0.68), 0.72, new Vector3(1.12, 0.72, 0.78), { segments: 14, seed: 42, jitter: 0.08, colors: [BLUE, TEAL, BLUE_DARK], top: BLUE });
  b.rock(new Vector3(0, 0.72, 1.22), 0.46, new Vector3(1.05, 0.78, 0.95), { segments: 10, seed: 43, jitter: 0.1, colors: [TEAL, TEAL_DARK], top: TEAL });
  // Spikes along the pronotum ridge.
  for (const [x, z, s] of [[0, 0.95, 44], [-0.32, 0.7, 45], [0.32, 0.7, 46]] as const) {
    b.rock(new Vector3(x, 1.32, z), 0.13, new Vector3(0.8, 1.6, 0.8), { segments: 5, seed: s, colors: [TEAL_DARK, BLUE_DARK], top: CHITIN_LIGHT });
  }
  // The forked horn: a curved shaft and two tines.
  const bark = [HORN, CHITIN], cap = HORN_TIP;
  b.log(new Vector3(0, 0.95, 1.38), new Vector3(0, 1.42, 1.78), 0.2, 0.14, { sides: 6, rings: 3, seed: 47, bark, cap });
  b.log(new Vector3(0, 1.42, 1.78), new Vector3(-0.26, 1.78, 2.08), 0.13, 0.04, { sides: 6, rings: 3, seed: 48, bark, cap });
  b.log(new Vector3(0, 1.42, 1.78), new Vector3(0.26, 1.74, 2.12), 0.13, 0.04, { sides: 6, rings: 3, seed: 49, bark, cap });
  // Mandibles: two hooked jaws.
  for (const s of [-1, 1]) {
    b.log(new Vector3(0.24 * s, 0.56, 1.52), new Vector3(0.36 * s, 0.5, 1.86), 0.09, 0.07, { sides: 6, rings: 3, seed: 50 + s, bark, cap: CHITIN });
    b.log(new Vector3(0.36 * s, 0.5, 1.86), new Vector3(0.12 * s, 0.46, 2.04), 0.07, 0.02, { sides: 6, rings: 2, seed: 52 + s, bark, cap });
    // Antennae.
    b.log(new Vector3(0.3 * s, 0.86, 1.4), new Vector3(0.62 * s, 1.08, 1.7), 0.03, 0.02, { sides: 4, rings: 2, seed: 54 + s, bark: [CHITIN], cap: CHITIN_LIGHT });
  }
  return b.build();
}

/** The underside plate that glows gold while the beetle lies on its back. */
function buildBelly(): BufferGeometry {
  const b = new LowPolyBuilder();
  b.rock(new Vector3(0, 0.46, -0.18), 0.96, new Vector3(0.86, 0.34, 1.55), { segments: 12, seed: 61, jitter: 0.06, colors: [BELLY, BELLY_DARK], top: BELLY_DARK });
  return b.build();
}

/** One wing case from its hinge (origin), lying over the abdomen; `side` 1 = left (+x). */
function buildWing(side: number): BufferGeometry {
  const b = new LowPolyBuilder();
  b.rock(new Vector3(0.47 * side, -0.06, -0.74), 0.62, new Vector3(0.84, 0.36, 1.78), { segments: 14, seed: 70 + side, jitter: 0.06, colors: [PURPLE, BLUE, PURPLE_DARK], top: BLUE });
  return b.build();
}

/** One leg from its hip (origin): femur up and out, tibia down to the ground (y ~ -0.6). */
function buildLeg(side: number): BufferGeometry {
  const b = new LowPolyBuilder();
  const knee = new Vector3(0.55 * side, 0.26, 0), foot = new Vector3(1.0 * side, -0.6, 0.04);
  b.log(new Vector3(0, 0, 0), knee, 0.1, 0.08, { sides: 6, rings: 3, seed: 80 + side, bark: [CHITIN, CHITIN_LIGHT], cap: CHITIN });
  b.log(knee, foot, 0.07, 0.03, { sides: 6, rings: 3, seed: 82 + side, bark: [CHITIN, CHITIN_LIGHT], cap: CHITIN_LIGHT });
  return b.build();
}

/** The mound it digs into while burrowed. */
function buildMound(): BufferGeometry {
  const b = new LowPolyBuilder();
  b.rock(new Vector3(0, 0.05, 0), 1.35, new Vector3(1.25, 0.42, 1.2), { segments: 12, seed: 90, jitter: 0.18, colors: [EARTH, EARTH_DARK], top: EARTH });
  b.rock(new Vector3(0.9, 0.1, 0.7), 0.35, new Vector3(1, 0.7, 1), { segments: 6, seed: 91, colors: [EARTH_DARK], top: MOSS });
  b.rock(new Vector3(-0.8, 0.08, -0.6), 0.3, new Vector3(1, 0.6, 1), { segments: 6, seed: 92, colors: [EARTH_DARK, EARTH] });
  // A horn tip poking out of the soil.
  b.log(new Vector3(0.1, 0.4, 0.3), new Vector3(0.25, 0.85, 0.55), 0.09, 0.03, { sides: 5, rings: 2, seed: 93, bark: [HORN], cap: HORN_TIP });
  return b.build();
}

export interface ClatterParts {
  body: BufferGeometry; belly: BufferGeometry; wingL: BufferGeometry; wingR: BufferGeometry;
  legL: BufferGeometry; legR: BufferGeometry; mound: BufferGeometry;
}
let parts: ClatterParts | null = null;
export const clatterParts = (): ClatterParts => parts ??= {
  body: buildBody(), belly: buildBelly(), wingL: buildWing(1), wingR: buildWing(-1),
  legL: buildLeg(1), legR: buildLeg(-1), mound: buildMound(),
};

/** Triangles of the standing beetle (body, belly, both wing cases and six legs). */
export function clatterTriangles(): number {
  const p = clatterParts();
  return triangleCount(p.body) + triangleCount(p.belly) + triangleCount(p.wingL) + triangleCount(p.wingR) + 3 * (triangleCount(p.legL) + triangleCount(p.legR));
}

let mats: { shell: MeshPhysicalMaterial; belly: MeshStandardMaterial; legs: MeshStandardMaterial; eye: MeshStandardMaterial } | null = null;
/** The beetle's own materials: an iridescent shell, the gold belly (emissive while flipped), chitin legs, amber eyes. */
export const clatterMaterials = () => mats ??= {
  // Thin-film iridescence (three r141+; the installed typings predate the parameter names).
  shell: Object.assign(new MeshPhysicalMaterial({
    vertexColors: true, flatShading: true, roughness: 0.32, metalness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.25,
  }), { iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 720] }),
  belly: new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0.1, emissive: new Color('#FFD36E'), emissiveIntensity: 0 }),
  legs: new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.1 }),
  eye: new MeshStandardMaterial({ color: '#ffb347', emissive: new Color('#ff8a1f'), emissiveIntensity: 0.6 }),
};
