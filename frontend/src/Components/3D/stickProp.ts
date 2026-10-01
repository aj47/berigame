import { BufferGeometry, Color, Float32BufferAttribute, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { STICK_LENGTH, STICK_RADIUS, STICK_TIP_RADIUS } from '../../animation/stickSwing';

/**
 * The wielded stick: a crooked, tapering six-sided branch with a cut butt, a
 * twig and one leaf, echoing /items/stick.png. Modelled along +Y from the butt
 * (y=0) to the tip (y=STICK_LENGTH), as stickMount() in stickSwing.ts expects.
 * Flat shaded with vertex colours: one geometry and one material shared by
 * every avatar, never disposed per avatar (render with dispose={null}).
 */
const BARK = 0x8a5a33, BARK_DARK = 0x6e4424, CUT = 0xd9b27c, LEAF = 0x6aa84f;

/** sRGB hex -> linear vertex colour, independent of ColorManagement.legacyMode. */
const linear = (hex: number) => new Color().setRGB(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255).convertSRGBToLinear();

function buildGeometry(): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const triangle = (a: Vector3, b: Vector3, c: Vector3, color: Color) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
  };
  const sides = 6;
  // [height, sideways crook x, crook z]; the radius tapers linearly from butt to tip.
  const rings: [number, number, number][] = [
    [0, 0, 0],
    [0.2, 0.006, 0.002],
    [0.4, -0.003, -0.004],
    [0.56, 0.004, 0.003],
    [STICK_LENGTH - 0.02, 0.01, 0],
  ];
  const radius = (y: number) => STICK_RADIUS + (STICK_TIP_RADIUS - STICK_RADIUS) * (y / (STICK_LENGTH - 0.02));
  const ring = rings.map(([y, cx, cz], j) => Array.from({ length: sides }, (_, i) => {
    const r = radius(y);
    const angle = (2 * Math.PI * i) / sides + j * 0.35;
    return new Vector3(cx + r * Math.cos(angle), y, cz + r * Math.sin(angle));
  }));
  const bark = linear(BARK), barkDark = linear(BARK_DARK), cut = linear(CUT), leaf = linear(LEAF);
  for (let j = 0; j < ring.length - 1; j++) {
    for (let i = 0; i < sides; i++) {
      const a = ring[j][i], b = ring[j][(i + 1) % sides], c = ring[j + 1][(i + 1) % sides], d = ring[j + 1][i];
      const shade = (i + j) % 3 === 0 ? barkDark : bark;
      triangle(a, c, b, shade);
      triangle(a, d, c, shade);
    }
  }
  // Cut butt end, lighter wood.
  const buttCentre = new Vector3(0, 0, 0);
  for (let i = 0; i < sides; i++) triangle(buttCentre, ring[0][i], ring[0][(i + 1) % sides], cut);
  // Blunt tip.
  const [tipY, tipX, tipZ] = rings[rings.length - 1];
  const tip = new Vector3(tipX + 0.004, tipY + 0.024, tipZ);
  const top = ring[ring.length - 1];
  for (let i = 0; i < sides; i++) triangle(tip, top[(i + 1) % sides], top[i], barkDark);

  // A short twig with one leaf, two thirds of the way up.
  const base = new Vector3(0.018, 0.46, 0.002);
  const direction = new Vector3(0.62, 0.78, 0.1).normalize();
  const twigEnd = base.clone().addScaledVector(direction, 0.1);
  const turn = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction);
  const twigRing = Array.from({ length: 4 }, (_, i) => new Vector3(0.008 * Math.cos((Math.PI / 2) * i), 0, 0.008 * Math.sin((Math.PI / 2) * i)).applyQuaternion(turn).add(base));
  for (let i = 0; i < 4; i++) triangle(twigEnd, twigRing[(i + 1) % 4], twigRing[i], bark);
  // Leaf: a thin closed diamond, so it shows from either side with front-face culling.
  const leafDirection = new Vector3(0.35, 0.93, -0.1).normalize();
  const leafTip = twigEnd.clone().addScaledVector(leafDirection, 0.09);
  const middle = twigEnd.clone().addScaledVector(leafDirection, 0.04);
  const side = new Vector3().crossVectors(leafDirection, new Vector3(0, 0, 1)).normalize().multiplyScalar(0.022);
  const thickness = new Vector3().crossVectors(leafDirection, side).normalize().multiplyScalar(0.004);
  const left = middle.clone().add(side), right = middle.clone().sub(side);
  const front = middle.clone().add(thickness), back = middle.clone().sub(thickness);
  for (const [a, b] of [[left, front], [front, right], [right, back], [back, left]] as const) {
    triangle(twigEnd, b, a, leaf);
    triangle(leafTip, a, b, leaf);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

let geometry: BufferGeometry | null = null;
let material: MeshStandardMaterial | null = null;
/** Shared by every held stick; created on first use. */
export function stickGeometry(): BufferGeometry {
  return geometry ??= buildGeometry();
}
export function stickMaterial(): MeshStandardMaterial {
  return material ??= new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0 });
}
