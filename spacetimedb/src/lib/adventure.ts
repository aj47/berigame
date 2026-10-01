import type { Identity } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import { addXp, Cosmetic, hasCosmetic, PATH_FIELDS, type Tile, PlayerState, chebyshev, Feat, hasTechnique, BERRY_MARKET, GIANT_FEAST, ADVENTURE_CAMP, expeditionReward, rollDestination, worldBlockedSet, inSafeRing, swingDamage, duelHit, tileKey, bfsPath, goalIsTile } from '../../../shared/sim';
import type { Ctx } from './types';
import { sameId, clearInteractions } from './players';
import { giveItem, readSlots, writeSlots } from './inventory';
import { notify } from './social';
export type ExpeditionRow = NonNullable<ReturnType<Ctx['db']['expedition']['id']['find']>>;
export function profile(ctx: Ctx, id: Identity) {
  const existing = ctx.db.adventureProfile.identity.find(id);
  if (existing) return existing;
  const skills = ctx.db.playerSkill.identity.find(id);
  return { identity: id, growingXp: skills?.foragingXp ?? 0, buildingXp: skills?.craftingXp ?? 0, exploringXp: skills?.beachcombingXp ?? 0, fightingXp: 0, befriendingXp: 0, feats: (skills?.foragingXp ? Feat.Grow : 0) | (skills?.craftingXp ? Feat.Build : 0) | (skills?.beachcombingXp ? Feat.Explore : 0), loadout: 0, completions: 0, giantTrust: 0, stickClaimed: hasCosmetic(ctx.db.playerCosmetic.identity.find(id)?.unlocked ?? 0, Cosmetic.StrawHat) };
}
export function saveProfile(ctx: Ctx, p: ReturnType<typeof profile>) { if (ctx.db.adventureProfile.identity.find(p.identity)) ctx.db.adventureProfile.identity.update(p); else ctx.db.adventureProfile.insert(p); }
export function progress(ctx: Ctx, id: Identity, path: number, xp: number, feat = 0) {
  const p = profile(ctx, id), field = PATH_FIELDS[path];
  saveProfile(ctx, { ...p, [field]: addXp(p[field], xp), feats: p.feats | feat });
}
export function carrying(ctx: Ctx, id: Identity): boolean {
  const m = ctx.db.expeditionMember.identity.find(id);
  const e = m && ctx.db.expedition.id.find(m.expeditionId);
  return !!e && e.stage === 'hauling' && sameId(e.carrier, id);
}
export function spend(ctx: Ctx, id: Identity, itemId: string, quantity: number) {
  const snap = readSlots(ctx, id);
  if (snap.slots.reduce((n, s) => n + (s?.itemId === itemId ? s.quantity : 0), 0) < quantity) throw new SenderError(`Needs ${quantity} ${itemId.replaceAll('_', ' ')}`);
  let left = quantity;
  const after = snap.slots.map(s => { if (!s || s.itemId !== itemId || !left) return s; const take = Math.min(left, s.quantity); left -= take; return s.quantity > take ? { ...s, quantity: s.quantity - take } : null; });
  writeSlots(ctx, id, snap, after);
}
export function creditFor(ctx: Ctx, expeditionId: bigint, id: Identity) {
  const key = `${expeditionId}:${id.toHexString()}`;
  return ctx.db.expeditionCredit.key.find(key) ?? ctx.db.expeditionCredit.insert({ key, expeditionId, identity: id, contributions: 0, rewarded: false, tracked: false });
}
export function contribute(ctx: Ctx, id: Identity, path: number, feat: number, xp = 16) {
  const m = ctx.db.expeditionMember.identity.find(id);
  if (!m) return;
  const credit = creditFor(ctx, m.expeditionId, id);
  if (credit.contributions & feat) return;
  ctx.db.expeditionCredit.key.update({ ...credit, contributions: credit.contributions | feat });
  ctx.db.expeditionMember.identity.update({ ...m, contributions: credit.contributions | feat });
  progress(ctx, id, path, xp, feat);
}
export function finishExpedition(ctx: Ctx, e: ExpeditionRow, T: number, delivered: boolean, fed = false) {
  if (!['growing', 'hauling'].includes(e.stage)) return;
  e.stage = delivered ? 'complete' : 'lost'; e.carrier = undefined; e.mossCarrying = false; e.untilTick = T + 100;
  e.message = delivered ? (fed ? 'A feast to remember. The Giant will remember your kindness.' : 'Market delivery! Everyone who helped earned berries and progress.') : 'The cargo is gone. Your skills and bag are safe. Try another seed at camp.';
  for (const m of ctx.db.expeditionMember.expeditionId.filter(e.id)) {
    const credit = creditFor(ctx, e.id, m.identity);
    if (!delivered || !credit.contributions || credit.rewarded) continue;
    ctx.db.expeditionCredit.key.update({ ...credit, rewarded: true });
    const p = ctx.db.player.identity.find(m.identity); if (!p) continue;
    giveItem(ctx, p.identity, 'berry_goldberry', expeditionReward(e.value, true), p, T);
    progress(ctx, p.identity, fed ? 4 : 2, 35, fed ? Feat.Feed : Feat.Deliver);
    const pp = profile(ctx, p.identity);
    saveProfile(ctx, { ...pp, completions: pp.completions + 1, giantTrust: pp.giantTrust + (fed ? 1 : 0) });
    notify(ctx, p.identity, e.leader, 0, e.message);
  }
  if (delivered) {
    const project = ctx.db.islandProject.id.find(0) ?? { id: 0, wood: 0, obsidian: 0, meals: 0 };
    if (ctx.db.islandProject.id.find(0)) ctx.db.islandProject.id.update({ ...project, meals: Math.min(100000, project.meals + 1) });
    else ctx.db.islandProject.insert({ ...project, meals: 1 });
  }
  ctx.db.expedition.id.update(e);
}
export function syncShowcase(ctx: Ctx, id: Identity) {
  if (!ctx.db.gardenShowcase.identity.find(id)) return;
  const plants = [...ctx.db.gardenPlot.owner.filter(id)].map(r => ({ plot: r.plot, itemId: r.itemId, plantedAtMicros: r.plantedAtMicros.toString() }));
  ctx.db.gardenShowcase.identity.update({ identity: id, plants: JSON.stringify(plants) });
}
/** Fixed cadence NPC movement, clear ground only. No player HP or inventory is at risk. */
export function tickExpeditions(ctx: Ctx, T: number) {
  if (T % 3 !== 0) return;
  const blocked = worldBlockedSet(ctx.db.tree.iter());
  const step = (from: Tile, to: Tile, distance = 1) => { const path = bfsPath(from, goalIsTile(to), blocked, (_from, t) => t.x >= 9 && t.z >= 9 && t.x <= 41 && t.z <= 41); return path?.[Math.min(path.length, distance) - 1] ?? from; };
  for (const row of ctx.db.expedition.iter()) {
    const e = { ...row };
    if (e.stage === 'complete' || e.stage === 'lost') {
      if (T > e.untilTick) { for (const m of ctx.db.expeditionMember.expeditionId.filter(e.id)) ctx.db.expeditionMember.identity.delete(m.identity); for (const c of ctx.db.expeditionCredit.expeditionId.filter(e.id)) ctx.db.expeditionCredit.key.delete(c.key); ctx.db.expedition.id.delete(e.id); }
      continue;
    }
    if (T >= e.untilTick) { finishExpedition(ctx, e, T, false); continue; }
    if (e.stage === 'growing') {
      if (T >= e.ripeTick) { e.stage = 'hauling'; e.message = 'The berry is ripe! Carry it to market or make a feast at the western clearing.'; }
      else continue;
    }
    const members = [...ctx.db.expeditionMember.expeditionId.filter(e.id)];
    const present = members.map(m => ctx.db.player.identity.find(m.identity)).filter(p => p?.online && p.state === PlayerState.Alive);
    if (present.length) e.lastActiveTick = T;
    else if (T - e.lastActiveTick > 100) { finishExpedition(ctx, e, T, false); continue; }
    const carrier = e.carrier && ctx.db.player.identity.find(e.carrier);
    if (e.carrier) {
      if (!carrier?.online || carrier.state !== PlayerState.Alive) { e.carrier = undefined; e.message = 'The carrier left. The berry is safely on the ground.'; }
      else { e.x = carrier.x; e.z = carrier.z; e.hiddenUntil = 0; }
    }
    const leader = ctx.db.player.identity.find(e.porter ?? e.leader);
    const leaderProfile = profile(ctx, e.porter ?? e.leader);
    if (e.mossCarrying) {
      const target = hasTechnique(leaderProfile, 13) && leader?.online ? leader : e.destination === 'feast' ? GIANT_FEAST : BERRY_MARKET;
      const moss = step({ x: e.mossX, z: e.mossZ }, target, hasTechnique(leaderProfile, 5) ? 2 : 1);
      e.mossX = e.x = moss.x; e.mossZ = e.z = moss.z;
      if (T > e.giantUntil && chebyshev(moss, { x: e.giantX, z: e.giantZ }) <= 4) { e.mossCarrying = false; e.message = 'Moss got scared and dropped the berry. Distract the Giant, then pick it up!'; }
      if (chebyshev(moss, e.destination === 'feast' ? GIANT_FEAST : BERRY_MARKET) <= 1) { finishExpedition(ctx, e, T, true, e.destination === 'feast'); continue; }
    }
    if (T >= e.pipUntil && !e.carrier && !e.mossCarrying && T >= e.hiddenUntil) {
      const pip = step({ x: e.pipX, z: e.pipZ }, e); e.pipX = pip.x; e.pipZ = pip.z;
      if (chebyshev(pip, e) <= 1) { e.value = Math.max(0, e.value - 1); e.pipUntil = T + 45; e.pipX = 12; e.pipZ = 13; e.message = 'Pip pinched a bite! Bribe him with a berry or keep the cargo attended.'; }
    }
    if (T >= e.giantUntil && T >= e.hiddenUntil && present.length) {
      const target = T < e.baitUntil ? { x: e.baitX, z: e.baitZ } : e;
      const giant = step({ x: e.giantX, z: e.giantZ }, target, present.length >= 4 ? 2 : 1); e.giantX = giant.x; e.giantZ = giant.z;
      if (chebyshev(giant, e) <= 1 && T >= e.guardUntil && T >= e.baitUntil) {
        if (e.carrier) { const row = ctx.db.player.identity.find(e.carrier); if (row) { const p = { ...row }; clearInteractions(ctx, p); ctx.db.player.identity.update(p); } }
        e.value = Math.max(0, e.value - 1); e.carrier = undefined; e.mossCarrying = false; e.giantUntil = T + 30;
        e.message = 'The Giant took a bite and paused to chew. Grab the rest and run!';
      }
    }
    if (!e.value) { finishExpedition(ctx, e, T, false); continue; }
    if (JSON.stringify(row, (_, v) => typeof v === 'bigint' ? v.toString() : v) !== JSON.stringify(e, (_, v) => typeof v === 'bigint' ? v.toString() : v)) ctx.db.expedition.id.update(e);
  }
}
export function duelFor(ctx: Ctx, id: Identity) { return [...ctx.db.friendlyDuel.iter()].find(d => (d.stage === 'countdown' || d.stage === 'active') && (sameId(d.a, id) || sameId(d.b, id))); }
export function tickDuels(ctx: Ctx, T: number) {
  for (const row of ctx.db.friendlyDuel.iter()) {
    const d = { ...row }, a = ctx.db.player.identity.find(d.a), b = ctx.db.player.identity.find(d.b);
    if (d.stage === 'complete') { if (T > d.expiresTick) ctx.db.friendlyDuel.id.delete(d.id); continue; }
    if (T > d.expiresTick || !a?.online || !b?.online || a.state !== PlayerState.Alive || b.state !== PlayerState.Alive || chebyshev(a, b) > 12 || inSafeRing(a) || inSafeRing(b)) {
      ctx.db.friendlyDuel.id.update({ ...d, stage: 'complete', expiresTick: T + 50, result: 'Duel ended: a player left, entered safety, or time expired. No items lost.' }); continue;
    }
    if (d.stage === 'requested' || T < d.startsTick) continue;
    d.stage = 'active';
    if (T >= d.nextSwingTick && chebyshev(a, b) <= 1) {
      const attacker = d.turnA ? a : b, hit = duelHit(d.turnA ? d.bHp : d.aHp, swingDamage(attacker.weapon));
      if (d.turnA) d.bHp = hit.hp; else d.aHp = hit.hp;
      d.nextSwingTick = T + 4; d.turnA = !d.turnA;
      if (hit.finished) { d.stage = 'complete'; d.expiresTick = T + 50; d.result = `${attacker.name} wins the friendly duel. No health or items lost.`; progress(ctx, a.identity, 3, 8, Feat.Protect); progress(ctx, b.identity, 3, 8, Feat.Protect); }
    }
    ctx.db.friendlyDuel.id.update(d);
  }
}
