import { openSettlement } from "../../frontier/navigation";
import React, { useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Group, Vector3 } from 'three';
import { BERRY_MARKET, GIANT_FEAST, tileToWorld } from '@sim';
import { useExpeditions, useIslandProjects, usePlayers, useTick } from '../../spacetime/hooks';
import type { Expedition } from '../../module_bindings/types';
import { avatarGroup } from '../../animation/avatarRegistry';
import { adventureInteractionLabel, openAdventureInteraction } from './adventureInteraction';
import type { AdventureView } from '../adventureNavigation';
import { AdventureActor, AdventureAssetView, adventureActor, type AdventureAsset } from './AdventureModels';
import { useUserInputStore } from '../../store';
import { berryGiantMood } from '../berryGiantUi';

// A presentation offset keeps the waiting Giant's feet clear of the feast table.
const FEAST_GIANT = { x: GIANT_FEAST.x, z: GIANT_FEAST.z - 2.5 };

function Place({asset,at,name,view='expedition'}: {asset:AdventureAsset;at:{x:number;z:number};name:string;view?:AdventureView}) {
  return <group position={tileToWorld(at)} onClick={e=>{if(e.delta>5)return;e.stopPropagation();openAdventureInteraction(name,e,view);}} userData={{hoverTarget:{title:name,action:adventureInteractionLabel(view),radius:asset==='market'?1.6:1.1}}}>
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
  return <group ref={root} position={initial.current} onClick={e=>{if(e.delta>5)return;e.stopPropagation();openAdventureInteraction(growing?'Strange seed':'Giant berry',e);}} userData={{hoverTarget:{title:growing?'Strange seed':'Giant berry',action:adventureInteractionLabel('expedition'),detail:growing?'Growing':carried?'Being carried':hidden?'Hidden under leaves':'Ready to haul',radius:.85}}}>
    <group ref={fruit}><AdventureAssetView asset={growing?'strange-seed':'giant-berry'}/></group>
    {hidden&&!growing&&<group position={[0,.75,0]}><AdventureAssetView asset="leaf-cover" scale={1.3}/></group>}
    <Html position={[0,growing?1.2:1.95,0]} center distanceFactor={14} zIndexRange={[3,0]} style={{pointerEvents:'none'}}><span className="adventure-world-label">{growing?'Strange seed':'Giant berry'} · {row.value}</span></Html>
  </group>;
}
export default function AdventureWorld({ frontierEnabled = false }: { frontierEnabled?: boolean }) {
  const expeditions=useExpeditions(),players=usePlayers(),projects=useIslandProjects(),tick=useTick();
  const select=useUserInputStore((state:any)=>state.setClickedOtherObject);
  const built=(projects[0]?.wood??0)>=20&&(projects[0]?.obsidian??0)>=10;
  const giants=expeditions.filter(e=>e.stage==='hauling'||(e.stage==='complete'&&e.destination==='feast'&&tick<=e.untilTick));
  return <group>
    {frontierEnabled && <group position={tileToWorld({x:24,z:18})} onClick={e=>{e.stopPropagation();openSettlement();}}>
      <mesh position={[0,.6,0]}><boxGeometry args={[.15,1.2,.15]}/><meshStandardMaterial color="#8b6c46"/></mesh>
      <mesh position={[0,1.1,0]}><boxGeometry args={[1.5,.5,.15]}/><meshStandardMaterial color="#c4a576"/></mesh>
      <Html position={[0,1.8,0]} center zIndexRange={[3,0]}><button className="frontier-world-action" onClick={e=>{e.stopPropagation();openSettlement();}}>Meadows trail →</button></Html>
    </group>}
    <AdventureActor asset="gardener" x={22} z={16} label="The gardener · Plant a giant berry"/>
    <Place asset="market" at={BERRY_MARKET} name="Berry drop-off" view="market"/>
    <Place asset="feast" at={GIANT_FEAST} name="Giant’s feast" view="feast"/>
    {!giants.length&&<AdventureActor asset="berry-giant" x={FEAST_GIANT.x} z={FEAST_GIANT.z} label="Berry Giant · hungry" speech="Bring me a giant berry!" height={4.75}
      hoverAction="Feed a giant berry"
      onInteract={event=>select({connectionId:'Berry Giant',berryGiantExpeditionId:0n,e:event})}/>}
    <Place asset={built?'workshop':'workshop-site'} at={{x:20,z:17}} name={built?'Camp workshop':'Build our workshop'} view="workshop"/>
    {built&&<group position={tileToWorld({x:19,z:18})} rotation={[0,.55,0]}><AdventureAssetView asset="handcart"/></group>}
    {expeditions.filter(e=>['growing','hauling'].includes(e.stage)).map(e=>{
      const carrier=e.carrier?players.find(p=>p.identity.toHexString()===e.carrier?.toHexString()):undefined;
      return <group key={String(e.id)}>
        <Cargo row={e} tick={tick} carrierTile={carrier}/>
        <AdventureActor asset="moss" x={e.mossX} z={e.mossZ} registryKey={`moss-${e.id}`} label={e.mossCarrying?'Moss · carrying':'Moss · porter'} mood={e.mossCarrying?'carry':'idle'}/>
        <AdventureActor asset="pip" x={e.pipX} z={e.pipZ} label={tick<e.pipUntil?'Pip · distracted':'Pip · hungry'} mood={tick<e.pipUntil?'happy':'sniff'} height={1.55}/>
        {tick<e.baitUntil&&<Place asset="scent-bait" at={{x:e.baitX,z:e.baitZ}} name="Scent bait"/>}
      </group>;
    })}
    {giants.map(e=>{
      const fed=e.stage==='complete',mood=berryGiantMood(e,tick);
      return <AdventureActor key={`giant-${e.id}`} asset="berry-giant" x={fed?FEAST_GIANT.x:e.giantX} z={fed?FEAST_GIANT.z:e.giantZ}
        label={`Berry Giant · ${fed?'berry happy':mood.label}`} speech={fed?'Thank you, berry friend!':mood.speech}
        mood={fed?'happy':tick<e.giantUntil?'rest':'sniff'} height={4.75} hoverAction={fed?'Meet your berry friend':'Feed a giant berry'}
        onInteract={event=>select({connectionId:'Berry Giant',berryGiantExpeditionId:e.id,e:event})}/>;
    })}
  </group>;
}
