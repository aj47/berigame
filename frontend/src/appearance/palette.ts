import type { MeshStandardMaterial, Texture } from 'three';
import { CanvasTexture } from 'three';
import { HAIR_COLORS, ROBE_COLORS, SKIN_TONES, WRAP_COLORS, type Appearance } from '@sim';

// Matches the Blender atlas contract; PNG rows start at the top.
const BASE = ['42699C','355780','527DAE','E3D4B2','CABB9C','F0DDB8','C68B55','DFA76E','E9B882','513626','674731','78573B','333743','414451','252B36','BDA16D','34271F','483326','594030','221B18','F5EAD0','8C643E','A87345','273E63'];
const rgb = (hex: string) => hex.replace('#','').match(/../g)!.map((channel) => parseInt(channel,16));
export function paletteKey(a: Appearance): string {
  return [a.skinTone,a.hairColor,a.robeColor,a.wrapColor].join(':');
}
export function paletteColors(a: Appearance): string[] {
  const colors = [...BASE];
  const families = [
    { indices:[0,1,2], base:0, selected:ROBE_COLORS[a.robeColor].color },
    { indices:[3,4,5], base:3, selected:WRAP_COLORS[a.wrapColor].color },
    { indices:[6,7,8,22], base:7, selected:SKIN_TONES[a.skinTone].color },
    { indices:[16,17,18], base:17, selected:HAIR_COLORS[a.hairColor].color },
  ];
  for (const family of families) {
    const from=rgb(BASE[family.base]), to=rgb(family.selected);
    for (const i of family.indices) colors[i]=rgb(BASE[i]).map((v,c)=>Math.max(0,Math.min(255,Math.round(v*to[c]/from[c]))).toString(16).padStart(2,'0')).join('').toUpperCase();
  }
  return colors;
}
interface Entry { material: MeshStandardMaterial; texture: Texture; users: number; }
const cache = new Map<string,Entry>();
/** Reference-counted palette materials: memory follows visible users, not all possible outfits. */
export function acquirePalette(base: MeshStandardMaterial, appearance: Appearance) {
  const key=base.uuid+':'+paletteKey(appearance);
  let entry=cache.get(key);
  if (!entry) {
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
    const context=canvas.getContext('2d')!;
    const colors=paletteColors(appearance);
    for (let i=0;i<64;i++) { context.fillStyle='#'+colors[i%colors.length];context.fillRect((i%8)*8,56-Math.floor(i/8)*8,8,8); }
    const texture=new CanvasTexture(canvas);
    if (base.map) { texture.encoding=base.map.encoding;texture.flipY=base.map.flipY;texture.magFilter=base.map.magFilter;texture.minFilter=base.map.minFilter; }
    const material=base.clone();material.map=texture;material.needsUpdate=true;
    entry={material,texture,users:0};cache.set(key,entry);
  }
  entry.users++;
  const value=entry;
  return { material:value.material, release:() => {
    value.users--;
    if (value.users===0) { value.material.dispose();value.texture.dispose();cache.delete(key); }
  } };
}

/** Read by the development resource verifier, never by a player-facing UI. */
export function paletteCacheSnapshot() {
  return { entries: cache.size, users: [...cache.values()].reduce((sum, value) => sum + value.users, 0) };
}
