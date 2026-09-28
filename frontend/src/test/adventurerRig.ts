/**
 * Test helper: the real adventurer GLB, parsed without its texture (jsdom has
 * no image decoder), posed by any clip and CPU-skinned so tests can measure
 * how close a held stick comes to the body.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Ray, Triangle, Vector3, type AnimationClip, type BufferAttribute, type Interpolant, type Object3D, type SkinnedMesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODELS = path.resolve(__dirname, '../../public/models');

/** The GLB with images, textures and samplers removed; geometry, skin and clips intact. */
function glbWithoutTexture(file: string): ArrayBuffer {
  const glb = fs.readFileSync(file);
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
  delete json.images; delete json.textures; delete json.samplers;
  for (const material of json.materials ?? []) delete material.pbrMetallicRoughness?.baseColorTexture;
  const binLength = glb.readUInt32LE(20 + jsonLength);
  const bin = glb.subarray(28 + jsonLength, 28 + jsonLength + binLength);
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const out = Buffer.alloc(28 + text.length + bin.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(text.length, 12); out.writeUInt32LE(0x4e4f534a, 16); text.copy(out, 20);
  out.writeUInt32LE(bin.length, 20 + text.length); out.writeUInt32LE(0x004e4942, 24 + text.length); bin.copy(out, 28 + text.length);
  // Copy into this realm's ArrayBuffer: GLTFLoader checks `instanceof ArrayBuffer`, and Node's Buffer memory fails that under jsdom.
  const buffer = new ArrayBuffer(out.length);
  new Uint8Array(buffer).set(out);
  return buffer;
}

export interface AdventurerRig {
  scene: Object3D;
  animations: AnimationClip[];
  clip: (name: string) => AnimationClip;
  node: (name: string) => Object3D;
  /** Pose the rig at `t` seconds of `clip` (clamped to the clip). */
  pose: (clip: AnimationClip, t: number) => void;
  /**
   * Smallest distance from the segment p-q to the posed body surface (0 when
   * it passes through; Infinity when nothing is within 0.2). Skips the
   * gripping right hand, and any triangle mostly weighted to `skip` bones.
   */
  clearance: (p: Vector3, q: Vector3, skip?: string[]) => { distance: number; bone: string };
}

const RIGHT_HAND = ['HandR', 'FingersR', 'FingerTipsR', 'ThumbR'];

/** `file` is one of the shipped hair variants in public/models; they share one rig and clip set. */
export async function loadAdventurerRig(file = 'starter-adventurer.glb'): Promise<AdventurerRig> {
  const gltf = await new Promise<any>((resolve, reject) => new GLTFLoader().parse(glbWithoutTexture(path.join(MODELS, file)), '', resolve, reject));
  const scene: Object3D = gltf.scene;
  const nodes = new Map<string, Object3D>();
  scene.traverse((object) => { if (!nodes.has(object.name)) nodes.set(object.name, object); });
  const rest = new Map<Object3D, number[][]>();
  scene.traverse((object) => rest.set(object, [object.position.toArray(), object.quaternion.toArray(), object.scale.toArray()]));
  const mesh = nodes.get('StarterAdventurer') as SkinnedMesh;
  const { position, skinIndex, skinWeight } = mesh.geometry.attributes as Record<string, BufferAttribute>;
  const bones = mesh.skeleton.bones;
  const index = mesh.geometry.index!.array;
  // Per triangle: the dominant bone and how much of it hangs off the right hand.
  const triangles: { a: number; b: number; c: number; bone: string; hand: number }[] = [];
  const vertexInfo = Array.from({ length: position.count }, (_, v) => {
    const ids = [skinIndex.getX(v), skinIndex.getY(v), skinIndex.getZ(v), skinIndex.getW(v)];
    const weights = [skinWeight.getX(v), skinWeight.getY(v), skinWeight.getZ(v), skinWeight.getW(v)];
    let hand = 0, top = 0;
    weights.forEach((w, k) => { if (RIGHT_HAND.includes(bones[ids[k]].name)) hand += w; if (w > weights[top]) top = k; });
    return { hand, bone: bones[ids[top]].name };
  });
  for (let i = 0; i < index.length; i += 3) {
    const [a, b, c] = [index[i], index[i + 1], index[i + 2]];
    triangles.push({ a, b, c, bone: vertexInfo[a].bone, hand: Math.max(vertexInfo[a].hand, vertexInfo[b].hand, vertexInfo[c].hand) });
  }
  const interpolants = new WeakMap<AnimationClip, { node: Object3D; property: 'position' | 'quaternion' | 'scale'; interpolant: Interpolant }[]>();
  const posed = Array.from({ length: position.count }, () => new Vector3());

  const pose = (clip: AnimationClip, t: number) => {
    for (const [object, [p, q, s]] of rest) { object.position.fromArray(p); object.quaternion.fromArray(q); object.scale.fromArray(s); }
    let list = interpolants.get(clip);
    if (!list) {
      list = clip.tracks.map((track) => {
        const dot = track.name.lastIndexOf('.');
        return { node: nodes.get(track.name.slice(0, dot))!, property: track.name.slice(dot + 1) as 'position' | 'quaternion' | 'scale', interpolant: track.createInterpolant() };
      });
      interpolants.set(clip, list);
    }
    const time = Math.min(Math.max(t, 0), clip.duration);
    for (const { node, property, interpolant } of list) node[property].fromArray(interpolant.evaluate(time) as unknown as number[]);
    scene.updateMatrixWorld(true);
    posed.forEach((vertex, v) => { vertex.fromBufferAttribute(position, v); mesh.boneTransform(v, vertex); vertex.applyMatrix4(mesh.matrixWorld); });
  };

  const triangle = new Triangle(), closest = new Vector3(), sample = new Vector3(), hit = new Vector3(), centre = new Vector3(), nearest = new Vector3();
  const clearance = (p: Vector3, q: Vector3, skip: string[] = []) => {
    const length = p.distanceTo(q);
    const ray = new Ray(p.clone(), q.clone().sub(p).normalize());
    let distance = Infinity, bone = '';
    for (const t of triangles) {
      if (t.hand > 0.05 || skip.includes(t.bone)) continue;
      triangle.set(posed[t.a], posed[t.b], posed[t.c]);
      triangle.getMidpoint(centre);
      const reach = Math.max(centre.distanceTo(posed[t.a]), centre.distanceTo(posed[t.b]), centre.distanceTo(posed[t.c]));
      // Cheap reject: this triangle cannot come closer than the best so far (or 0.2).
      if (centre.distanceTo(closestOnSegment(p, q, centre, nearest)) - reach > Math.min(distance, 0.2)) continue;
      let d = Infinity;
      if (ray.intersectTriangle(posed[t.a], posed[t.b], posed[t.c], false, hit) && hit.distanceTo(p) <= length) d = 0;
      else for (let k = 0; k <= 100; k++) {
        sample.lerpVectors(p, q, k / 100);
        d = Math.min(d, triangle.closestPointToPoint(sample, closest).distanceTo(sample));
      }
      if (d < distance) { distance = d; bone = t.bone; }
    }
    return { distance, bone };
  };

  return {
    scene,
    animations: gltf.animations,
    clip: (name) => gltf.animations.find((clip: AnimationClip) => clip.name === name)!,
    node: (name) => nodes.get(name)!,
    pose,
    clearance,
  };
}

function closestOnSegment(p: Vector3, q: Vector3, point: Vector3, out: Vector3): Vector3 {
  const direction = q.clone().sub(p);
  const t = Math.min(1, Math.max(0, point.clone().sub(p).dot(direction) / direction.lengthSq()));
  return out.copy(p).addScaledVector(direction, t);
}
