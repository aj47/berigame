import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import {
  AdditiveBlending, AnimationMixer, BoxGeometry, BufferGeometry, CircleGeometry, Color, ConeGeometry,
  CylinderGeometry, DataTexture, Float32BufferAttribute, Group, IcosahedronGeometry,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, Points, PointsMaterial, RGBAFormat, Sprite, SpriteMaterial,
} from 'three';
import { mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils';

type Point = [number, number, number];
type Lighting = 'day' | 'dusk';
type IslandSceneProps = { paused?: boolean; lighting?: Lighting; onReady?: () => void; onUnavailable?: () => void };

const colors = {
  grass: '#66874d', moss: '#285b46', leaf: '#447749', lime: '#8ca650',
  bark: '#89623d', wood: '#b78552', paleWood: '#d2ae71', sand: '#e8d49b',
  rock: '#697c71', water: '#368f8b', pink: '#e77e9e', gold: '#f4c874',
};

/** Bake the little world into one colored mesh, keeping the hero inexpensive. */
function islandGeometry() {
  const parts: BufferGeometry[] = [];
  function part(geometry: BufferGeometry, color: string, position: Point, scale: Point = [1, 1, 1], rotation: Point = [0, 0, 0], variance = .055) {
    const baked = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    baked.deleteAttribute('uv');
    baked.scale(...scale);
    baked.rotateX(rotation[0]); baked.rotateY(rotation[1]); baked.rotateZ(rotation[2]);
    baked.translate(...position);
    const base = new Color(color), tint = new Color(), vertexColors: number[] = [];
    for (let i = 0; i < baked.attributes.position.count; i++) {
      const variation = 1 + Math.sin(Math.floor(i / 3) * 19.13 + position[0] * 31) * variance;
      tint.copy(base).multiplyScalar(variation);
      vertexColors.push(tint.r, tint.g, tint.b);
    }
    baked.setAttribute('color', new Float32BufferAttribute(vertexColors, 3));
    parts.push(baked);
  }
  const box = (color: string, position: Point, scale: Point, rotation: Point = [0, 0, 0]) => part(new BoxGeometry(1, 1, 1), color, position, scale, rotation);
  const stone = (color: string, position: Point, scale: Point) => part(new IcosahedronGeometry(1, 0), color, position, scale, [0, position[0], .2]);

  // An irregular, layered island: the silhouette is handmade, not a perfect disc.
  const ringCount = 32;
  const rings = [
    { y: -.05, radius: 1, color: '#b8a57e' },
    { y: -.45, radius: .97, color: '#887e66' },
    { y: -1.12, radius: .76, color: '#575f59' },
    { y: -1.7, radius: .44, color: '#3d514b' },
    { y: -1.98, radius: .12, color: '#29433e' },
  ];
  const edge = (i: number, radius: number, y: number): Point => {
    const angle = i / ringCount * Math.PI * 2;
    const jagged = 1 + Math.sin(angle * 5 + .7) * .036 + Math.cos(angle * 9) * .019;
    return [Math.cos(angle) * 4.05 * radius * jagged, y, Math.sin(angle) * 3.03 * radius * jagged];
  };
  rings.slice(0, -1).forEach((ring, level) => {
    const next = rings[level + 1], positions: number[] = [];
    for (let i = 0; i < ringCount; i++) {
      const a = edge(i, ring.radius, ring.y), b = edge(i + 1, ring.radius, ring.y);
      const c = edge(i, next.radius, next.y), d = edge(i + 1, next.radius, next.y);
      positions.push(...a, ...b, ...c, ...b, ...d, ...c);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    part(geometry, ring.color, [0, 0, 0], [1, 1, 1], [0, 0, 0], .10);
  });
  part(new CylinderGeometry(1, 1, .15, 32), colors.sand, [0, .01, 0], [4.06, 1, 3.05]);
  part(new CylinderGeometry(1, 1.015, .13, 28), colors.grass, [-.17, .14, -.16], [3.83, 1, 2.79]);

  // A sandy pool with a wooden footbridge, a winding path, and little stepping stones.
  part(new CylinderGeometry(1, 1, .045, 28), colors.sand, [1.30, .231, 1.30], [2.04, 1, 1.21]);
  part(new CylinderGeometry(1, 1, .04, 32), colors.water, [1.34, .261, 1.31], [1.79, 1, .98], [0, .08, 0], .022);
  // Water lilies and shoreline reeds give the pond a sense of scale.
  [[2.43, 1.37, .13], [1.84, 1.98, .10], [2.25, .93, .085]].forEach(([x, z, radius], i) => {
    part(new CylinderGeometry(radius, radius, .012, 12, 1, false, .17, 5.75), '#528d69', [x, .304, z], [1, 1, .8], [0, i * 2, 0]);
    if (i === 0) {
      part(new IcosahedronGeometry(.052, 0), '#f6c2c4', [x, .344, z], [1, .7, 1]);
      part(new IcosahedronGeometry(.026, 0), colors.gold, [x, .377, z]);
    }
  });
  [[2.64, 1.9], [2.83, .83], [.65, 2.35]].forEach(([x, z], i) => {
    for (let j = 0; j < 4; j++) {
      const height = .25 + j * .064;
      part(new CylinderGeometry(.013, .017, height, 4), '#657d40', [x + j * .054, .26 + height / 2, z + Math.sin(j) * .07], [1, 1, 1], [0, i, .06 * (j - 1)]);
      if (j % 2 === 0) part(new CylinderGeometry(.026, .025, .10, 5), '#815741', [x + j * .054, .28 + height, z + Math.sin(j) * .07]);
    }
  });
  [0, 1, 2, 3, 4].forEach(i => {
    part(new CylinderGeometry(1, 1, .032, 10), '#d8c38a', [-.20 - Math.sin(i * .65) * .24, .239, .6 - i * .38], [.34 + i * .025, 1, .26], [0, i * .8, 0]);
  });
  const bridgeX = .75, bridgeZ = 1.43;
  Array.from({ length: 11 }, (_, i) => {
    const x = bridgeX + (i - 5) * .235, arch = .13 * Math.sin(i / 10 * Math.PI);
    box(i % 3 === 0 ? colors.wood : colors.paleWood, [x, .40 + arch, bridgeZ], [.22, .10, .73], [0, 0, Math.cos(i / 10 * Math.PI) * .08]);
  });
  [-.43, .43].forEach(z => {
    box(colors.bark, [bridgeX, .34, bridgeZ + z], [2.75, .10, .095]);
    box(colors.paleWood, [bridgeX, .96, bridgeZ + z], [2.72, .08, .085]);
    [-1.25, 0, 1.25].forEach(x => {
      box(colors.bark, [bridgeX + x, .57, bridgeZ + z], [.11, 1.0, .11]);
      part(new ConeGeometry(.10, .11, 4), colors.paleWood, [bridgeX + x, 1.105, bridgeZ + z], [1, 1, 1], [0, Math.PI / 4, 0]);
    });
  });

  // Round, faceted crowns, visible trunks, and a handful of ripe berries.
  function tree(x: number, z: number, scale: number, berryColor = colors.pink) {
    const baseY = .21;
    part(new CylinderGeometry(.08, .18, 1.58, 6), colors.bark, [x, baseY + scale * .75, z], [scale, scale, scale], [0, .15, -.045]);
    part(new CylinderGeometry(.045, .065, .82, 5), colors.bark, [x + .23 * scale, baseY + 1.18 * scale, z], [scale, scale, scale], [0, 0, -.75]);
    const crowns: Array<[number, number, number, number, string]> = [
      [0, 1.94, 0, .91, colors.leaf], [-.50, 1.62, .20, .67, colors.moss],
      [.53, 1.72, .13, .71, '#709d4e'], [.11, 2.37, -.10, .59, colors.lime],
    ];
    crowns.forEach(([dx, dy, dz, size, color]) => {
      part(new IcosahedronGeometry(1, 1), color, [x + dx * scale, baseY + dy * scale, z + dz * scale], [size * scale, size * scale * .87, size * scale], [0, x + dx, 0], .045);
    });
    [[-.37, 1.62, .74], [.38, 1.87, .66], [.05, 2.25, .60], [.78, 1.60, .28], [-.69, 1.73, .32]].forEach(([dx, dy, dz], i) => {
      part(new IcosahedronGeometry(.125, 1), berryColor, [x + dx * scale, baseY + dy * scale, z + dz * scale], [scale, scale * 1.05, scale]);
      part(new ConeGeometry(.06, .13, 4), colors.moss, [x + dx * scale, baseY + (dy + .145) * scale, z + dz * scale], [scale, scale, scale], [0, i, .5]);
    });
  }
  tree(-2.29, -.12, 1.06);
  tree(-1.46, -1.69, 1.14, colors.gold);
  tree(1.66, -1.62, 1.03);
  tree(2.77, -.39, .75, colors.gold);
  tree(-2.62, 1.39, .62, colors.gold);

  // A tiny cottage: stone plinth, honey-colored plaster and an oversized teal roof.
  box('#b4a480', [.18, .37, -1.11], [1.76, .31, 1.45]);
  box('#efd7a1', [.18, 1.03, -1.11], [1.55, 1.16, 1.29]);
  [-.52, .88].forEach(x => box(colors.bark, [x, .99, -.44], [.095, 1.21, .095]));
  box(colors.bark, [.18, 1.47, -.435], [1.6, .13, .1]);
  box('#664e35', [.40, .77, -.44], [.39, .82, .07]);
  box('#f4c76b', [-.22, 1.06, -.422], [.31, .36, .04]);
  box(colors.bark, [-.22, 1.06, -.39], [.027, .39, .035]);
  box(colors.bark, [-.22, 1.06, -.39], [.34, .03, .035]);
  [-1, 1].forEach(side => {
    box(side < 0 ? '#467464' : '#527e65', [.18 + side * .46, 1.91, -1.11], [1.27, .15, 1.76], [0, 0, side * -.64]);
    for (let i = 0; i < 5; i++) {
      box('#6f9573', [.18 + side * .46, 2.005, -1.77 + i * .33], [1.29, .033, .044], [0, 0, side * -.64]);
    }
  });
  box('#385e50', [.18, 2.32, -1.11], [.15, .15, 1.80]);
  // Timber details read even at the smaller mobile scale.
  box(colors.bark, [.40, .81, -.393], [.025, .69, .027]);
  part(new IcosahedronGeometry(.026, 1), colors.gold, [.52, .78, -.386]);
  [-.42, -.02].forEach(x => box('#4a715b', [x, 1.06, -.39], [.075, .39, .05]));
  box(colors.paleWood, [-.22, .85, -.35], [.50, .06, .17]);
  box('#547a4d', [-.22, .89, -.33], [.40, .035, .1]);
  [-.36, -.21, -.08].forEach((x, i) => part(new IcosahedronGeometry(.052, 0), i % 2 ? colors.gold : colors.pink, [x, .97, -.34]));
  box('#b77f58', [.65, 2.12, -1.48], [.28, .77, .28]);
  box('#d0a57c', [.65, 2.54, -1.48], [.37, .13, .35]);
  box(colors.paleWood, [.35, .28, -.29], [.70, .13, .29]);

  // Edges full of ferns, rocks and wildflowers keep the island alive at close range.
  const stones: Array<[number, number, number]> = [[-3.12, .73, .35], [-2.55, -1.50, .29], [2.71, 1.45, .22], [2.89, .69, .39], [1.28, -2.28, .31], [-.85, 2.29, .22], [-1.8, 1.83, .26]];
  stones.forEach(([x, z, s]) => stone('#b2b19a', [x, .27, z], [s, s * .64, s * .78]));
  for (let i = 0; i < 44; i++) {
    const angle = i * 2.3999, radius = 1.25 + (i % 6) * .36;
    const x = Math.cos(angle) * radius * 1.16, z = Math.sin(angle) * radius * .83;
    if ((x > -.75 && z > .43) || (Math.abs(x) < 1.1 && z < .2)) continue;
    [0, 1, 2].forEach(j => part(new ConeGeometry(.055, .27 + (i % 3) * .045, 3), i % 3 === 0 ? '#c5c968' : '#709342', [x + j * .065, .34, z + (j % 2) * .065], [1, 1, 1], [0, j, (j - 1) * .23]));
    if (i % 2 === 0) {
      part(new IcosahedronGeometry(.078, 0), i % 4 === 0 ? '#f4d481' : '#f3aec0', [x, .53, z]);
    }
  }
  // Three mushrooms and a sign beside the trail.
  [-1.48, -1.28, -1.62].forEach((x, i) => {
    const z = .65 + i * .16, s = 1 - i * .16;
    part(new CylinderGeometry(.04, .055, .20, 6), '#f4e4bd', [x, .31, z], [s, s, s]);
    part(new ConeGeometry(.16, .13, 8), '#d58a70', [x, .44, z], [s, s, s]);
  });
  box(colors.bark, [-.89, .51, .57], [.055, .60, .065]);
  box(colors.paleWood, [-.89, .73, .57], [.43, .18, .08], [0, -.2, .06]);
  box('#795b39', [-.85, .73, .616], [.15, .025, .015], [0, -.2, .06]);
  // Short fence, fallen leaves and trailing ivy break up the silhouette.
  [-1.85, -1.29, -.73].forEach(x => {
    box('#a89267', [x, .46, -2.25], [.075, .48, .075]);
    part(new ConeGeometry(.065, .09, 4), colors.paleWood, [x, .745, -2.25], [1, 1, 1], [0, Math.PI / 4, 0]);
  });
  [.37, .58].forEach(y => box('#c1aa75', [-1.29, y, -2.25], [1.30, .058, .055]));
  for (let i = 0; i < 23; i++) {
    const angle = i * 2.3999, x = Math.cos(angle) * (1.7 + i % 4 * .35), z = Math.sin(angle) * 2.02;
    if (x > -.70 && z > -.1) continue;
    part(new IcosahedronGeometry(.055, 0), i % 3 === 0 ? '#c4ad66' : '#7c9656', [x, .233, z], [1.8, .18, .8], [0, i, 0]);
  }
  [[-3.54, .59], [-3.24, 1.40], [2.99, 1.64]].forEach(([x, z], i) => {
    for (let j = 0; j < 7; j++) {
      const y = .02 - j * .105;
      stone(j % 2 ? '#4c704d' : '#6a874f', [x - Math.sign(x) * j * .035, y, z + Math.sin(j * 1.9) * .07], [.105 - j * .008, .085, .055]);
    }
  });
  // Little mossy outcrops under the main island give the silhouette some depth.
  stone('#7c8860', [-2.88, -.60, 1.88], [.48, .70, .45]);
  stone('#627652', [2.54, -.94, .35], [.38, .56, .36]);
  const merged = mergeBufferGeometries(parts, false)!;
  parts.forEach(geometry => geometry.dispose());
  return merged;
}

function LocalCharacter({ asset, position, scale, rotation, paused }: {
  asset: 'gardener' | 'pip'; position: Point; scale: number; rotation: number; paused: boolean;
}) {
  const { scene, animations } = useGLTF(`/models/adventure/${asset}.glb`);
  const model = useMemo(() => {
    const result = clone(scene);
    result.traverse(object => {
      if (object instanceof Mesh) { object.castShadow = true; object.receiveShadow = true; }
    });
    return result;
  }, [scene]);
  const mixer = useMemo(() => new AnimationMixer(model), [model]);
  useEffect(() => {
    const clip = animations.find(animation => animation.name === 'Idle') ?? animations[0];
    if (clip) { mixer.clipAction(clip).play(); mixer.update(.6); }
    return () => { mixer.stopAllAction(); mixer.uncacheRoot(model); };
  }, [animations, mixer, model]);
  useFrame((_, delta) => { if (!paused) mixer.update(Math.min(delta, .05)); });
  return <primitive object={model} position={position} scale={scale} rotation={[0, rotation, 0]} dispose={null} />;
}

/** A tiny shader modification keeps the pond lit and shadowed with the rest of the island. */
function Pond({ paused, lighting }: { paused: boolean; lighting: Lighting }) {
  const time = useMemo(() => ({ value: 0 }), []);
  const rings = useRef<Group>(null);
  const geometry = useMemo(() => new CircleGeometry(1, 48), []);
  const material = useMemo(() => {
    const water = new MeshStandardMaterial({ color: '#329a98', roughness: .28, metalness: .16 });
    water.onBeforeCompile = shader => {
      shader.uniforms.pondTime = time;
      shader.vertexShader = 'varying vec2 pondUv;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\npondUv = uv;');
      shader.fragmentShader = 'uniform float pondTime; varying vec2 pondUv;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        vec2 p = pondUv * vec2(19.0, 12.0);
        float wave = sin(p.x + sin(p.y * .78 + pondTime * .28) * 1.8 + pondTime * .32);
        float ripple = sin(p.y * 2.0 - p.x * .65 + pondTime * .4);
        float shimmer = pow(max(0.0, wave * ripple), 7.0) * .19;
        float shoreline = smoothstep(.31, .5, distance(pondUv, vec2(.5)));
        diffuseColor.rgb *= .84 + .10 * sin(p.x * .28 + p.y * .36);
        diffuseColor.rgb += vec3(.15, .25, .20) * (shimmer + shoreline * .18);
      `);
    };
    return water;
  }, [time]);
  useEffect(() => {
    material.color.set(lighting === 'dusk' ? '#337d96' : '#329a98');
  }, [lighting, material]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useFrame((_, delta) => {
    if (paused) return;
    time.value += Math.min(delta, .05);
    rings.current?.children.forEach((ring, i) => {
      const phase = (time.value * .13 + i * .31) % 1;
      ring.scale.setScalar(.8 + phase * .85);
      const rippleMaterial = (ring as Mesh).material as MeshBasicMaterial;
      rippleMaterial.opacity = Math.sin(phase * Math.PI) * .33;
    });
  });
  return <>
    <mesh position={[1.34, .289, 1.31]} rotation={[-Math.PI / 2, 0, -.08]} scale={[1.79, .98, 1]} geometry={geometry} material={material} receiveShadow dispose={null} />
    <group ref={rings}>
      {[[2.11, 1.17, .13], [1.85, 1.9, .12], [.30, 1.77, .09]].map(([x, z, radius], i) => <mesh key={i} position={[x, .30, z]} rotation={[-Math.PI / 2, 0, i * 1.7]}>
        <torusGeometry args={[radius, .006, 3, 28, Math.PI * 1.55]} />
        <meshBasicMaterial color="#c8eee0" transparent opacity={.16} depthWrite={false} />
      </mesh>)}
    </group>
  </>;
}

function Fireflies({ paused, lighting }: { paused: boolean; lighting: Lighting }) {
  const flies = useRef<Points>(null);
  const time = useRef(0);
  const { geometry, material, texture } = useMemo(() => {
    const positions = new Float32Array(18 * 3);
    for (let i = 0; i < 18; i++) {
      positions[i * 3] = Math.cos(i * 2.39) * (2.3 + i % 3 * .3);
      positions[i * 3 + 1] = .7 + i % 5 * .44;
      positions[i * 3 + 2] = Math.sin(i * 2.39) * 2.45;
    }
    const dots = new BufferGeometry();
    dots.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const pixels = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const radius = Math.hypot((x - 15.5) / 16, (y - 15.5) / 16);
      const offset = (y * 32 + x) * 4;
      pixels[offset] = 255; pixels[offset + 1] = 255; pixels[offset + 2] = 255;
      pixels[offset + 3] = Math.round(Math.pow(Math.max(0, 1 - radius), 2.2) * 255);
    }
    const glow = new DataTexture(pixels, 32, 32, RGBAFormat);
    glow.needsUpdate = true;
    const dust = new PointsMaterial({ color: '#ffe7a0', size: 8, sizeAttenuation: false, map: glow, transparent: true, opacity: .22, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
    return { geometry: dots, material: dust, texture: glow };
  }, []);
  useEffect(() => {
    material.opacity = lighting === 'dusk' ? .9 : .18;
    material.size = lighting === 'dusk' ? 12 : 7;
  }, [lighting, material]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); texture.dispose(); }, [geometry, material, texture]);
  useFrame((_, delta) => {
    if (paused || !flies.current) return;
    time.current += Math.min(delta, .05);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      positions.setXYZ(i,
        Math.cos(i * 2.39) * (2.3 + i % 3 * .3) + Math.sin(time.current * .24 + i) * .18,
        .7 + i % 5 * .44 + Math.sin(time.current * .48 + i * 2) * .20,
        Math.sin(i * 2.39) * 2.45 + Math.cos(time.current * .21 + i * 2) * .12);
    }
    positions.needsUpdate = true;
  });
  return <points ref={flies} geometry={geometry} material={material} dispose={null} />;
}

function Butterflies({ paused, lighting }: { paused: boolean; lighting: Lighting }) {
  const group = useRef<Group>(null);
  const time = useRef(0);
  const geometry = useMemo(() => new IcosahedronGeometry(1, 0), []);
  const material = useMemo(() => new MeshStandardMaterial({ color: '#efc28f', roughness: .8, emissive: '#9a5139', emissiveIntensity: .10 }), []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useFrame((_, delta) => {
    if (paused || !group.current) return;
    time.current += Math.min(delta, .05);
    group.current.children.forEach((butterfly, i) => {
      const t = time.current * .24 + i * 2.4;
      butterfly.position.set(-1.4 + Math.sin(t) * 1.75, 1.2 + i * .44 + Math.sin(t * 1.4) * .18, .1 + Math.cos(t) * 1.95);
      butterfly.rotation.y = t + Math.PI / 2;
      butterfly.children[0].rotation.z = .35 + Math.sin(time.current * 7.5 + i) * .62;
      butterfly.children[1].rotation.z = -.35 - Math.sin(time.current * 7.5 + i) * .62;
    });
  });
  return <group ref={group} visible={lighting === 'day'}>
    {[0, 1, 2].map(i => <group key={i} position={[-1.4 + Math.sin(i * 2.4) * 1.75, 1.2 + i * .44, .1 + Math.cos(i * 2.4) * 1.95]}>
      <mesh geometry={geometry} material={material} position={[-.06, 0, 0]} scale={[.105, .016, .07]} dispose={null} />
      <mesh geometry={geometry} material={material} position={[.06, 0, 0]} scale={[.105, .016, .07]} dispose={null} />
    </group>)}
  </group>;
}

function softDiscTexture() {
  const pixels = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const radius = Math.hypot((x - 15.5) / 16, (y - 15.5) / 16);
    const offset = (y * 32 + x) * 4;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 255;
    pixels[offset + 3] = Math.round(Math.pow(Math.max(0, 1 - radius * radius), 2.4) * 255);
  }
  const texture = new DataTexture(pixels, 32, 32, RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

/** A single draw call anchors the trunks and cottage without a screen-space effects pass. */
function GroundShade() {
  const { geometry, material, texture } = useMemo(() => {
    const footprints = [
      [-2.29, -.12, .60], [-1.46, -1.69, .66], [1.66, -1.62, .60],
      [2.77, -.39, .44], [-2.62, 1.39, .40], [.18, -1.11, 1.05],
    ];
    const circles = footprints.map(([x, z, radius]) => {
      const circle = new CircleGeometry(radius, 20);
      circle.rotateX(-Math.PI / 2);
      circle.translate(x, .221, z);
      return circle;
    });
    const geometry = mergeBufferGeometries(circles, false)!;
    circles.forEach(circle => circle.dispose());
    const texture = softDiscTexture();
    const material = new MeshBasicMaterial({ color: '#163c2b', map: texture, transparent: true, opacity: .28, depthWrite: false });
    return { geometry, material, texture };
  }, []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); texture.dispose(); }, [geometry, material, texture]);
  return <mesh geometry={geometry} material={material} dispose={null} />;
}

/** Six soft billboards share one tiny texture; no fluid simulation or extra render pass. */
function ChimneySmoke({ paused, lighting }: { paused: boolean; lighting: Lighting }) {
  const elapsed = useRef(0);
  const { smoke, texture } = useMemo(() => {
    const texture = softDiscTexture();
    const smoke = new Group();
    for (let i = 0; i < 6; i++) {
      smoke.add(new Sprite(new SpriteMaterial({ map: texture, color: '#dce1d0', transparent: true, depthWrite: false, toneMapped: false })));
    }
    return { smoke, texture };
  }, []);
  const updatePuffs = (time: number) => {
    smoke.children.forEach((child, i) => {
      const puff = child as Sprite;
      const phase = (time * .075 + i / smoke.children.length) % 1;
      // A curling plume thins as it rises, keeping the treetops and roof clear.
      puff.position.set(.65 + phase * .62 + Math.sin(phase * 5.4) * .09, 2.59 + phase * 1.36, -1.48 - phase * .13);
      puff.scale.setScalar(.21 + phase * .67);
      puff.material.opacity = Math.sin(phase * Math.PI) * (lighting === 'dusk' ? .15 : .23);
    });
  };
  useEffect(() => {
    smoke.children.forEach(child => (child as Sprite).material.color.set(lighting === 'dusk' ? '#a8bccc' : '#dce1d0'));
    updatePuffs(elapsed.current);
  }, [lighting, smoke]);
  useEffect(() => () => {
    smoke.children.forEach(child => (child as Sprite).material.dispose());
    texture.dispose();
  }, [smoke, texture]);
  useFrame((_, delta) => {
    if (paused) return;
    elapsed.current += Math.min(delta, .05);
    updatePuffs(elapsed.current);
  });
  return <primitive object={smoke} dispose={null} />;
}

function World({ paused, lighting, onReady }: { paused: boolean; lighting: Lighting; onReady?: () => void }) {
  const geometry = useMemo(islandGeometry, []);
  const material = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: .93, flatShading: true }), []);
  const { camera, size, invalidate, gl } = useThree();
  const ready = useRef(false);
  const readyFrame = useRef<number>();
  const onReadyRef = useRef(onReady);
  const island = useRef<Group>(null);
  const idleTime = useRef(0);
  const dragging = useRef(false);
  const resumeIn = useRef(0);
  const dusk = lighting === 'dusk';
  onReadyRef.current = onReady;
  useEffect(() => {
    // Horizontal gestures turn the diorama; vertical gestures still scroll the page.
    gl.domElement.style.touchAction = 'pan-y';
  }, [gl]);
  useEffect(() => {
    (camera as OrthographicCamera).zoom = Math.min(size.width / 10.8, size.height / 8.0);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, invalidate]);
  useEffect(() => { invalidate(); }, [lighting, paused, invalidate]);
  useEffect(() => () => {
    if (readyFrame.current !== undefined) cancelAnimationFrame(readyFrame.current);
    geometry.dispose(); material.dispose();
  }, [geometry, material]);
  useFrame((_, delta) => {
    if (!ready.current) {
      ready.current = true;
      readyFrame.current = requestAnimationFrame(() => onReadyRef.current?.());
    }
    if (paused || dragging.current || !island.current) return;
    const step = Math.min(delta, .05);
    if (resumeIn.current > 0) { resumeIn.current -= step; return; }
    idleTime.current += step;
    // A slow, bounded drift never resets the view chosen by the visitor.
    island.current.rotation.y = -.13 + Math.sin(idleTime.current * .12) * .085;
    island.current.position.y = Math.sin(idleTime.current * .34) * .025;
  });
  return <>
    <ambientLight intensity={dusk ? .18 : .19} color={dusk ? '#b6bee0' : '#eef4fa'} />
    <hemisphereLight args={[dusk ? '#829bc5' : '#d1e5f6', dusk ? '#263645' : '#425747', dusk ? .38 : .43]} />
    <directionalLight position={[-4, 8, 5]} intensity={dusk ? .45 : 1.05} color={dusk ? '#b3c4ec' : '#fff2dc'} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-6} shadow-camera-near={.1} shadow-camera-far={24} shadow-bias={-.0004} shadow-normalBias={.025} />
    <directionalLight position={[5, 4, -5]} intensity={dusk ? .70 : .44} color={dusk ? '#7c9ef1' : '#c6e5e8'} />
    <group ref={island} rotation={[0, -.13, 0]}>
      <mesh geometry={geometry} material={material} castShadow receiveShadow dispose={null} />
      <GroundShade />
      <Pond paused={paused} lighting={lighting} />
      <SceneBoundary><Suspense fallback={null}>
        <LocalCharacter asset="gardener" position={[-.90, .24, 1.30]} scale={.40} rotation={.70} paused={paused} />
        <LocalCharacter asset="pip" position={[1.77, .24, -.18]} scale={.63} rotation={-.72} paused={paused} />
      </Suspense></SceneBoundary>
      <Fireflies paused={paused} lighting={lighting} />
      <Butterflies paused={paused} lighting={lighting} />
      <ChimneySmoke paused={paused} lighting={lighting} />
      <mesh position={[-.22, 1.06, -.395]}>
        <boxGeometry args={[.29, .33, .008]} />
        <meshStandardMaterial color={dusk ? '#ffd896' : '#d1b989'} emissive="#ffc372" emissiveIntensity={dusk ? 1.9 : .13} roughness={.45} toneMapped={!dusk} />
      </mesh>
      <pointLight position={[-.20, 1.16, -.15]} intensity={dusk ? 1.4 : 0} color="#ffc082" distance={3.5} decay={2} />
    </group>
    <OrbitControls makeDefault target={[0, .65, 0]} enableZoom={false} enablePan={false} enableDamping={!paused} dampingFactor={.065} rotateSpeed={.4} minPolarAngle={.80} maxPolarAngle={1.14} minAzimuthAngle={-.35} maxAzimuthAngle={1.35}
      onStart={() => { dragging.current = true; gl.domElement.style.cursor = 'grabbing'; }}
      onEnd={() => { dragging.current = false; resumeIn.current = 5; gl.domElement.style.cursor = 'grab'; }} />
  </>;
}

class SceneBoundary extends React.Component<{ children: React.ReactNode; onUnavailable?: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onUnavailable?.(); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** No game connection or remote textures; the surrounding hero owns its static fallback. */
export default function IslandScene({ paused, lighting = 'day', onReady, onUnavailable }: IslandSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const [offscreen, setOffscreen] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const [reducedMotion, setReducedMotion] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [lostContext, setLostContext] = useState(false);
  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setReducedMotion(motion.matches);
    const updateHidden = () => setHidden(document.hidden);
    motion.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateHidden);
    const observer = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => setOffscreen(!entries[0].isIntersecting), { rootMargin: '80px' }) : null;
    if (host.current) observer?.observe(host.current);
    return () => {
      motion.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateHidden);
      observer?.disconnect();
    };
  }, []);
  const still = (paused ?? reducedMotion) || offscreen || hidden;
  return <div ref={host} style={{ width: '100%', height: '100%', touchAction: 'pan-y' }}>
    {!lostContext && <SceneBoundary onUnavailable={onUnavailable}>
      <Canvas orthographic camera={{ position: [8, 6.8, 10], near: .1, far: 50, zoom: 55 }} dpr={[1, 1.5]} shadows frameloop={still ? 'demand' : 'always'} gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }} fallback={null} style={{ cursor: 'grab' }} onCreated={({ gl }) => {
        gl.setClearColor('#132c26', 0);
        gl.domElement.addEventListener('webglcontextlost', () => { setLostContext(true); onUnavailable?.(); }, { once: true });
      }}>
        <World paused={still} lighting={lighting} onReady={onReady} />
      </Canvas>
    </SceneBoundary>}
  </div>;
}
