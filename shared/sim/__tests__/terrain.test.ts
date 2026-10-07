import { describe, expect, it, vi } from 'vitest';
import { ADVENTURE_CAMP, BERRY_MARKET, BERRY_PATCH, GIANT_FEAST } from '../adventure';
import { areaOf, enterRule } from '../areas';
import { GRID_SIZE, SPAWN_TILE } from '../constants';
import { GARDEN_PLOT_TILES } from '../garden';
import { isLandTile, neighbors8, tileKey } from '../grid';
import { TREE_SEEDS } from '../items';
import { NODE_SEEDS } from '../nodes';
import { bfsPath, goalAdjacentTo, goalIsTile, reachableTiles } from '../pathfinding';
import { worldBlockedSet } from '../social';
import { BRIDGES, FOREST_TREES, GLADE_CLEARING, isBridge, LANDMARKS, SCENERY_BLOCKERS, TERRAIN_MAP, nearestDryTile } from '../terrain';
import { testTable } from './adventureHarness';
import { CLATTER_GLADE, inBossRect, inSpireFloor, spireStandable } from '../bossZones';
vi.mock('../../../spacetimedb/node_modules/spacetimedb/dist/server/index.mjs', () => ({ SenderError: class SenderError extends Error {} }));
import { reconcileTerrain } from '../../../spacetimedb/src/lib/terrain';
import { seedMissingNodes } from '../../../spacetimedb/src/lib/nodes';

const blocked=worldBlockedSet([...TREE_SEEDS,...NODE_SEEDS]);
describe('Bramblewild exploration',()=>{
  it('connects all dry land with no inaccessible islands or stranded resources',()=>{
    const seen=reachableTiles(SPAWN_TILE,blocked,enterRule(true,true));
    // The Sunken Spire's floor is sealed land: reached only through the Spire Gate (reducers teleport).
    for(let z=0;z<GRID_SIZE;z++)for(let x=0;x<GRID_SIZE;x++)if(isLandTile({x,z})&&!blocked.has(tileKey({x,z}))&&!inSpireFloor({x,z}))expect(seen.has(tileKey({x,z})),`${x},${z}`).toBe(true);
    for(const n of [...TREE_SEEDS,...NODE_SEEDS]){
      expect(isLandTile(n),`node ${n.id}`).toBe(true);
      expect(neighbors8(n).some(t=>seen.has(tileKey(t)))).toBe(true);
    }
  });
  it('keeps the Spire floor sealed land: area spire, unreachable from spawn, one standable component',()=>{
    const seen=reachableTiles(SPAWN_TILE,blocked,enterRule(true,true));
    const floor:{x:number;z:number}[]=[];
    for(let z=0;z<GRID_SIZE;z++)for(let x=0;x<GRID_SIZE;x++)if(inSpireFloor({x,z}))floor.push({x,z});
    expect(floor).toHaveLength(225);
    for(const t of floor){expect(isLandTile(t)).toBe(true);expect(areaOf(t)).toBe('spire');expect(seen.has(tileKey(t))).toBe(false);}
    const standable=floor.filter(t=>!blocked.has(tileKey(t)));
    expect(standable).toHaveLength(216);
    expect(standable.every(spireStandable)).toBe(true);
    const inside=reachableTiles(standable[0],blocked,undefined,inSpireFloor);
    expect(inside.size).toBe(216);
  });
  it("keeps forest trunks out of Clatterhorn's Glade and its camera-side margin",()=>{
    expect(GLADE_CLEARING.z1-CLATTER_GLADE.z1).toBeGreaterThanOrEqual(6);
    expect(GLADE_CLEARING.x1-CLATTER_GLADE.x1).toBeGreaterThanOrEqual(4);
    expect(FOREST_TREES.filter(t=>inBossRect(t,GLADE_CLEARING))).toEqual([]);
    // The pines that hid fighters at the south edge from the default camera.
    for (const t of [{x:82,z:115},{x:85,z:115},{x:85,z:117},{x:91,z:119}]) expect(SCENERY_BLOCKERS.some(b=>b.x===t.x&&b.z===t.z)).toBe(false);
  });
  it('keeps every novice destination and garden reachable without equipment',()=>{
    for(const t of [...LANDMARKS.filter(t=>t.access==='grove'),ADVENTURE_CAMP,BERRY_PATCH,BERRY_MARKET,GIANT_FEAST]){
      expect(areaOf(t)).toBe('grove');
      expect(bfsPath(SPAWN_TILE,goalIsTile(t),blocked,enterRule(false)),JSON.stringify(t)).not.toBeNull();
    }
    for(const t of GARDEN_PLOT_TILES)expect(bfsPath(SPAWN_TILE,goalAdjacentTo(t,blocked),blocked,enterRule(false))).not.toBeNull();
  });
  it('crosses each bridge while the other is closed, but never walks on river water',()=>{
    for(const bridge of BRIDGES){
      const closure=new Set(blocked);
      const other=BRIDGES.find(b=>b.id!==bridge.id)!;
      for(let x=other.x-3;x<=other.x+3;x++)closure.add(tileKey({x,z:other.z}));
      const path=bfsPath({x:bridge.x+4,z:bridge.z},goalIsTile({x:bridge.x-4,z:bridge.z}),closure,enterRule(true,true));
      expect(path,bridge.id).not.toBeNull();
      expect(path!.some(t=>t.z===bridge.z&&t.x===bridge.x)).toBe(true);
      expect(path!.every(isLandTile)).toBe(true);
    }
    expect(isLandTile({x:17,z:13})).toBe(false);
    expect(bfsPath(SPAWN_TILE,goalIsTile({x:17,z:13}),blocked,enterRule(true,true))).toBeNull();
  });
  it('keeps bridge decks clear of resource trees, garden beds and building footprints',()=>{
    for(const t of [...TREE_SEEDS,...GARDEN_PLOT_TILES,...SCENERY_BLOCKERS])expect(isBridge(t),JSON.stringify(t)).toBe(false);
  });
  it('exposes the same map to agents, including obstacle footprints and both bridges',()=>{
    expect(TERRAIN_MAP.rows).toHaveLength(GRID_SIZE);
    for(let z=0;z<GRID_SIZE;z++)for(let x=0;x<GRID_SIZE;x++)expect(TERRAIN_MAP.rows[z][x]!=='~').toBe(isLandTile({x,z}));
    expect(TERRAIN_MAP.legend).toContain('% the sealed Sunken Spire floor');
    for(const t of SCENERY_BLOCKERS)expect(blocked.has(tileKey(t))).toBe(true);
    for(const t of [{x:0,z:0},{x:17,z:13},{x:63,z:0}]){const at=nearestDryTile(t,blocked);expect(isLandTile(at)).toBe(true);expect(blocked.has(tileKey(at))).toBe(false);}
  });
});

describe('terrain upgrade preserves saved games',()=>{
  const make=()=>({db:{player:testTable('identity'),groundItem:testTable(),tree:testTable(),expedition:testTable()}} as any);
  it('moves online and offline players, their drops and active cargo off flooded tiles without resetting progress',()=>{
    const ctx=make();
    const id={toHexString:()=> 'saved-player'};
    const player={identity:id,x:0,z:0,online:false,hp:17,weapon:'stick',targetX:5,targetZ:5,pending:1,pendingId:2n,harvestTreeId:0,harvestEndTick:0};
    ctx.db.player.insert(player);
    ctx.db.groundItem.insert({id:1n,x:17,z:13,quantity:7,itemId:'obsidian',droppedBy:id,expiresTick:999});
    ctx.db.expedition.insert({id:3n,x:17,z:13,mossX:21,mossZ:14,pipX:25,pipZ:25,giantX:30,giantZ:32,baitX:17,baitZ:13,value:6,stage:'carrying',untilTick:1234});
    reconcileTerrain(ctx);
    const p=ctx.db.player.identity.find(id),g=ctx.db.groundItem.id.find(1n),e=ctx.db.expedition.id.find(3n);
    expect(isLandTile(p)).toBe(true);expect(p).toMatchObject({online:false,hp:17,weapon:'stick',pending:0,targetX:undefined});
    expect(isLandTile(g)).toBe(true);expect(g).toMatchObject({quantity:7,itemId:'obsidian',expiresTick:999,droppedBy:id});
    expect(isLandTile(e)).toBe(true);expect(blocked.has(tileKey({x:e.mossX,z:e.mossZ}))).toBe(false);expect(e).toMatchObject({value:6,stage:'carrying',untilTick:1234});
    reconcileTerrain(ctx);expect(ctx.db.player.identity.find(id)).toEqual(p);expect(ctx.db.groundItem.id.find(1n)).toEqual(g);
  });
  it('relocates old tide rocks by stable id and preserves their cooldowns and claims',()=>{
    const ctx=make(),harvester={toHexString:()=> 'gatherer'};
    ctx.db.tree.insert({id:105,x:3,z:3,kind:2,itemId:'flint',cooldownUntilTick:777,harvester});
    seedMissingNodes(ctx);
    const moved=ctx.db.tree.id.find(105);
    expect(moved).toMatchObject({x:12,z:6,cooldownUntilTick:777,harvester,itemId:'flint'});
    expect(seedMissingNodes(ctx)).toEqual([]);expect(ctx.db.tree.rows.size).toBe(NODE_SEEDS.length);
  });
});
