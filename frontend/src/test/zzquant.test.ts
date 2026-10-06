import path from 'node:path';
import { it } from 'vitest';
import { Vector3, type SkinnedMesh, type BufferAttribute } from 'three';
import { loadAdventurerRig } from './adventurerRig';
it('quant', async () => {
  for (const [hair, file] of [['tousled','starter-adventurer.glb']]) {
  const a = await loadAdventurerRig(path.resolve(__dirname, `../../../docs/art/characters/blender-v4/${hair}/starter-adventurer-v4-${hair}.glb`));
  const b = await loadAdventurerRig(file);
  const ma = a.node('StarterAdventurer') as SkinnedMesh, mb = b.node('StarterAdventurer') as SkinnedMesh;
  const pa = ma.geometry.attributes.position as BufferAttribute, pb = mb.geometry.attributes.position as BufferAttribute;
  let worst = 0, where = '', propWorst = 0; console.log('MESHXF', ma.matrixWorld.elements.join(','), '|', mb.matrixWorld.elements.join(','), mb.bindMatrix.elements.join(','));
  const va = new Vector3(), vb = new Vector3();
  // meshopt() reorders vertices: map each source vertex to its nearest shipped vertex in the Idle pose.
  const map: number[] = [];
  { a.pose(a.clip('Defeat'), 1.2); b.pose(b.clip('Defeat'), 1.2); const A: Vector3[] = [], B: Vector3[] = [];
    for (let v = 0; v < pa.count; v++) { const x = new Vector3().fromBufferAttribute(pa, v); ma.applyBoneTransform(v, x); A.push(x); const y = new Vector3().fromBufferAttribute(pb, v); mb.applyBoneTransform(v, y); B.push(y); }
    let mapWorst = 0;
    for (let v = 0; v < A.length; v++) { let best = 0, bd = Infinity; for (let u = 0; u < B.length; u++) { const d = A[v].distanceToSquared(B[u]); if (d < bd) { bd = d; best = u; } } map.push(best); mapWorst = Math.max(mapWorst, Math.sqrt(bd)); }
    console.log('MAPWORST', mapWorst.toFixed(5)); }
  for (const clip of a.animations) {
    const cb = b.clip(clip.name);
    for (let t = 0; t <= clip.duration; t += clip.duration / 7) {
      a.pose(clip, t); b.pose(cb, t);
      for (let v = 0; v < pa.count; v++) {
        va.fromBufferAttribute(pa, v); ma.applyBoneTransform(v, va); va.applyMatrix4(ma.matrixWorld);
        vb.fromBufferAttribute(pb, map[v]); mb.applyBoneTransform(map[v], vb); vb.applyMatrix4(mb.matrixWorld);
        const d = va.distanceTo(vb); const si = mb.geometry.attributes.skinIndex as BufferAttribute, sw = mb.geometry.attributes.skinWeight as BufferAttribute; let prop = false; for (let k = 0; k < 4; k++) if ([sw.getX(v),sw.getY(v),sw.getZ(v),sw.getW(v)][k] > 0 && mb.skeleton.bones[[si.getX(v),si.getY(v),si.getZ(v),si.getW(v)][k]].name.startsWith('Prop')) prop = true; if (prop) { propWorst = Math.max(propWorst, d); continue; } if (d > worst) { worst = d; where = `${clip.name}@${t.toFixed(2)} v${v}`; }
      }
    }
  }
  { const v = +where.split(' v')[1]; const f=(m: SkinnedMesh)=>{const g=m.geometry.attributes as any; return JSON.stringify({p:[g.position.getX(v),g.position.getY(v),g.position.getZ(v)], i:[g.skinIndex.getX(v),g.skinIndex.getY(v),g.skinIndex.getZ(v),g.skinIndex.getW(v)].map((k:number)=>m.skeleton.bones[k].name), w:[g.skinWeight.getX(v),g.skinWeight.getY(v),g.skinWeight.getZ(v),g.skinWeight.getW(v)]});}; console.log('DETAIL', f(ma), f(mb)); }
  console.log('QUANT', hair, 'prop', propWorst.toFixed(4), pa.count, pb.count, worst.toFixed(5), where, (pb.array as any).constructor.name);
  }
}, 120000);
