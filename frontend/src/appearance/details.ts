import { Mesh, Vector3, type Object3D } from 'three';
import { HAIR_COLORS, WRAP_COLORS, ROBE_COLORS, ACCESSORY_COLORS, type CharacterAppearance } from '@sim';
import { LowPolyBuilder, coastMaterial, linear } from '../Components/3D/nodes/lowPoly';

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
export const BODY_SCALES = [[1,1,1], [.88,1.04,.93], [1.13,1,1.08], [1.04,.91,1.04]] as const;
export const FACE_SCALES = [[1,1,1], [1.06,.93,1.04], [.93,1.08,.97], [1.12,1,1]] as const;
/** Small details follow the animated bones. Each mount is a single draw call. */
export function mountAppearanceDetails(model: Object3D, a: CharacterAppearance) {
  const head = new LowPolyBuilder(), outfit = new LowPolyBuilder();
  const hair = linear(parseInt(HAIR_COLORS[a.hairColor].color.slice(1),16));
  const accent = linear(parseInt(ACCESSORY_COLORS[a.accessoryColor].color.slice(1),16));
  const cloth = linear(parseInt(WRAP_COLORS[a.wrapColor].color.slice(1),16));
  const robe = linear(parseInt(ROBE_COLORS[a.robeColor].color.slice(1),16)).multiplyScalar(.72);
  const log = (b: LowPolyBuilder, from: Vector3, to: Vector3, r0: number, r1: number, color = hair) => b.log(from,to,r0,r1,{sides:8,rings:2,bark:[color,color.clone().multiplyScalar(.84)],cap:color});
  const rock = (b: LowPolyBuilder, p: Vector3, scale: Vector3, color = hair) => b.rock(p,1,scale,{segments:10,jitter:0,colors:[color,color.clone().multiplyScalar(.9)]});
  const ring = (b: LowPolyBuilder, center: Vector3, radius: number, color = accent) => {
    for(let i=0;i<16;i++) { const t=i*Math.PI/8, next=(i+1)*Math.PI/8;
      log(b,center.clone().add(v(Math.cos(t)*radius,Math.sin(t)*radius,0)),center.clone().add(v(Math.cos(next)*radius,Math.sin(next)*radius,0)),.009,.009,color);
    }
  };
  // A faceted scalp cap leaves the face open; longer styles build on its back and sides.
  if(a.hairStyle>=4 && a.hairStyle<=7) {
    const n=16, center=v(0,.195,-.003);
    const point=(i:number,j:number)=>{const theta=i*2*Math.PI/n, phi=(j/4)*(Math.cos(theta)>0 ? 1.07:1.7);return center.clone().add(v(Math.sin(theta)*Math.sin(phi)*.282,Math.cos(phi)*.302,Math.cos(theta)*Math.sin(phi)*.24));};
    for(let j=0;j<4;j++)for(let i=0;i<n;i++){const p=point(i,j),q=point(i+1,j),r=point(i+1,j+1),s=point(i,j+1);head.triangle(p,s,q,hair);head.triangle(q,s,r,hair.clone().multiplyScalar(i%3===0?.88:1));}
  }
  if(a.hairStyle===4) {
    for(let i=0;i<5;i++)log(head,v(-.2+i*.075,.44,.10),v(-.13+i*.073,.31+i*.021,.215),.073,.034);
  }
  if(a.hairStyle===5) {
    for(let i=0;i<11;i++){const t=.95+i*(Math.PI*2-1.9)/10;log(head,v(Math.sin(t)*.25,.32,Math.cos(t)*.2),v(Math.sin(t)*.28,-.035,Math.cos(t)*.23),.077,.065);}
  }
  if(a.hairStyle===6) { rock(head,v(0,.28,-.255),v(.10,.10,.10),accent);log(head,v(0,.27,-.28),v(0,-.17,-.32),.1,.055); }
  if(a.hairStyle===7)for(const side of [-1,1]) {
    for(let j=0;j<7;j++)rock(head,v(side*(.235+(j%2)*.014),.22-j*.057,-.04),v(.07,.054,.072));
    rock(head,v(side*.245,-.15,-.04),v(.065,.023,.067),accent);
  }
  if(a.hairStyle===8)for(let i=0;i<7;i++) {const t=-1.15+i*.34;rock(head,v(0,.22+Math.cos(t)*.30,Math.sin(t)*.21),v(.07,.13,.078));}
  if(a.facialHair===1||a.facialHair===3) for(const side of [-1,1]) log(head,v(side*.012,.085,.246),v(side*.10,.056,.231),.021,.014);
  if(a.facialHair===2)rock(head,v(0,-.015,.197),v(.075,.075,.048));
  if(a.facialHair===3) { rock(head,v(0,-.01,.155),v(.17,.105,.105));for(const side of [-1,1])log(head,v(side*.177,.11,.15),v(side*.12,-.025,.17),.04,.047); }
  if(a.accessory===1){for(const side of [-1,1]){ring(head,v(side*.095,.208,.253),.068);log(head,v(side*.16,.21,.249),v(side*.253,.218,.02),.009,.009,accent);}log(head,v(-.03,.21,.255),v(.03,.21,.255),.009,.009,accent);}
  if(a.accessory===2)for(const side of [-1,1])ring(head,v(side*.273,.095,.008),.041);
  if(a.accessory===3) {for(let i=0;i<24;i++){const t=i*Math.PI/12,nt=(i+1)*Math.PI/12;log(head,v(Math.sin(t)*.263,.33,Math.cos(t)*.209),v(Math.sin(nt)*.263,.33,Math.cos(nt)*.209),.023,.023,accent);}}
  if(a.accessory===4){rock(head,v(-.095,.208,.249),v(.068,.054,.026),accent);log(head,v(-.16,.218,.225),v(-.263,.265,0),.012,.012,accent);log(head,v(-.03,.215,.252),v(.243,.272,.085),.012,.012,accent);}
  if(a.accessory===5)ring(head,v(.036,.13,.269),.024);
  // Neck-mounted layers leave the animated arms free.
  if(a.outfitStyle===1){log(outfit,v(0,-.025,0),v(0,.055,0),.19,.175,cloth);log(outfit,v(.105,-.025,.14),v(.16,-.29,.20),.062,.05,cloth);}
  if(a.outfitStyle===2){rock(outfit,v(0,-.11,-.055),v(.39,.13,.24),cloth);log(outfit,v(0,-.08,-.20),v(0,-.39,-.24),.18,.23,cloth);}
  if(a.outfitStyle===3)for(const side of [-1,1]){log(outfit,v(side*.18,-.10,.065),v(side*.18,-.39,.12),.105,.11,robe);log(outfit,v(side*.1,-.1,.18),v(side*.105,-.36,.218),.016,.016,cloth);}
  const mounts: (()=>void)[]=[];
  for(const [builder,boneName] of [[head,'Head'],[outfit,'Neck']] as const){
    const bone=model.getObjectByName(boneName); if(!bone||!builder.positions.length)continue;
    const geometry=builder.build(),mesh=new Mesh(geometry,coastMaterial());mesh.name=`CharacterDetails${boneName}`;bone.add(mesh);
    mounts.push(()=>{bone.remove(mesh);geometry.dispose();});
  }
  return ()=>mounts.forEach(dispose=>dispose());
}
