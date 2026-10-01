import React, { useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Group, Vector3 } from 'three';
import { BERRY_MARKET, GIANT_FEAST, tileToWorld } from '@sim';
import { useExpeditions, useIslandProjects, usePlayers, useTick } from '../../spacetime/hooks';
import type { Expedition } from '../../module_bindings/types';
import { avatarGroup } from '../../animation/avatarRegistry';
import { openAdventure } from '../AdventurePanel';
import { AdventureActor, AdventureAssetView, adventureActor, type AdventureAsset } from './AdventureModels';
import { useUserInputStore } from '../../store';
import { berryGiantMood } from '../berryGiantUi';

function Place({asset,at,name}: {asset:AdventureAsset;at:{x:number;z:number};name:string}) {
  return <group position={tileToWorld(at)} onClick={e=>{if(e.delta>5)return;e.stopPropagation();openAdventure();}} userData={{hoverTarget:{title:name,action:'Click to open adventures',click:'panel',radius:asset==='market'?1.6:1.1}}}>
    <AdventureAssetView asset={asset}/>
    <Html position={[0,asset==='market'?2.7:1.8,0]} center distanceFactor={14} zIndexRange={[3,0]} style={{pointerEvents:'none'}}><span className="adventure-world-label">{name}</span></Html>
  </group>;
}
function Cargo({row,tick,carrierTile}:{row:Expedition;tick:number;carrierTile?:{x:number;z:number}}) {
  const root=useRef<Group>(null), fruit=useRef<Group>(null),last=useRef(new Vector3(...tileToWorld(carrierTile??row)));
  const initial=useRef(tileToWorld(carrierTile??row));
  const carried=!!row.carrier||row.mossCarrying, growing=row.stage==='growing', hidden=tick<row.hiddenUntil;
  useFrame((_,dt)=>{
    const g=root.current;if(!g)return;
    const owner=row.carrier?avatarGroup(row.carrier.toHexString()):row.mossCarrying?adventureActor(`moss-${row.id}`):null;
    if(owner){g.position.copy(owner.position);g.rotation.y=owner.rotation.y;g.position.x+=Math.sin(g.rotation.y)*.72;g.position.z+=Math.cos(g.rotation.y)*.72;g.position.y=.7;}
    else {const target=tileToWorld(carrierTile??row);last.current.set(...target);g.position.lerp(last.current,Math.min(1,dt*10));g.position.y=carried?.7:0;}
    if(fruit.current){const targetScale=growing?.8:carried?.7:1;const s=fruit.current.scale.x;fruit.current.scale.setScalar(s+(targetScale-s)*Math.min(1,dt*8));}
  });
  return <group ref={root} position={initial.current} onClick={e=>{if(e.delta>5)return;e.stopPropagation();openAdventure();}} userData={{hoverTarget:{title:growing?'Strange seed':'Giant berry',action:'Click to open this adventure',detail:growing?'Growing':carried?'Being carried':hidden?'Hidden under leaves':'Ready to haul',click:'panel',radius:.85}}}>
    <group ref={fruit}><AdventureAssetView asset={growing?'strange-seed':'giant-berry'}/></group>
    {hidden&&!growing&&<group position={[0,.75,0]}><AdventureAssetView asset="leaf-cover" scale={1.3}/></group>}
    <Html position={[0,growing?1.2:1.95,0]} center distanceFactor={14} zIndexRange={[3,0]} style={{pointerEvents:'none'}}><span className="adventure-world-label">{growing?'Strange seed':'Giant berry'} · {row.value}</span></Html>
  </group>;
}
export default function AdventureWorld() {
  const expeditions=useExpeditions(),players=usePlayers(),projects=useIslandProjects(),tick=useTick();
  const select=useUserInputStore((state:any)=>state.setClickedOtherObject);
  const built=(projects[0]?.wood??0)>=20&&(projects[0]?.obsidian??0)>=10;
  return <group>
    <AdventureActor asset="gardener" x={22} z={16} label="The gardener · Adventure"/>
    <Place asset="market" at={BERRY_MARKET} name="Berry market"/>
    <Place asset="feast" at={GIANT_FEAST} name="Giant’s feast"/>
    <Place asset={built?'workshop':'workshop-site'} at={{x:20,z:17}} name={built?'Camp workshop':'Build our workshop'}/>
    {built&&<group position={tileToWorld({x:19,z:18})} rotation={[0,.55,0]}><AdventureAssetView asset="handcart"/></group>}
    {expeditions.filter(e=>['growing','hauling'].includes(e.stage)).map(e=>{
      const carrier=e.carrier?players.find(p=>p.identity.toHexString()===e.carrier?.toHexString()):undefined;
      return <group key={String(e.id)}>
        <Cargo row={e} tick={tick} carrierTile={carrier}/>
        <AdventureActor asset="moss" x={e.mossX} z={e.mossZ} registryKey={`moss-${e.id}`} label={e.mossCarrying?'Moss · carrying':'Moss · porter'} mood={e.mossCarrying?'carry':'idle'}/>
        <AdventureActor asset="pip" x={e.pipX} z={e.pipZ} label={tick<e.pipUntil?'Pip · distracted':'Pip · hungry'} mood={tick<e.pipUntil?'happy':'sniff'} height={1.55}/>
        {e.stage==='hauling'&&<AdventureActor asset="berry-giant" x={e.giantX} z={e.giantZ} label={`Berry Giant · ${berryGiantMood(e,tick).label}`} mood={tick<e.giantUntil?'rest':'sniff'} height={4.75}
          hoverAction="Click to interact with the Berry Giant"
          onInteract={({clientX,clientY})=>select({connectionId:'Berry Giant',berryGiantExpeditionId:e.id,e:{clientX,clientY}})}/>}
        {tick<e.baitUntil&&<Place asset="scent-bait" at={{x:e.baitX,z:e.baitZ}} name="Scent bait"/>}
      </group>;
    })}
  </group>;
}
