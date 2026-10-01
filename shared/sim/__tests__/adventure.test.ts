import { describe, expect, it, vi } from 'vitest';
import { adventureTables, testTable } from './adventureHarness';
import { canFindStick, cargoMovementSteps, duelHit, Feat, hasTechnique, loadoutCount, rollDestination, techniqueUnlocked } from '../adventure';
vi.mock('../../../spacetimedb/node_modules/spacetimedb/dist/server/index.mjs', () => ({ t: new Proxy({}, { get: () => () => ({}) }), SenderError: class SenderError extends Error {} }));
vi.mock('../../../spacetimedb/src/schema', () => ({ default: { reducer: (...args: unknown[]) => args.at(-1) } }));
import { expeditionAction, equipTechnique, duelAction, contributeProject, shareGarden } from '../../../spacetimedb/src/reducers/adventure';
import { tickExpeditions, tickDuels, profile, saveProfile, syncShowcase } from '../../../spacetimedb/src/lib/adventure';
import { wieldItem, attack } from '../../../spacetimedb/src/reducers/combat';
// The in-memory table adapter only needs this part of an Identity.
const id = (value: string) => ({ toHexString: () => value }) as Parameters<typeof profile>[1];
const A = id('a'), B = id('b'), C = id('c');
const call = (fn: unknown, ctx: any, args: any) => (fn as any)(ctx, args);
function harness() {
  let tick = 100;
  const db = { ...adventureTables(), playerGrant: testTable('identity'), player: testTable('identity'), tree: testTable(), inventorySlot: testTable('id', true), groundItem: testTable('id', true), socialEvent: testTable('id', true), gardenPlot: testTable('id', true),
    accessPolicy: { id: { find: () => ({ requireAdmission: false }) } }, world: { id: { find: () => ({ tick }) } } };
  const ctx: any = { db, sender: A, timestamp: { microsSinceUnixEpoch: 100000000n } };
  for (const identity of [A,B,C]) db.player.insert({ identity, name: identity.toHexString(), online: true, state: 0, x: 22, z: 18, hp: 20, maxHp: 30, respawnTick: 999, hostile: false, weapon: '', pending: 0, pendingId: 0n, harvestTreeId: 0, harvestEndTick: 0, lastInputTick: 0, inputsThisTick: 0 });
  const me = (identity = A) => db.player.identity.find(identity);
  const at = (x: number, z: number, identity = A) => db.player.identity.update({ ...me(identity), x, z });
  const advance = (n = 3) => { tick += n; return tick; };
  const action = (action: string, extra: any = {}) => { advance(); call(expeditionAction, ctx, { action, expeditionId: [...db.expedition.iter()].at(-1)?.id ?? 0n, target: undefined, x: 35, z: 37, destination: 'market', ...extra }); };
  const e = () => [...db.expedition.iter()].at(-1);
  const ripe = () => { action('start'); tick = e().ripeTick + 3; tick -= tick % 3; tickExpeditions(ctx, tick); at(e().x, e().z); };
  return { ctx, db, me, at, advance, action, e, ripe, now: () => tick };
}
describe('progression rules', () => {
  it('requires level 2, guarantees the first stick, then permits spare sticks at exactly 25%', () => {
    expect(canFindStick(1, false, 0)).toBe(false);
    expect(canFindStick(2, false, .99999)).toBe(true);
    expect(canFindStick(2, true, .2499)).toBe(true);
    expect(canFindStick(2, true, .25)).toBe(false);
    expect(cargoMovementSteps(true)).toBe(1);
  });
  it('requires both XP and a meaningful accomplishment, with three slots', () => {
    const p = { growingXp: 1000, buildingXp: 1000, exploringXp: 1000, fightingXp: 1000, befriendingXp: 1000, feats: 0, loadout: 7 };
    expect(techniqueUnlocked(p, 0)).toBe(false);
    expect(techniqueUnlocked({ ...p, feats: Feat.Grow }, 0)).toBe(true);
    expect(techniqueUnlocked({ ...p, feats: Feat.Grow }, 2)).toBe(false);
    expect(loadoutCount(p.loadout)).toBe(3);
    expect(hasTechnique(p, 2)).toBe(true);
    expect(duelHit(2,8)).toEqual({ hp:1, finished:true });
  });
  it('rolling stops at an obstruction instead of moving through it', () => { expect(rollDestination({x:10,z:10},{x:20,z:10},6,t=>t.x===13)).toEqual({x:12,z:10}); });
});
describe('authoritative expeditions', () => {
  it('lets newcomers learn their first delivery before NPCs pursue, then restores normal risk', () => {
    for (const completions of [0, 1]) {
      const h=harness(); saveProfile(h.ctx,{...profile(h.ctx,A),completions}); h.ripe();
      h.db.expedition.id.update({...h.e(),pipX:h.e().x,pipZ:h.e().z,giantX:h.e().x,giantZ:h.e().z});
      tickExpeditions(h.ctx,150);
      expect(h.e().value).toBe(completions === 0 ? 4 : 2);
      if (completions === 0) { tickExpeditions(h.ctx,198); expect(h.e().value).toBeLessThan(4); }
    }
  });
  it('requires camp, waits for growth, enforces membership and two hands', () => {
    const h=harness(); h.at(40,40); expect(()=>h.action('start')).toThrow('camp'); h.at(22,18); h.action('start'); expect(()=>h.action('take')).toThrow('growing');
    h.advance(40); tickExpeditions(h.ctx, 150); h.at(34,17); h.action('take');
    expect(h.e().carrier.toHexString()).toBe('a');
    expect(()=>call(wieldItem,h.ctx,{slot:0})).toThrow('both hands');
    h.ctx.sender=B; expect(()=>h.action('take')).toThrow('Join');
  });
  it('drops disconnected cargo where it was carried and lets a teammate recover it', () => {
    const h=harness(); h.ripe(); h.action('take'); h.at(33,21); tickExpeditions(h.ctx, 150);
    h.ctx.sender=B; h.at(33,21,B); h.action('join');
    h.db.player.identity.update({...h.me(),online:false}); tickExpeditions(h.ctx,153);
    expect(h.e().carrier).toBeUndefined(); h.action('take'); expect(h.e().carrier.toHexString()).toBe('b');
  });
  it('leaving and rejoining restores credit without repeating XP', () => {
    const h=harness(); h.ripe(); h.action('take'); h.action('put_down');
    const xp=profile(h.ctx,A).exploringXp;
    h.ctx.sender=B; h.at(h.e().x,h.e().z,B); h.action('join');
    h.ctx.sender=A; h.action('leave'); h.action('join'); h.action('take');
    expect(profile(h.ctx,A).exploringXp).toBe(xp);
  });
  it('finishes once, rewards participants and permanently remembers feeding', () => {
    const h=harness(); h.ripe(); h.action('take'); h.at(12,36); h.action('feed');
    expect(h.e().stage).toBe('complete'); expect(profile(h.ctx,A).giantTrust).toBe(1);
    expect(profile(h.ctx,A).completions).toBe(1); const before=[...h.db.inventorySlot.iter()];
    expect(()=>h.action('feed')).toThrow('ended'); expect([...h.db.inventorySlot.iter()]).toEqual(before);
  });
  it('Pip eats only cargo, while hiding and bribing defer him', () => {
    const h=harness(); h.ripe(); h.db.expedition.id.update({...h.e(),pipX:34,pipZ:17,pipUntil:0,giantUntil:9999});
    tickExpeditions(h.ctx,150); expect(h.e().value).toBe(3); expect(h.me().hp).toBe(20);
    h.action('hide'); const value=h.e().value; tickExpeditions(h.ctx,153); expect(h.e().value).toBe(value);
  });
  it('Moss can finish a solo delivery and charges a share', () => {
    const h=harness(); h.ripe(); h.db.expedition.id.update({...h.e(),x:35,z:35,giantUntil:9999,pipUntil:9999}); h.at(35,35); h.action('porter');
    expect(h.e().value).toBe(3); tickExpeditions(h.ctx,150); tickExpeditions(h.ctx,153); expect(h.e().stage).toBe('complete');
  });
  it('Moss drops cargo when frightened, without taking player items', () => {
    const h=harness(); h.ripe(); h.action('porter'); h.db.expedition.id.update({...h.e(),giantUntil:0,giantX:34,giantZ:20}); tickExpeditions(h.ctx,150); expect(h.e().mossCarrying).toBe(false); expect(h.me().hp).toBe(20);
  });
  it('rejects a fourth equipped technique and changes away from camp', () => {
    const h=harness(); const p=profile(h.ctx,A); saveProfile(h.ctx,{...p,growingXp:1000,buildingXp:1000,feats:127,loadout:7});
    expect(()=>call(equipTechnique,h.ctx,{technique:3})).toThrow('Three');
    call(equipTechnique,h.ctx,{technique:0}); call(equipTechnique,h.ctx,{technique:3}); expect(profile(h.ctx,A).loadout).toBe(14);
    h.at(34,17); expect(()=>call(equipTechnique,h.ctx,{technique:1})).toThrow('camp');
  });
  it('shared construction conserves inventory and improves future cargo', () => {
    const h=harness(); h.db.islandProject.insert({id:0,wood:20,obsidian:9,meals:0}); h.db.inventorySlot.insert({id:0n,owner:A,slot:0,itemId:'obsidian',quantity:1});
    call(contributeProject,h.ctx,{itemId:'obsidian'}); expect([...h.db.inventorySlot.iter()]).toHaveLength(0); expect(h.db.islandProject.id.find(0).obsidian).toBe(10);
    expect(()=>call(contributeProject,h.ctx,{itemId:'obsidian'})).toThrow('complete'); h.action('start'); expect(h.e().value).toBe(5);
  });
  it('garden sharing is opt-in, updates snapshots, and can be removed', () => {
    const h=harness(); h.db.gardenPlot.insert({id:0n,owner:A,plot:0,itemId:'berry_greenberry',plantedAtMicros:100n}); syncShowcase(h.ctx,A); expect([...h.db.gardenShowcase.iter()]).toHaveLength(0);
    call(shareGarden,h.ctx,{shared:true}); expect(h.db.gardenShowcase.identity.find(A).plants).toContain('berry_greenberry'); call(shareGarden,h.ctx,{shared:false}); expect([...h.db.gardenShowcase.iter()]).toHaveLength(0);
  });
});
describe('friendly duels', () => {
  it('requires the recipient to accept, then uses separate health and ends without inventory loss', () => {
    const h=harness(); h.at(30,30); h.at(31,30,B); call(duelAction,h.ctx,{action:'challenge',target:B});
    expect(()=>call(duelAction,h.ctx,{action:'accept',target:B})).toThrow('incoming'); h.ctx.sender=B; call(duelAction,h.ctx,{action:'accept',target:A});
    const d=()=>[...h.db.friendlyDuel.iter()][0]; expect(d().stage).toBe('countdown'); tickDuels(h.ctx,104); expect(d().aHp).toBe(30);
    expect(()=>call(attack,h.ctx,{target:A})).toThrow('friendly duel');
    for(let t=105;t<200;t+=4) tickDuels(h.ctx,t);
    expect(d().stage).toBe('complete'); expect(d().result).toContain('wins'); expect(h.me().hp).toBe(20); expect(h.me(B).hp).toBe(20);
  });
  it('surrender and disconnect safely finish the duel', () => {
    const h=harness(); h.at(30,30); h.at(31,30,B); call(duelAction,h.ctx,{action:'challenge',target:B}); h.ctx.sender=B; call(duelAction,h.ctx,{action:'accept',target:A}); call(duelAction,h.ctx,{action:'surrender',target:A}); expect([...h.db.friendlyDuel.iter()][0].result).toContain('surrendered');
  });
});
