import { BufferGeometry, Color, DataTexture, Float32BufferAttribute, LinearFilter, MeshStandardMaterial, RGBAFormat } from 'three';
import { GRID_SIZE, TILE_ORIGIN, terrainField, trailDistance } from '@sim';
import { linear } from './nodes/lowPoly';

const grass = linear(0x73a44c), deepGrass = linear(0x4b803c), sand = linear(0xecd099), ash = linear(0x8b897c), trail = linear(0xc7ad7b);
export const terrainMaterial = new MeshStandardMaterial({vertexColors:true, roughness:1, flatShading:true});
/** Clip small triangles against the continuous shore, keeping soft coves and riverbanks. */
export const terrainGeometry = (() => {
  const positions: number[] = [], colors: number[] = [];
  type V = {x:number;z:number;d:number};
  const vertex = (v: V) => {
    positions.push(v.x-TILE_ORIGIN, Math.min(0,v.d*.15-.15),v.z-TILE_ORIGIN);
    const patch = .5+.25*Math.sin(v.x*.38+Math.sin(v.z*.23))+.25*Math.sin(v.z*.51-v.x*.14);
    const c = new Color().copy(deepGrass).lerp(grass,patch);
    if(Math.max(v.x,v.z)>49) c.copy(ash).multiplyScalar(.85+patch*.25);
    else c.lerp(sand, Math.max(0,1-v.d/1.7));
    const road = trailDistance(v.x,v.z);
    if(v.d>.5) c.lerp(trail,Math.max(0,Math.min(1,(1.1-road)*3))*.83);
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
  const step=.5;
  // Cache field samples; adjacent cells share identical coastline intersections.
  const n=GRID_SIZE*2+1, values=new Float32Array(n*n);
  for(let z=0;z<n;z++)for(let x=0;x<n;x++) values[z*n+x]=terrainField(x*step-.5,z*step-.5);
  for(let z=0;z<n-1;z++)for(let x=0;x<n-1;x++){
    const a={x:x*step-.5,z:z*step-.5,d:values[z*n+x]},b={x:(x+1)*step-.5,z:z*step-.5,d:values[z*n+x+1]},c={x:(x+1)*step-.5,z:(z+1)*step-.5,d:values[(z+1)*n+x+1]},d={x:x*step-.5,z:(z+1)*step-.5,d:values[(z+1)*n+x]};
    clip([a,d,b]);clip([b,d,c]);
  }
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));g.setAttribute('color',new Float32BufferAttribute(colors,3));g.computeVertexNormals();g.computeBoundingSphere();return g;
})();
/** Signed coastal distance in a tiny texture, shared by the river and ocean shader. */
export const coastTexture = (()=>{
  const n=128, data=new Uint8Array(n*n*4);
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){
    const d=terrainField((x+.5)/2-.5,(z+.5)/2-.5),i=(z*n+x)*4;
    data[i]=Math.round(Math.max(0,Math.min(1,(8-d)/32))*255);data[i+1]=data[i];data[i+2]=data[i];data[i+3]=255;
  }
  const t=new DataTexture(data,n,n,RGBAFormat);t.minFilter=LinearFilter;t.magFilter=LinearFilter;t.needsUpdate=true;return t;
})();
