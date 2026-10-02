import React, { useRef, useState } from 'react';
import { ADVENTURE_CAMP, PlayerState, chebyshev, hasTechnique } from '@sim';
import { useAdventureProfiles, useExpeditions, useExpeditionMembers, useFriendlyDuels, useInventoryRows, useMyPlayer, usePlayers, useTick } from '../spacetime/hooks';
import { useGameActions } from '../spacetime/actions';
import { berryGiantMood } from './berryGiantUi';
import './berryGiant.css';

const hex = (id: { toHexString(): string } | undefined) => id?.toHexString();

/** A conversation about this Giant's cargo, using live rows instead of a snapshot of its actions. */
export default function BerryGiantInteraction({ expeditionId, onClose }: { expeditionId: bigint; onClose: () => void }) {
  const me = useMyPlayer(), expeditions = useExpeditions(), members = useExpeditionMembers();
  const profiles = useAdventureProfiles(), inventory = useInventoryRows(), players = usePlayers();
  const duels = useFriendlyDuels(), tick = useTick(), actions = useGameActions();
  const pending = useRef(false), [busy, setBusy] = useState(false);
  const e = expeditions.find(row => row.id === expeditionId);
  if (!me || !e || e.stage !== 'hauling') return <p className="giant-interaction-note">This Giant’s adventure has ended.</p>;

  const myId = hex(me.identity), member = members.find(row => hex(row.identity) === myId);
  const joined = member?.expeditionId === e.id;
  const otherAdventure = !joined && expeditions.some(row => row.id === member?.expeditionId && ['growing', 'hauling'].includes(row.stage));
  const profile = profiles.find(row => hex(row.identity) === myId);
  const carrying = hex(e.carrier) === myId;
  const decoy = hasTechnique(profile, 4), material = decoy ? 'driftwood' : 'berry_greenberry';
  const hasBait = inventory.some(row => row.itemId === material && row.quantity > 0);
  const cooldown = joined ? Math.max(0, Math.ceil(((member?.cooldown ?? 0) - tick) * .6)) : 0;
  const inDuel = duels.some(d => ['active', 'countdown'].includes(d.stage) && (hex(d.a) === myId || hex(d.b) === myId));
  const blocked = me.state !== PlayerState.Alive || me.hostile || inDuel;
  const berry = players.find(p => hex(p.identity) === hex(e.carrier)) ?? e;
  const canJoin = chebyshev(me, ADVENTURE_CAMP) <= 4 || chebyshev(me, berry) <= 4;
  const mood = berryGiantMood(e, tick);
  const seconds = Math.max(0, Math.ceil((mood.until - tick) * .6));
  const run = async (fn: () => Promise<boolean>, close = false) => {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try { if (await fn() && close) onClose(); }
    finally { pending.current = false; setBusy(false); }
  };
  const act = (action: string) => run(() => actions.expeditionAction(action, e.id));

  return <div className="giant-interaction">
    <p className="giant-speech">“{mood.speech}”</p>
    <span className="giant-mood">{mood.label}{seconds > 0 ? ` · ${seconds}s` : ''}</span>
    {blocked ? <p className="giant-interaction-note">{me.state !== PlayerState.Alive ? 'Return after respawning to help.' : 'Finish combat before helping with this delivery.'}</p> : joined ? <>
      {carrying ? <>
        <p className="giant-interaction-note">Put your cargo down, then drop bait away from it.</p>
        <button className="context-action" disabled={busy || cooldown > 0} onClick={() => void act('put_down')}>Put the berry down</button>
      </> : <>
        <button className="context-action" disabled={busy || cooldown > 0 || !hasBait} onClick={() => void act('bait')}>Drop bait here · 1 {decoy ? 'driftwood' : 'greenberry'}</button>
        <p className="giant-interaction-note">{hasBait ? `Lure him away from cargo for ${decoy ? 30 : 15}s.` : `You need 1 ${decoy ? 'driftwood' : 'greenberry'} for bait.`}</p>
        {hasTechnique(profile, 11) && chebyshev(me, { x: e.giantX, z: e.giantZ }) <= 3 && <button className="context-action" disabled={busy || cooldown > 0} onClick={() => void act('interrupt')}>Interrupt · stun for 9s</button>}
      </>}
      {cooldown > 0 && <p className="giant-interaction-note">Catch your breath · {cooldown}s</p>}
    </> : otherAdventure ? <p className="giant-interaction-note">You’re helping a different delivery. This Giant follows another team’s berry.</p> : canJoin ? (
      <button className="context-action" disabled={busy} onClick={() => void act('join')}>Help with this delivery</button>
    ) : <>
      <button className="context-action" disabled={busy} onClick={() => void run(() => actions.setTarget(berry.x, berry.z), true)}>Go to the giant berry</button>
      <p className="giant-interaction-note">Join beside the berry or at camp.</p>
    </>}
  </div>;
}
