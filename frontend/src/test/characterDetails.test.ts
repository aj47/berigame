import { describe, expect, it, vi } from 'vitest';
import { Group, Bone, Mesh } from 'three';
import { APPEARANCE_KEYS, APPEARANCE_LIMITS, DEFAULT_APPEARANCE } from '@sim';
import { mountAppearanceDetails } from '../appearance/details';
import { paletteColors, paletteKey } from '../appearance/palette';

describe('character details',()=>{
  it('all options have finite geometry and free owned geometry on unmount',()=>{
    const model=new Group();for(const name of ['Head','Neck']){const bone=new Bone();bone.name=name;model.add(bone);}
    for(const key of APPEARANCE_KEYS)for(let value=0;value<APPEARANCE_LIMITS[key];value++){
      const release=mountAppearanceDetails(model,{...DEFAULT_APPEARANCE,[key]:value});
      const disposed:any[]=[];
      model.traverse(object=>{if(object instanceof Mesh){const positions=object.geometry.getAttribute('position');expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);expect(positions.count).toBeLessThan(10000);disposed.push(vi.spyOn(object.geometry,'dispose'));}});
      release();for(const dispose of disposed)expect(dispose).toHaveBeenCalledOnce();expect(model.getObjectByName('Head')?.children).toHaveLength(0);expect(model.getObjectByName('Neck')?.children).toHaveLength(0);
    }
  });
  it('new palette choices change their own regions and leave weapons intact',()=>{
    const base=paletteColors(DEFAULT_APPEARANCE);
    for(const [key,indices] of [['eyeColor',[19]],['trouserColor',[12,13,14]],['bootColor',[9,10,11]]] as const){
      const changed={...DEFAULT_APPEARANCE,[key]:1};const colors=paletteColors(changed);
      expect(paletteKey(changed)).not.toBe(paletteKey(DEFAULT_APPEARANCE));
      for(let i=0;i<base.length;i++)expect(colors[i]===base[i]).toBe(!(indices as readonly number[]).includes(i));
    }
    expect(base.slice(24)).toEqual(['6AA84F','8A5A33','6E4424','D9B27C']);
  });
});
