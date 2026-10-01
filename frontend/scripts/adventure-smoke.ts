/** End-to-end progression, cargo, reconnect and consent checks on an isolated local world. */
import assert from 'node:assert/strict';
import { DbConnection, tables } from '../src/module_bindings';
import { levelForXp, chebyshev } from '../../shared/sim';
const uri=process.env.SPACETIME_URI??'ws://127.0.0.1:3101', database=process.env.SPACETIME_DB??'adventure-validation-v2';
function connect(token?:string):Promise<{conn:DbConnection;identity:any;token:string}> {return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('connect timeout')),10000);
  DbConnection.builder().withUri(uri).withDatabaseName(database).withToken(token).onConnectError((_c,e)=>{clearTimeout(timer);reject(e)}).onConnect((conn,identity,token)=>{
    conn.subscriptionBuilder().onApplied(()=>{clearTimeout(timer);resolve({conn,identity,token})}).onError((_c,e)=>reject(e)).subscribe([tables.world,tables.player,tables.inventorySlot,tables.tree,tables.playerSkill,tables.adventureProfile,tables.expedition,tables.expeditionMember,tables.islandProject,tables.friendlyDuel,tables.gardenPlot,tables.gardenShowcase]);
  }).build();
});}
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function wait(label:string,pred:()=>boolean,ms=18000){const end=Date.now()+ms;while(Date.now()<end){if(pred())return;await delay(120)}throw new Error(`timeout: ${label}`)}
async function main(){
const a=await connect(),b=await connect();
const me=(c:typeof a)=>c.conn.db.player.identity.find(c.identity)!;
const move=async(c:typeof a,x:number,z:number)=>{await c.conn.reducers.setTarget({x,z});await wait('move',()=>chebyshev(me(c),{x,z})<=1)};
try{
 await a.conn.reducers.setName({name:'TEST A '+a.identity.toHexString().slice(-4)});await b.conn.reducers.setName({name:'TEST B '+b.identity.toHexString().slice(-4)});
 for(const [i,treeId]of [4,2,3,5].entries()){
  const xp=a.conn.db.playerSkill.identity.find(a.identity)?.foragingXp??0;
  await a.conn.reducers.startHarvest({treeId});await wait('harvest',()=> (a.conn.db.playerSkill.identity.find(a.identity)?.foragingXp??0)>xp,45000);
  const sticks=[...a.conn.db.inventorySlot.iter()].filter(r=>r.itemId==='stick');
  assert.equal(sticks.length,i===3?1:0,`stick milestone at harvest ${i+1}`);
 }
 assert.equal(levelForXp(a.conn.db.playerSkill.identity.find(a.identity)!.foragingXp),2);
 console.log('PASS: first three harvests have no stick; fourth guarantees one.');
 await move(a,22,18);
 const act=async(action:string,expeditionId=0n,extra:any={})=>a.conn.reducers.expeditionAction({action,expeditionId,target:undefined,x:35,z:37,destination:'market',...extra});
 await act('start');const e=()=>[...a.conn.db.expedition.iter()].find(e=>e.leader.toHexString()===a.identity.toHexString())!;
 await move(a,e().x,e().z);await wait('ripe',()=>e().stage==='hauling',25000);await act('take',e().id);
 await assert.rejects(()=>a.conn.reducers.wieldItem({slot:0}),/both hands/);
 for (let attempt=0;attempt<4;attempt++) {
   await a.conn.reducers.setTarget({x:35,z:37});
   await wait('cargo travel or Giant bite',()=>!e().carrier || chebyshev(me(a),{x:35,z:37})<=1);
   if(e().carrier)break;
   await move(a,e().x,e().z);await act('take',e().id);
 }
 await act('deliver',e().id);assert.equal(e().stage,'complete');assert.equal(a.conn.db.adventureProfile.identity.find(a.identity)!.completions,1);
 console.log('PASS: live solo expedition grows, carries with two hands, and rewards once.');
 const savedToken=a.token,id=a.identity.toHexString(),xp=a.conn.db.adventureProfile.identity.find(a.identity)!.exploringXp;
 a.conn.disconnect();await delay(800);const returned=await connect(savedToken);a.conn=returned.conn;
 assert.equal(returned.identity.toHexString(),id);assert.equal(a.conn.db.adventureProfile.identity.find(a.identity)!.exploringXp,xp);
 console.log('PASS: reconnect preserves character and expedition progression.');
 await move(a,30,30);await move(b,31,30);
 const hpA=me(a).hp,hpB=me(b).hp;
 await a.conn.reducers.duelAction({action:'challenge',target:b.identity});
 await b.conn.reducers.duelAction({action:'accept',target:a.identity});
 await wait('duel begins',()=>[...a.conn.db.friendlyDuel.iter()].some(d=>d.stage==='active'),8000);
 await assert.rejects(()=>a.conn.reducers.attack({target:b.identity}),/friendly duel/);
 await b.conn.reducers.duelAction({action:'surrender',target:a.identity});
 await wait('surrender result',()=>[...a.conn.db.friendlyDuel.iter()].some(d=>d.stage==='complete'&&d.result.includes('surrendered')));
 assert.equal(me(a).hp,hpA);assert.equal(me(b).hp,hpB);
 console.log('PASS: mutual countdown, ordinary combat isolation, surrender, and health preservation.');
 await a.conn.reducers.shareGarden({shared:true});assert.ok(a.conn.db.gardenShowcase.identity.find(a.identity));await a.conn.reducers.shareGarden({shared:false});assert.ok(!a.conn.db.gardenShowcase.identity.find(a.identity));
 console.log('PASS: garden sharing can be enabled and removed.');
}finally{a.conn.disconnect();b.conn.disconnect()}

}
main().catch(error=>{ console.error(error); process.exitCode=1; });
