import { Color, Vector3 } from 'three';
import { LowPolyBuilder } from '../Components/3D/nodes/lowPoly';

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** Extra styles share the scalp in details.ts and follow the animated head. */
export function buildExtendedHair(head: LowPolyBuilder, style: number, hair: Color, accent: Color) {
  const shade = hair.clone().multiplyScalar(.88);
  const curl = (p: Vector3, scale: Vector3, color = hair) => {
    const point = (i: number, band: number) => {
      const angle = i * Math.PI / 4, phi = band * Math.PI / 4;
      return v(Math.sin(phi) * Math.cos(angle), Math.cos(phi), Math.sin(phi) * Math.sin(angle)).multiply(scale).add(p);
    };
    const shadow = color.clone().multiplyScalar(.92);
    for (let band = 0; band < 4; band++) for (let i = 0; i < 8; i++) {
      const a = point(i, band), b = point(i + 1, band), c = point(i + 1, band + 1), d = point(i, band + 1);
      if (band > 0) head.triangle(a, b, c, i % 3 === 0 ? shadow : color);
      if (band < 3) head.triangle(a, c, d, color);
    }
  };
  // Continuous rings keep flowing locks smooth at bends, with closed ends.
  const lock = (path: Vector3[], radius: number, tip = .5, color = hair) => {
    const sides = 8;
    const rings = path.map((p, j) => {
      const tangent = path[Math.min(j + 1, path.length - 1)].clone().sub(path[Math.max(0, j - 1)]).normalize();
      const reference = Math.abs(tangent.z) < .9 ? v(0, 0, 1) : v(1, 0, 0);
      const across = tangent.clone().cross(reference).normalize();
      const depth = tangent.clone().cross(across).normalize();
      const r = radius * (1 - (1 - tip) * j / (path.length - 1));
      return Array.from({ length: sides }, (_, i) => p.clone()
        .addScaledVector(across, Math.cos(i * Math.PI * 2 / sides) * r)
        .addScaledVector(depth, Math.sin(i * Math.PI * 2 / sides) * r));
    });
    for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < sides; i++) {
      const next = (i + 1) % sides, c = color === hair && i % 3 === 0 ? shade : color;
      head.triangle(rings[j][i], rings[j][next], rings[j + 1][i], c);
      head.triangle(rings[j][next], rings[j + 1][next], rings[j + 1][i], c);
    }
    for (let i = 0; i < sides; i++) {
      const next = (i + 1) % sides, last = rings.length - 1;
      head.triangle(path[0], rings[0][next], rings[0][i], color);
      head.triangle(path[last], rings[last][i], rings[last][next], color);
    }
  };

  if (style === 9 || style === 10 || style === 18) {
    const locs = style === 18, waves = style === 10, count = locs ? 13 : 15;
    for (let i = 0; i < count; i++) {
      // An open front frames the cheeks; length falls behind the shoulders.
      const angle = .98 + i * (Math.PI * 2 - 1.96) / (count - 1);
      const path = Array.from({ length: 6 }, (_, j) => {
        const wave = waves ? Math.sin(j * 1.8 + i * .25) * .055 : locs ? Math.sin(j * 2 + i) * .01 : 0;
        const spread = j === 0 ? .19 : .27 + wave + j * .01;
        return v(Math.sin(angle) * spread, j === 0 ? .40 : .33 - j * .132,
          Math.cos(angle) * (j === 0 ? .16 : .23 + wave) - j * .024);
      });
      lock(path, locs ? .036 : .073, locs ? .82 : .6);
    }
    if (!locs) for (const side of [-1, 1]) lock(waves ? [
      v(side * .025, .475, .095), v(side * .18, .435, .18),
      v(side * .285, .29, .19), v(side * .26, .14, .19), v(side * .32, -.035, .11),
    ] : [
      v(side * .025, .475, .095), v(side * .15, .435, .19),
      v(side * .24, .27, .19), v(side * .285, .04, .10),
    ], .05, .6);
  }

  if (style === 11 || style === 12) {
    const natural = style === 12;
    // Staggered curl clusters produce a full silhouette without covering eyes.
    for (let row = 0; row < 4; row++) {
      const count = row === 0 ? 7 : 10;
      for (let i = 0; i < count; i++) {
        const angle = row === 0 ? i * Math.PI * 2 / count : .9 + i * (Math.PI * 2 - 1.8) / (count - 1) + (row % 2 ? .09 : -.09);
        const radius = row === 0 ? .16 : natural ? .285 : .265;
        curl(v(Math.sin(angle) * radius, (natural ? .49 : .425) - row * .12 + Math.sin(angle * 3 + row) * .018,
          Math.cos(angle) * radius * .86 - .015), v(natural ? .125 : .10, .115, .11));
      }
    }
    if (natural) curl(v(0, .53, -.01), v(.15, .13, .14));
  }

  if (style === 13) {
    curl(v(0, .43, -.20), v(.105, .048, .08), accent);
    for (let i = -1; i <= 1; i++) lock([
      v(i * .045, .46, -.21), v(i * .07, .36, -.34),
      v(i * .07, .12, -.39), v(i * .055, -.10, -.40), v(i * .07 + .055, -.29, -.34),
    ], .065, .45);
  }

  if (style === 14 || style === 15) for (const side of [-1, 1]) {
    if (style === 15) {
      curl(v(side * .25, .43, -.09), v(.09, .07, .085), accent);
      curl(v(side * .285, .47, -.09), v(.15, .15, .14));
      for (let i = 0; i < 5; i++) {
        const angle = i * Math.PI * 2 / 5;
        curl(v(side * .285 + Math.sin(angle) * .085, .47 + Math.cos(angle) * .09, -.005), v(.062, .063, .068));
      }
    } else {
      curl(v(side * .255, .30, -.08), v(.052, .065, .063), accent);
      for (let i = -1; i <= 1; i++) lock([
        v(side * .26, .32, -.08 + i * .04), v(side * .36, .17, -.12 + i * .04),
        v(side * .37, -.02, -.13 + i * .04), v(side * .32, -.23, -.08 + i * .035),
      ], .056, .5);
    }
  }

  if (style === 16) {
    lock([v(-.18, .40, -.08), v(-.12, .22, -.23), v(.15, .08, -.20), v(.26, -.01, .02)], .083, .8);
    for (let j = 0; j < 9; j++) curl(v(.27 + (j % 2 ? .02 : -.008), .13 - j * .06, .10), v(.068, .052, .066));
    curl(v(.281, -.385, .10), v(.053, .022, .054), accent);
    lock([v(.281, -.39, .10), v(.27, -.46, .10)], .04, .25);
  }

  if (style === 17) {
    for (let i = 0; i < 22; i++) {
      const angle = i * Math.PI * 2 / 22;
      curl(v(Math.sin(angle) * .26, .355 + (i % 2) * .018, Math.cos(angle) * .235), v(.058, .051, .052));
    }
    curl(v(0, .12, -.255), v(.14, .115, .08));
    for (const side of [-1, 1]) lock([v(side * .255, .30, .03), v(side * .28, .11, .035), v(side * .255, -.005, .07)], .023, .45);
  }
}
