import { SenderError, t } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { ADVENTURE_CAMP, ADVENTURE_TICKS, BERRY_PATCH, BERRY_MARKET, GIANT_FEAST, EXPEDITION_ACTIONS, PlayerState, chebyshev, hasTechnique, giantFriendship, techniqueUnlocked, loadoutCount, Feat, rollDestination, worldBlockedSet, tileKey, inSafeRing, SWING_INTERVAL_TICKS } from '../../../shared/sim';
import { requireAlivePlayer, currentTick, touchInput, savePlayer, clearInteractions, sameId } from '../lib/players';
import { profile, saveProfile, progress, contribute, creditFor, carrying, spend, finishExpedition, syncShowcase, duelFor } from '../lib/adventure';
import { giveItem } from '../lib/inventory';
import { requireCapability } from '../lib/access';

export const equipTechnique = spacetimedb.reducer({ technique: t.u8() }, (ctx, { technique }) => {
  const p = requireAlivePlayer(ctx); touchInput(p, currentTick(ctx));
  if (chebyshev(p, ADVENTURE_CAMP) > 4 || p.hostile || carrying(ctx, p.identity) || duelFor(ctx, p.identity)) throw new SenderError('Change techniques at camp, with your hands free and outside combat');
  const pp = profile(ctx, p.identity), bit = 1 << technique;
  if (!techniqueUnlocked(pp, technique)) throw new SenderError('Earn the path level and milestone shown in Skills first');
  const next = pp.loadout ^ bit;
  if (loadoutCount(next) > 3) throw new SenderError('Three techniques at once. Unequip one first.');
  saveProfile(ctx, { ...pp, loadout: next }); savePlayer(ctx, p);
});

export const expeditionAction = spacetimedb.reducer({ action: t.string(), expeditionId: t.u64(), target: t.option(t.identity()), x: t.i32(), z: t.i32(), destination: t.string() }, (ctx, input) => {
  const { action, expeditionId, target, x, z, destination } = input;
  if (!(EXPEDITION_ACTIONS as readonly string[]).includes(action)) throw new SenderError('Unknown expedition action');
  const p = requireAlivePlayer(ctx), T = currentTick(ctx); touchInput(p, T);
  if (p.hostile || duelFor(ctx, p.identity)) throw new SenderError('Finish combat before tending expedition cargo');
  const pp = profile(ctx, p.identity), previous = ctx.db.expeditionMember.identity.find(p.identity);
  const old = previous && ctx.db.expedition.id.find(previous.expeditionId);
  if (action === 'start' || action === 'join') {
    if (old && ['growing', 'hauling'].includes(old.stage)) throw new SenderError('Finish or leave your current expedition first');
    if (action === 'start' && chebyshev(p, ADVENTURE_CAMP) > 4) throw new SenderError('Visit the gardener at camp (22,18) to plant an expedition seed');
    let id = expeditionId;
    if (action === 'start') {
      if ([...ctx.db.expedition.iter()].filter(e => ['growing', 'hauling'].includes(e.stage)).length >= 4) throw new SenderError('Four expeditions are underway. Join one of them.');
      if (!['market', 'feast'].includes(destination)) throw new SenderError('Choose market or feast');
      const workshop = ctx.db.islandProject.id.find(0);
      const bonus = workshop && workshop.wood >= 20 && workshop.obsidian >= 10 ? 1 : 0;
      const firstDeliveryGrace = pp.completions === 0 ? 50 : 0;
      const e = ctx.db.expedition.insert({ id: 0n, leader: p.identity, stage: 'growing', startedTick: T, untilTick: T + ADVENTURE_TICKS, ripeTick: T + (hasTechnique(pp, 0) ? 10 : 30),
        x: BERRY_PATCH.x, z: BERRY_PATCH.z, carrier: undefined, mossCarrying: false, mossPaid: false, porter: undefined, lastActiveTick: T, value: (hasTechnique(pp, 2) ? 6 : 4) + bonus, split: false,
        mossX: BERRY_PATCH.x + 1, mossZ: BERRY_PATCH.z, pipX: 36, pipZ: 20, giantX: 36, giantZ: 29,
        hiddenUntil: 0, pipUntil: T + 35 + firstDeliveryGrace, giantUntil: T + (hasTechnique(pp, 2) ? 30 : 40) + firstDeliveryGrace + giantFriendship(pp.giantTrust).pauseTicks + (hasTechnique(pp, 14) && pp.giantTrust ? 50 : 0), baitX: 0, baitZ: 0, baitUntil: 0, guardUntil: 0,
        message: `The gardener planted your seed at (34,17). Walk there while it grows.${firstDeliveryGrace ? ' First delivery: Pip and the Giant wait 30 extra seconds before chasing.' : ''}`, destination });
      id = e.id;
    } else {
      const e = ctx.db.expedition.id.find(id);
      if (!e || !['growing', 'hauling'].includes(e.stage)) throw new SenderError('That expedition is over');
      if (chebyshev(p, ADVENTURE_CAMP) > 4 && chebyshev(p, e) > 4) throw new SenderError('Join from camp or within four tiles of the berry');
    }
    const credit = creditFor(ctx, id, p.identity);
    if (action === 'start') ctx.db.expeditionCredit.key.update({ ...credit, contributions: Feat.Grow });
    const m = { identity: p.identity, expeditionId: id, contributions: action === 'start' ? Feat.Grow : credit.contributions, cooldown: 0, tracked: credit.tracked };
    if (previous) ctx.db.expeditionMember.identity.update(m); else ctx.db.expeditionMember.insert(m);
    if (action === 'start' && !(pp.feats & Feat.Grow)) progress(ctx, p.identity, 0, 8, Feat.Grow);
    clearInteractions(ctx, p); savePlayer(ctx, p); return;
  }
  const m = ctx.db.expeditionMember.identity.find(p.identity);
  if (!m || !old || old.id !== expeditionId) throw new SenderError('Join that expedition first');
  const e = { ...old };
  if (action === 'leave') {
    if (sameId(e.carrier, p.identity)) { e.x = p.x; e.z = p.z; e.carrier = undefined; ctx.db.expedition.id.update(e); }
    ctx.db.expeditionMember.identity.delete(p.identity);
    if (![...ctx.db.expeditionMember.expeditionId.filter(e.id)].length) finishExpedition(ctx, e, T, false);
    savePlayer(ctx, p); return;
  }
  if (e.stage !== 'hauling') throw new SenderError(e.stage === 'growing' ? 'The berry is still growing. It will ripen shortly.' : 'This expedition has ended');
  const carrier = e.carrier && ctx.db.player.identity.find(e.carrier);
  if (carrier) { e.x = carrier.x; e.z = carrier.z; }
  const mine = sameId(e.carrier, p.identity);
  if (m.cooldown > T) throw new SenderError(`Catch your breath: ${Math.ceil((m.cooldown - T) * .6)} seconds`);
  const nearby = () => { if (chebyshev(p, e) > 2) throw new SenderError(`Walk within two tiles of the berry (${e.x},${e.z})`); };
  const grounded = () => { nearby(); if (e.carrier || e.mossCarrying) throw new SenderError('Put the berry down first'); };
  const technique = (id: number) => { if (!hasTechnique(pp, id)) throw new SenderError('Equip that technique at camp first'); };
  let cooldown = 2;
  switch (action) {
    case 'take': grounded(); clearInteractions(ctx, p); p.weapon = ''; e.carrier = p.identity; e.hiddenUntil = 0; contribute(ctx, p.identity, 2, Feat.Explore); e.message = `${p.name} carries the berry with both hands. Move, pass, or put it down.`; break;
    case 'put_down': if (!mine) throw new SenderError('You are not carrying the berry'); e.carrier = undefined; e.message = `${p.name} put the berry down.`; break;
    case 'pass': {
      if (!mine) throw new SenderError('Pick up the berry before passing it');
      const to = target && ctx.db.player.identity.find(target), tm = target && ctx.db.expeditionMember.identity.find(target);
      if (!to?.online || to.state !== PlayerState.Alive || sameId(to.identity, p.identity) || !tm || tm.expeditionId !== e.id || chebyshev(p, to) > 2 || to.hostile || duelFor(ctx, to.identity)) throw new SenderError('Pass to a nearby, free teammate in this expedition');
      const next = { ...to }; clearInteractions(ctx, next); next.weapon = ''; savePlayer(ctx, next);
      e.carrier = next.identity; e.x = next.x; e.z = next.z; contribute(ctx, p.identity, 4, Feat.Befriend); contribute(ctx, next.identity, 2, Feat.Explore); e.message = `${p.name} passed the berry to ${next.name}.`; break;
    }
    case 'roll': {
      nearby(); if (e.carrier && !mine || e.mossCarrying) throw new SenderError('The carrier must put it down or roll it');
      const blocked = worldBlockedSet(ctx.db.tree.iter());
      const to = rollDestination(e, { x, z }, hasTechnique(pp, 7) ? 6 : 3, t => t.x < 9 || t.z < 9 || t.x > 41 || t.z > 41 || blocked.has(tileKey(t)));
      if (to.x === e.x && to.z === e.z) throw new SenderError('Choose clear ground to roll toward');
      if (hasTechnique(pp, 8)) { e.baitX = e.x; e.baitZ = e.z; e.baitUntil = T + 25; }
      e.carrier = undefined; e.x = to.x; e.z = to.z; e.hiddenUntil = 0; contribute(ctx, p.identity, 2, Feat.Explore); e.message = 'The berry rolls! Grab it before Pip does.'; cooldown = 5; break;
    }
    case 'hide': grounded(); e.hiddenUntil = T + (hasTechnique(pp, 1) ? 50 : 15); e.message = 'Leaves hide the berry scent. Picking it up reveals it.'; cooldown = 25; contribute(ctx, p.identity, 0, Feat.Grow); break;
    case 'split': nearby(); if (e.split) throw new SenderError('This berry has already been split once'); if (e.carrier && !mine || e.mossCarrying) throw new SenderError('Ask the carrier to put it down'); e.split = true; if (!hasTechnique(pp, 3)) e.value = Math.max(1, e.value - 1); giveItem(ctx, p.identity, 'berry_mash', 2, p, T); contribute(ctx, p.identity, 1, Feat.Build); e.message = 'Two portions of berry mash, ready to eat or share.'; break;
    case 'bait': if (mine) throw new SenderError('Put the berry down to prepare bait'); if (hasTechnique(pp, 4)) spend(ctx, p.identity, 'driftwood', 1); else spend(ctx, p.identity, 'berry_greenberry', 1); e.baitX = p.x; e.baitZ = p.z; e.baitUntil = T + (hasTechnique(pp, 4) ? 50 : 25); contribute(ctx, p.identity, 1, Feat.Build); cooldown = 20; e.message = 'The Giant follows the bait scent. Move the cargo away!'; break;
    case 'bribe': if (chebyshev(p, { x: e.pipX, z: e.pipZ }) > 3) throw new SenderError(`Walk near Pip (${e.pipX},${e.pipZ})`); spend(ctx, p.identity, 'berry_greenberry', 1); e.pipUntil = T + (hasTechnique(pp, 12) ? 150 : 50); contribute(ctx, p.identity, 4, Feat.Befriend, 25); e.message = 'Pip accepts your greenberry and promises to leave this cargo alone for a while.'; break;
    case 'porter': grounded(); if (!e.mossPaid && !hasTechnique(pp, 13)) e.value = Math.max(1, e.value - 1); e.mossPaid = true; e.porter = p.identity; e.mossCarrying = true; e.mossX = e.x; e.mossZ = e.z; contribute(ctx, p.identity, 4, Feat.Befriend, 25); e.message = 'Moss takes the berry. He will drop it if the Giant gets too close.'; break;
    case 'deliver': case 'feed': {
      nearby(); const place = action === 'feed' ? GIANT_FEAST : BERRY_MARKET;
      if (chebyshev(e, place) > 2) throw new SenderError(`Bring the berry to ${action === 'feed' ? 'the feast clearing' : 'market'} (${place.x},${place.z})`);
      if (e.carrier && !mine) throw new SenderError('The carrier must finish the delivery');
      contribute(ctx, p.identity, action === 'feed' ? 4 : 2, action === 'feed' ? Feat.Feed : Feat.Deliver);
      finishExpedition(ctx, e, T, true, action === 'feed'); savePlayer(ctx, p); return;
    }
    case 'track': technique(6); if (m.tracked) throw new SenderError('You already found this expedition seed cache'); if (chebyshev(p, { x: 14, z: 15 }) > 2) throw new SenderError('Fresh tracks lead to the hidden seed cache at (14,15)'); giveItem(ctx, p.identity, 'berry_goldberry', 1, p, T); progress(ctx, p.identity, 2, 25, Feat.Explore); ctx.db.expeditionMember.identity.update({ ...m, tracked: true }); ctx.db.expeditionCredit.key.update({ ...creditFor(ctx, e.id, p.identity), tracked: true }); break;
    case 'brace': technique(9); grounded(); e.guardUntil = T + 20; contribute(ctx, p.identity, 3, Feat.Protect); cooldown = 40; e.message = `${p.name} braces beside the cargo. The Giant cannot bite it for 12 seconds.`; break;
    case 'shove': technique(10); if (mine) throw new SenderError('Put down the berry first'); if (chebyshev(p, { x: e.pipX, z: e.pipZ }) > 3) throw new SenderError('Walk within three tiles of Pip'); e.pipX = 12; e.pipZ = 13; e.pipUntil = T + 40; contribute(ctx, p.identity, 3, Feat.Protect); cooldown = 40; e.message = 'Pip scampers away!'; break;
    case 'interrupt': technique(11); if (mine) throw new SenderError('Put down the berry first'); if (chebyshev(p, { x: e.giantX, z: e.giantZ }) > 3) throw new SenderError('Walk within three tiles of the Giant'); e.giantUntil = T + 15; contribute(ctx, p.identity, 3, Feat.Protect); cooldown = 50; e.message = 'The Giant is startled. You have nine seconds to escape.'; break;
  }
  const latest = ctx.db.expeditionMember.identity.find(p.identity)!;
  ctx.db.expeditionMember.identity.update({ ...latest, cooldown: T + cooldown });
  ctx.db.expedition.id.update(e); savePlayer(ctx, p);
});

export const contributeProject = spacetimedb.reducer({ itemId: t.string() }, (ctx, { itemId }) => {
  const p = requireAlivePlayer(ctx); touchInput(p, currentTick(ctx));
  if (chebyshev(p, ADVENTURE_CAMP) > 4) throw new SenderError('Contribute at the gardener camp (22,18)');
  if (!['driftwood', 'obsidian'].includes(itemId)) throw new SenderError('The camp needs driftwood or obsidian');
  const row = ctx.db.islandProject.id.find(0) ?? { id: 0, wood: 0, obsidian: 0, meals: 0 };
  const field = itemId === 'driftwood' ? 'wood' : 'obsidian', cap = itemId === 'driftwood' ? 20 : 10;
  if (row[field] >= cap) throw new SenderError('That part of the shared camp is complete');
  spend(ctx, p.identity, itemId, 1);
  const next = { ...row, [field]: row[field] + 1 };
  if (ctx.db.islandProject.id.find(0)) ctx.db.islandProject.id.update(next); else ctx.db.islandProject.insert(next);
  progress(ctx, p.identity, 1, 20, Feat.Build); savePlayer(ctx, p);
});
export const shareGarden = spacetimedb.reducer({ shared: t.bool() }, (ctx, { shared }) => {
  const p = requireAlivePlayer(ctx); touchInput(p, currentTick(ctx));
  if (shared) { if (!ctx.db.gardenShowcase.identity.find(p.identity)) ctx.db.gardenShowcase.insert({ identity: p.identity, plants: '[]' }); syncShowcase(ctx, p.identity); }
  else ctx.db.gardenShowcase.identity.delete(p.identity);
  savePlayer(ctx, p);
});
export const duelAction = spacetimedb.reducer({ action: t.string(), target: t.identity() }, (ctx, { action, target }) => {
  const p = requireAlivePlayer(ctx), T = currentTick(ctx); touchInput(p, T);
  const other = ctx.db.player.identity.find(target);
  if (!other || sameId(target, p.identity)) throw new SenderError('Choose another player');
  const existing = [...ctx.db.friendlyDuel.iter()].find(d => d.stage !== 'complete' && (sameId(d.a, p.identity) && sameId(d.b, target) || sameId(d.b, p.identity) && sameId(d.a, target)));
  if (action === 'surrender' || action === 'decline') { if (existing) ctx.db.friendlyDuel.id.update({ ...existing, stage: 'complete', expiresTick: T + 50, result: `${p.name} ${action === 'surrender' ? 'surrendered' : 'declined'}. No items lost.` }); savePlayer(ctx, p); return; }
  if (!['challenge', 'accept'].includes(action)) throw new SenderError('Choose challenge, accept, decline or surrender');
  requireCapability(ctx, p.identity, 'combat'); requireCapability(ctx, target, 'combat');
  if (!other.online || other.state !== PlayerState.Alive || chebyshev(p, other) > 4) throw new SenderError('Walk within four tiles of an available player');
  if (inSafeRing(p) || inSafeRing(other)) throw new SenderError('Both players must step outside the safe ring to duel');
  if (p.hostile || other.hostile || carrying(ctx, p.identity) || carrying(ctx, target)) throw new SenderError('Both players must leave combat and put down their cargo');
  if (duelFor(ctx, p.identity) || duelFor(ctx, target)) throw new SenderError('One player already has a duel');
  if (action === 'accept') {
    if (!existing || existing.stage !== 'requested' || !sameId(existing.b, p.identity) || existing.expiresTick <= T) throw new SenderError('No incoming challenge from that player');
    clearInteractions(ctx, p); const o = { ...other }; clearInteractions(ctx, o); savePlayer(ctx, o);
    ctx.db.friendlyDuel.id.update({ ...existing, stage: 'countdown', startsTick: T + 5, expiresTick: T + 200, nextSwingTick: T + 5, aHp: 30, bHp: 30, result: 'Ready… friendly duel starts in 3 seconds.' });
  } else {
    if ([...ctx.db.friendlyDuel.iter()].some(d => d.stage !== 'complete' && (sameId(d.a, p.identity) || sameId(d.b, p.identity) || sameId(d.a, target) || sameId(d.b, target)))) throw new SenderError('Finish the pending challenge first');
    ctx.db.friendlyDuel.insert({ id: 0n, a: p.identity, b: target, stage: 'requested', startsTick: 0, expiresTick: T + 50, aHp: 30, bHp: 30, nextSwingTick: 0, turnA: true, result: `${p.name} invites ${other.name} to a friendly duel.` });
  }
  savePlayer(ctx, p);
});
