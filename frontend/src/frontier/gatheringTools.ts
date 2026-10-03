import { BoxGeometry, CylinderGeometry, IcosahedronGeometry, MeshStandardMaterial } from 'three';
import { part, merged } from '../Components/3D/envArt';

// Compact work props share the same hand mount and chop clip as the island's stick.
export const gatheringToolMaterial = new MeshStandardMaterial({ vertexColors:true, flatShading:true, roughness:.94 });
const handle = () => part(new CylinderGeometry(.025,.036,.62,6),0x8f643e,[0,.31,0]);
export const gatheringToolGeometry = {
  // A small chipped stone head makes the always-available starter tool read
  // differently from the longer, broad metal blade of the crafted upgrade.
  hatchet: merged([
    part(new CylinderGeometry(.025,.036,.46,6),0x8f643e,[0,.23,0]),
    part(new IcosahedronGeometry(.12,0),0xaaa591,[.055,.4,0],[1.1,.9,.4],[0,0,-.2]),
    part(new CylinderGeometry(.042,.042,.1,6),0xd0b77b,[0,.37,0]),
  ]),
  axe: merged([handle(),part(new BoxGeometry(.32,.2,.07),0xaab9b9,[.09,.56,0],[1,1,1],[0,0,-.12])]),
  mine: merged([handle(),part(new BoxGeometry(.39,.07,.07),0x848a82,[0,.56,0],[1,1,1],[0,0,-.12])]),
};
