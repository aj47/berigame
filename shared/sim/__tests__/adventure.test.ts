import { describe, expect, it, vi } from 'vitest';
import { adventureTables, testTable } from './adventureHarness';
import { canFindStick, cargoMovementSteps, duelHit, expeditionPayout, Feat, giantFriendship, hasTechnique, loadoutCount, rollDestination, techniqueUnlocked } from '../adventure';
import { Cosmetic, hasCosmetic } from '../skills';
import { INVENTORY_SIZE } from '../constants';
vi.mock('../../../spacetimedb/node_modules/spacetimedb/dist/server/index.mjs', () => ({ t: new Proxy({}, { get: () => () => ({}) }), SenderError: class SenderError extends Error {} }));
vi.mock('../../../spacetimedb/src/schema', () => ({ default: { reducer: (...args: unknown[]) => args.at(-1) } }));
import { expeditionAction, equipTechnique, duelAction, contributeProject, shareGarden } from '../../../spacetimedb/src/reducers/adventure';
import { tickExpeditions, tickDuels, profile, saveProfile, syncShowcase, finishExpedition } from '../../../spacetimedb/src/lib/adventure';
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
  const ripe = (destination = 'market') => { action('start', { destination }); tick = e().ripeTick + 3; tick -= tick % 3; tickExpeditions(ctx, tick); at(e().x, e().z); };
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
  it('adds the feast gift after cargo value is capped and reaches friendship milestones at 1, 3 and 5 feasts', () => {
    expect(expeditionPayout(4)).toBe(4);
    expect(expeditionPayout(4, true)).toBe(6);
    expect(expeditionPayout(100, true)).toBe(10);
    expect(giantFriendship(0)).toMatchObject({ tier: 0, pauseTicks: 0, pauseSeconds: 0, nextFeasts: 1 });
    expect(giantFriendship(1)).toMatchObject({ tier: 1, pauseTicks: 20, pauseSeconds: 12, nextFeasts: 3 });
    expect(giantFriendship(2)).toEqual(giantFriendship(1));
    expect(giantFriendship(3)).toMatchObject({ tier: 2, pauseTicks: 40, pauseSeconds: 24, nextFeasts: 5 });
    expect(giantFriendship(4)).toEqual(giantFriendship(3));
    expect(giantFriendship(5)).toMatchObject({ tier: 3, pauseTicks: 60, pauseSeconds: 36, nextFeasts: null });
    expect(giantFriendship(500)).toEqual(giantFriendship(5));
  });
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
    expect(before).toEqual([expect.objectContaining({ itemId: 'berry_goldberry', quantity: 6 })]);
    expect(hasCosmetic(h.db.playerCosmetic.identity.find(A).unlocked, Cosmetic.BerryHeart)).toBe(true);
    expect(h.db.playerCosmetic.identity.find(A).neck).toBe(Cosmetic.BerryHeart + 1);
    const beforeNotices = [...h.db.socialEvent.iter()];
    expect(beforeNotices[0].text).toContain('+6 goldberries · +35 Befriending completion XP');
    expect(beforeNotices[0].text).toContain('New friend: +12s head start · Berry Heart unlocked');
    expect(()=>h.action('feed')).toThrow('ended');
    finishExpedition(h.ctx, { ...h.e() }, h.now(), true, true);
    expect([...h.db.inventorySlot.iter()]).toEqual(before);
    expect([...h.db.socialEvent.iter()]).toEqual(beforeNotices);
    expect(profile(h.ctx,A).giantTrust).toBe(1);
    expect(h.db.islandProject.id.find(0).meals).toBe(1);
  });
  it('rewards every helper at a feast but gives idle members no berries, friendship or keepsake', () => {
    const h = harness(); h.ripe('feast'); h.action('take');
    h.ctx.sender = B; h.at(34,17,B); h.action('join');
    h.ctx.sender = C; h.at(34,17,C); h.action('join');
    h.ctx.sender = A; h.action('pass', { target: B });
    h.ctx.sender = B; h.at(12,36,B); h.action('feed');
    for (const identity of [A, B]) {
      expect(h.db.inventorySlot.owner.filter(identity)).toEqual([expect.objectContaining({ itemId: 'berry_goldberry', quantity: 6 })]);
      expect(profile(h.ctx,identity)).toMatchObject({ completions: 1, giantTrust: 1 });
      expect(hasCosmetic(h.db.playerCosmetic.identity.find(identity).unlocked, Cosmetic.BerryHeart)).toBe(true);
    }
    expect(h.db.inventorySlot.owner.filter(C)).toHaveLength(0);
    expect(profile(h.ctx,C)).toMatchObject({ completions: 0, giantTrust: 0, befriendingXp: 0 });
    expect(h.db.playerCosmetic.identity.find(C)).toBeUndefined();
    expect([...h.db.socialEvent.iter()]).toHaveLength(2);
  });
  it('keeps a worn necklace and celebrates at the feast even when the planned route was the drop-off', () => {
    const h = harness();
    h.db.playerCosmetic.insert({ identity: A, unlocked: 1 << Cosmetic.CoastScarf, head: 0, neck: Cosmetic.CoastScarf + 1 });
    h.ripe('market'); h.action('take'); h.at(12,36); h.action('feed');
    expect(h.e()).toMatchObject({ destination: 'feast', giantX: 12, giantZ: 36, giantUntil: h.now() + 100, untilTick: h.now() + 100 });
    expect(h.db.playerCosmetic.identity.find(A).neck).toBe(Cosmetic.CoastScarf + 1);
    expect(hasCosmetic(h.db.playerCosmetic.identity.find(A).unlocked, Cosmetic.BerryHeart)).toBe(true);
    tickExpeditions(h.ctx, Math.floor((h.e().untilTick - 1) / 3) * 3);
    expect(h.e().stage).toBe('complete');
    tickExpeditions(h.ctx, Math.ceil((h.e().untilTick + 1) / 3) * 3);
    expect(h.e()).toBeUndefined();
  });
  it('keeps drop-off rewards unchanged when a feast was planned', () => {
    const h = harness(); saveProfile(h.ctx, { ...profile(h.ctx,A), giantTrust: 2, completions: 2 });
    h.ripe('feast'); h.action('take'); h.at(35,37); h.action('deliver');
    expect(h.e()).toMatchObject({ stage: 'complete', destination: 'market' });
    expect(h.db.inventorySlot.owner.filter(A)).toEqual([expect.objectContaining({ itemId: 'berry_goldberry', quantity: 4 })]);
    expect(profile(h.ctx,A)).toMatchObject({ completions: 3, giantTrust: 2, exploringXp: 67, befriendingXp: 0 });
    expect(h.db.playerCosmetic.identity.find(A)).toBeUndefined();
    expect([...h.db.socialEvent.iter()][0].text).toBe('+4 goldberries · +35 Exploring completion XP');
  });
  it('adds the earned friendship pause automatically and stacks it with the equipped technique', () => {
    for (const giantTrust of [0, 1, 2, 3, 4, 5, 500]) for (const technique of [false, true]) {
      const h = harness();
      saveProfile(h.ctx, { ...profile(h.ctx,A), completions: 1, giantTrust, loadout: technique ? 1 << 14 : 0 });
      h.action('start');
      expect(h.e().giantUntil - h.now()).toBe(40 + giantFriendship(giantTrust).pauseTicks + (technique && giantTrust > 0 ? 50 : 0));
      expect(h.e().pipUntil - h.now()).toBe(35);
    }
  });
  it('keeps feast rewards on the ground when the bag is full and explains the overflow', () => {
    const h = harness(); h.ripe();
    for (let slot = 0; slot < INVENTORY_SIZE; slot++) h.db.inventorySlot.insert({ id: 0n, owner: A, slot, itemId: 'stick', quantity: 1 });
    h.action('take'); h.at(12,36); h.action('feed');
    expect(h.db.inventorySlot.owner.filter(A)).toHaveLength(INVENTORY_SIZE);
    expect([...h.db.groundItem.iter()]).toEqual([expect.objectContaining({ itemId: 'berry_goldberry', quantity: 6, x: 12, z: 36 })]);
    expect([...h.db.socialEvent.iter()][0].text).toContain('6 goldberries on the ground beside you');
    expect(profile(h.ctx,A).giantTrust).toBe(1);
  });
  it('does not grant feast rewards when cargo is lost', () => {
    const h = harness(); h.ripe('feast');
    tickExpeditions(h.ctx, Math.ceil(h.e().untilTick / 3) * 3);
    expect(h.e().stage).toBe('lost');
    expect(h.db.inventorySlot.owner.filter(A)).toHaveLength(0);
    expect(profile(h.ctx,A)).toMatchObject({ completions: 0, giantTrust: 0 });
    expect(h.db.playerCosmetic.identity.find(A)).toBeUndefined();
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
  it('awards the same feast bonus, friendship and keepsake when Moss delivers', () => {
    const h = harness(); h.ripe('feast');
    h.db.expedition.id.update({ ...h.e(), x: 12, z: 34, giantUntil: 9999, pipUntil: 9999 }); h.at(12,34); h.action('porter');
    expect(h.e().value).toBe(3); tickExpeditions(h.ctx,150); tickExpeditions(h.ctx,153);
    expect(h.e()).toMatchObject({ stage: 'complete', destination: 'feast', giantX: 12, giantZ: 36 });
    expect(h.db.inventorySlot.owner.filter(A)).toEqual([expect.objectContaining({ itemId: 'berry_goldberry', quantity: 5 })]);
    expect(profile(h.ctx,A)).toMatchObject({ giantTrust: 1, befriendingXp: 60 });
    expect(hasCosmetic(h.db.playerCosmetic.identity.find(A).unlocked, Cosmetic.BerryHeart)).toBe(true);
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
