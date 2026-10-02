import React, { useRef, useState } from 'react';
import { ADVENTURE_CAMP, GIANT_FEAST, PlayerState, chebyshev, hasTechnique } from '@sim';
import { useAdventureProfiles, useExpeditions, useExpeditionMembers, useFriendlyDuels, useInventoryRows, useMyPlayer, usePlayers, useTick } from '../spacetime/hooks';
import { useGameActions } from '../spacetime/actions';
import { berryGiantMood } from './berryGiantUi';
import { FeastRewards, GiantFriendship } from './GiantFriendship';
import { openAdventure } from './adventureNavigation';
import './berryGiant.css';

const hex = (id: { toHexString(): string } | undefined) => id?.toHexString();

/** Live conversation with a hungry neighbour, including his feast payoff. */
export default function BerryGiantInteraction({ expeditionId, onClose }: { expeditionId: bigint; onClose: () => void }) {
  const me = useMyPlayer(), expeditions = useExpeditions(), members = useExpeditionMembers();
  const profiles = useAdventureProfiles(), inventory = useInventoryRows(), players = usePlayers();
  const duels = useFriendlyDuels(), tick = useTick(), actions = useGameActions();
  const pending = useRef(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!me) return null;
  const e = expeditions.find(row => row.id === expeditionId);
  const myId = hex(me.identity), member = members.find(row => hex(row.identity) === myId);
  const profile = profiles.find(row => hex(row.identity) === myId), feasts = profile?.giantTrust ?? 0;
  const joined = !!e && member?.expeditionId === e.id;
  const ownAdventure = expeditions.find(row => row.id === member?.expeditionId && ['growing', 'hauling'].includes(row.stage));
  const otherAdventure = !joined && !!ownAdventure;
  const showPlan = () => { onClose(); openAdventure(ownAdventure ? 'expedition' : 'feast'); };
  if (!e || e.stage !== 'hauling') {
    const celebrated = e?.stage === 'complete' && e.destination === 'feast';
    const earned = celebrated && joined && !!member?.contributions;
    const growing = e?.stage === 'growing' || (!e && ownAdventure?.stage === 'growing');
    return <div className="giant-interaction">
      <p className="giant-speech">“{celebrated ? 'Best. Berry. Ever! You have a very big friend.' : growing ? 'Grow, little berry, grow! I’ll save room.' : 'Little friend… could you grow me a BIG berry?'}”</p>
      {e && !celebrated && !growing && <p className="giant-interaction-note">This Giant’s adventure has ended.</p>}
      {earned ? <FeastRewards value={e.value} firstFeast={feasts === 1} earned /> : <>
        <p className="giant-interaction-note">{celebrated ? 'The berry crew shared a feast! Grow one to earn your own gifts.' : growing ? 'Your berry is growing. Head to the patch!' : 'Grow it at camp. Bring it here. Share a feast!'}</p>
        <FeastRewards firstFeast={feasts === 0} />
      </>}
      <GiantFriendship feasts={feasts} />
      <button className="context-action giant-primary" onClick={showPlan}>{ownAdventure ? 'Continue my berry adventure' : 'Plan a feast'} <span aria-hidden="true">→</span></button>
    </div>;
  }

  const carrying = hex(e.carrier) === myId;
  const decoy = hasTechnique(profile, 4), material = decoy ? 'driftwood' : 'berry_greenberry';
  const hasBait = inventory.some(row => row.itemId === material && row.quantity > 0);
  const cooldown = joined ? Math.max(0, Math.ceil(((member?.cooldown ?? 0) - tick) * .6)) : 0;
  const inDuel = duels.some(d => ['active', 'countdown'].includes(d.stage) && (hex(d.a) === myId || hex(d.b) === myId));
  const blocked = me.state !== PlayerState.Alive || me.hostile || inDuel;
  const berry = players.find(p => hex(p.identity) === hex(e.carrier)) ?? e;
  const canJoin = chebyshev(me, ADVENTURE_CAMP) <= 4 || chebyshev(me, berry) <= 4;
  const atFeast = chebyshev(berry, GIANT_FEAST) <= 2 && chebyshev(me, berry) <= 2 && (!e.carrier || carrying);
  const mood = berryGiantMood(e, tick);
  const seconds = Math.max(0, Math.ceil((mood.until - tick) * .6));
  const run = async (fn: () => Promise<boolean>, close = false) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { if (await fn()) { if (close) onClose(); } else setError('Couldn’t do that yet. Try again.'); }
    catch { setError('Couldn’t do that yet. Try again.'); }
    finally { pending.current = false; setBusy(false); }
  };
  const act = (action: string) => run(() => actions.expeditionAction(action, e.id));

  return <div className="giant-interaction">
    <p className="giant-speech">“{atFeast && joined ? 'For me? Oh, please say it’s for me!' : mood.speech}”</p>
    <span className="giant-mood">{mood.label}{seconds > 0 ? ` · ${seconds}s` : ''}</span>
    {atFeast && joined ? <FeastRewards value={e.value} firstFeast={feasts === 0} /> : <p className="giant-goal"><span aria-hidden="true">♥</span> Feed a giant berry → bonus berries + friendship</p>}
    {blocked ? <p className="giant-interaction-note">{me.state !== PlayerState.Alive ? 'Return after respawning to help.' : 'Finish combat before helping with this delivery.'}</p> : joined ? <>
      {atFeast && <button className="context-action giant-primary" disabled={busy || cooldown > 0} onClick={() => void act('feed')}>Share the feast <span aria-hidden="true">♥</span></button>}
      {!atFeast && carrying && <button className="context-action giant-primary" disabled={busy} onClick={() => void run(() => actions.setTarget(GIANT_FEAST.x, GIANT_FEAST.z), true)}>Bring berry to feast <span aria-hidden="true">→</span></button>}
      {carrying ? <>
        <p className="giant-interaction-note">Put it down to hide it or drop bait.</p>
        <button className="context-action" disabled={busy || cooldown > 0} onClick={() => void act('put_down')}>Put the berry down</button>
      </> : !atFeast && <>
        <button className="context-action" disabled={busy || cooldown > 0 || !hasBait} onClick={() => void act('bait')}>Drop bait here · 1 {decoy ? 'driftwood' : 'greenberry'}</button>
        <p className="giant-interaction-note">{hasBait ? `Lure him away from cargo for ${decoy ? 30 : 15}s.` : `You need 1 ${decoy ? 'driftwood' : 'greenberry'} for bait.`}</p>
        {hasTechnique(profile, 11) && chebyshev(me, { x: e.giantX, z: e.giantZ }) <= 3 && <button className="context-action" disabled={busy || cooldown > 0} onClick={() => void act('interrupt')}>Interrupt · stun for 9s</button>}
      </>}
      {cooldown > 0 && <p className="giant-interaction-note">Catch your breath · {cooldown}s</p>}
      <details className="giant-extra"><summary>Friendship & rewards</summary><GiantFriendship feasts={feasts} />{!atFeast && <FeastRewards value={e.value} firstFeast={feasts === 0} />}</details>
    </> : otherAdventure ? <p className="giant-interaction-note">You’re helping a different delivery. This Giant follows another team’s berry.</p> : canJoin ? (
      <button className="context-action" disabled={busy} onClick={() => void act('join')}>Help with this delivery</button>
    ) : <>
      <button className="context-action" disabled={busy} onClick={() => void run(() => actions.setTarget(berry.x, berry.z), true)}>Go to the giant berry</button>
      <p className="giant-interaction-note">Join beside the berry or at camp.</p>
    </>}
    {error && <p className="giant-interaction-note" role="alert">{error}</p>}
  </div>;
}
