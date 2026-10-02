import React, { useEffect, useRef, useState } from 'react';
import { ADVENTURE_CAMP, BERRY_MARKET, GIANT_FEAST, TECHNIQUES, PlayerState, chebyshev, hasTechnique, getItemDef, inSafeRing, expeditionPayout } from '@sim';
import { useAdventureProfiles, useExpeditions, useExpeditionMembers, useFriendlyDuels, useGardenShowcases, useInventoryRows, useIslandProjects, useMyPlayer, usePlayers, useTick } from '../spacetime/hooks';
import { useGameActions } from '../spacetime/actions';
import { openAdventure, type AdventureView } from './adventureNavigation';
import { FeastRewards, GiantFriendship } from './GiantFriendship';
import { berryGiantMood } from './berryGiantUi';
import './adventure.css';

export { openAdventure } from './adventureNavigation';
const hex = (id: { toHexString(): string } | null | undefined) => id?.toHexString() ?? '';
const seconds = (ticks: number) => Math.max(0, Math.ceil(ticks * .6));
const activeStage = (stage: string) => stage === 'growing' || stage === 'hauling';
const titles: Record<AdventureView, string> = {
  hub: 'Adventure', expedition: 'Giant berry', market: 'Berry drop-off', feast: 'Giant’s feast',
  workshop: 'Camp workshop', gardens: 'Garden visits', duels: 'Friendly duels',
};

function ItemIcon({ item, className = '' }: { item: string; className?: string }) {
  return <img className={`adventure-icon ${className}`} src={getItemDef(item)?.icon} alt="" />;
}
function BerrySteps({ step }: { step: number }) {
  return <ol className="berry-steps" aria-label="Berry adventure progress">
    {['Plant', 'Carry', 'Share'].map((label, i) => <li key={label} aria-current={i === step ? 'step' : undefined} data-done={i < step}>
      <span aria-hidden="true">{i < step ? '✓' : i + 1}</span>{label}
    </li>)}
  </ol>;
}

export function AdventureHud({ visible }: { visible: boolean }) {
  const me = useMyPlayer(), members = useExpeditionMembers(), expeditions = useExpeditions();
  const m = members.find(m => hex(m.identity) === hex(me?.identity));
  const e = expeditions.find(e => e.id === m?.expeditionId);
  if (!e || !visible) return null;
  if (e.stage === 'complete') return <button className="adventure-hud" onClick={() => openAdventure(e.destination === 'feast' ? 'feast' : 'expedition')}><strong>{e.destination === 'feast' ? (m?.contributions ? '♥ You made a very big friend!' : 'The crew shared a feast!') : 'Berry delivered!'}</strong><span>{m?.contributions ? `+${expeditionPayout(e.value, e.destination === 'feast')} goldberries · See rewards` : 'The crew made it · See the celebration'} →</span></button>;
  if (!activeStage(e.stage)) return null;
  const hint = e.stage === 'growing' ? 'Your berry is growing. Go find it!' : hex(e.carrier) === hex(me?.identity)
    ? `Carry it to ${e.destination === 'feast' ? 'the Giant’s feast' : 'the drop-off'}.` : 'Help your berry reach its destination.';
  return <button className="adventure-hud" onClick={() => openAdventure('expedition')}><strong>Giant berry adventure</strong><span>{hint} →</span></button>;
}
export function DuelHud() {
  const me = useMyPlayer(), duels = useFriendlyDuels(), tick = useTick(), actions = useGameActions();
  const d = duels.find(d => hex(d.a) === hex(me?.identity) || hex(d.b) === hex(me?.identity));
  if (!me || !d) return null;
  const other = hex(d.a) === hex(me.identity) ? d.b : d.a;
  return <aside className="duel-hud" aria-label="Friendly duel"><strong>{d.stage === 'countdown' ? `Ready in ${seconds(d.startsTick - tick)}…` : d.stage === 'active' ? `Friendly duel · ${d.aHp} : ${d.bHp}` : d.result}</strong>
    {d.stage === 'requested' && hex(d.b) === hex(me.identity) && <button onClick={() => actions.duelAction('accept', other)}>Accept duel</button>}
    {d.stage !== 'complete' && <button onClick={() => actions.duelAction(d.stage === 'requested' ? 'decline' : 'surrender', other)}>{d.stage === 'requested' ? 'Cancel' : 'Surrender'}</button>}
    {d.stage === 'active' && <small>Walk into reach to spar. Your bag and health are safe.</small>}
  </aside>;
}

export default function AdventurePanel({ open, onClose, initialView = 'hub', onSettlements }: {
  open: boolean; onClose: () => void; initialView?: AdventureView; onSettlements?: () => void;
}) {
  const me = useMyPlayer(), players = usePlayers(), members = useExpeditionMembers(), expeditions = useExpeditions();
  const profiles = useAdventureProfiles(), projects = useIslandProjects(), gardens = useGardenShowcases();
  const inventory = useInventoryRows(), duels = useFriendlyDuels(), tick = useTick(), actions = useGameActions();
  const [view, setView] = useState<AdventureView>(initialView);
  const [destination, setDestination] = useState(initialView === 'feast' ? 'feast' : 'market');
  const [busy, setBusy] = useState(false), pending = useRef(false);
  const scroll = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!open) return;
    if (scroll.current) scroll.current.scrollTop = 0;
    heading.current?.focus({ preventScroll: true });
  }, [view, open]);
  if (!open || !me) return null;

  const myId = hex(me.identity), member = members.find(m => hex(m.identity) === myId);
  const e = expeditions.find(e => e.id === member?.expeditionId), profile = profiles.find(p => hex(p.identity) === myId);
  const active = !!e && activeStage(e.stage), mine = !!e?.carrier && hex(e.carrier) === myId;
  const berry = (e?.carrier && players.find(p => hex(p.identity) === hex(e.carrier))) || e;
  const camp = chebyshev(me, ADVENTURE_CAMP) <= 4, nearBerry = !!berry && chebyshev(me, berry) <= 2;
  const goal = e?.destination === 'feast' ? GIANT_FEAST : BERRY_MARKET;
  const atGoal = !!berry && chebyshev(berry, goal) <= 2;
  const grounded = !!e && !e.carrier && !e.mossCarrying;
  const available = expeditions.filter(row => activeStage(row.stage));
  const project = projects[0], wood = project?.wood ?? 0, obsidian = project?.obsidian ?? 0;
  const built = wood >= 20 && obsidian >= 10;
  const feasts = profile?.giantTrust ?? 0;
  const seedValue = (hasTechnique(profile, 2) ? 6 : 4) + (built ? 1 : 0);
  const quantity = (itemId: string) => inventory.filter(row => row.itemId === itemId).reduce((sum, row) => sum + row.quantity, 0);
  const inDuel = duels.some(d => ['active', 'countdown'].includes(d.stage) && (hex(d.a) === myId || hex(d.b) === myId));
  const blocked = me.state !== PlayerState.Alive || me.hostile || inDuel;
  const cooldown = active ? seconds((member?.cooldown ?? 0) - tick) : 0;
  const actionDisabled = busy || blocked || cooldown > 0;
  const visit = (next: AdventureView) => setView(next);
  const run = async (fn: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try { return await fn(); } finally { pending.current = false; setBusy(false); }
  };
  const act = (action: string, extra: Parameters<typeof actions.expeditionAction>[2] = {}) => run(() => actions.expeditionAction(action, e?.id ?? 0n, extra));
  const walk = (at: { x: number; z: number }) => run(() => actions.setTarget(at.x, at.z));
  const startRoute = (route: 'market' | 'feast') => { setDestination(route); visit('expedition'); };
  const chooseTechniques = () => { onClose(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' })); };

  // The main action follows the live cargo, so distant or carried berries do not offer invalid actions.
  const next = (() => {
    if (!active || !e || !berry) return null;
    if (e.stage === 'growing') return { label: nearBerry ? `Growing · ${seconds(e.ripeTick - tick)}s` : 'Walk to berry', hint: 'A tiny seed. A very big snack.', disabled: nearBerry, movement: true, run: () => walk(berry) };
    if (e.mossCarrying && hex(e.porter ?? e.leader) === myId && hasTechnique(profile, 13)) return { label: e.destination === 'feast' ? 'Lead Moss to feast' : 'Lead Moss to drop-off', hint: 'Moss is following you. Lead the way!', movement: true, run: () => walk(goal) };
    if (e.mossCarrying || (e.carrier && !mine)) return { label: 'Follow the berry', hint: e.mossCarrying ? 'Moss has it! Stay close in case he drops it.' : 'Your teammate has it. Keep them company!', movement: true, run: () => walk(berry) };
    if (nearBerry && atGoal) return { label: e.destination === 'feast' ? 'Feed the Giant' : 'Share the berry', hint: 'You made it. Time to share the good stuff!', run: () => act(e.destination === 'feast' ? 'feed' : 'deliver') };
    if (mine) return { label: e.destination === 'feast' ? 'Walk to feast' : 'Walk to drop-off', hint: 'Both hands full. Watch out for hungry company!', movement: true, run: () => walk(goal) };
    if (!nearBerry) return { label: 'Walk to berry', hint: 'Your berry is ready. Go scoop it up!', movement: true, run: () => walk(berry) };
    return { label: 'Pick up berry', hint: 'That’s a big berry. You’ll need both hands.', run: () => act('take') };
  })();

  const primary = (() => {
    if (active && next && (view === 'expedition' || view === e?.destination)) return { ...next, disabled: busy || blocked || next.disabled || (!next.movement && cooldown > 0) };
    if (view === 'expedition' && !active) return { label: camp ? 'Plant a giant berry' : 'Walk to camp', disabled: busy || blocked || (camp && available.length >= 4), run: () => camp ? run(() => actions.expeditionAction('start', 0n, { destination })) : walk(ADVENTURE_CAMP) };
    if (view === 'market' || view === 'feast') return active
      ? { label: 'Continue berry adventure', run: () => visit('expedition') }
      : { label: view === 'market' ? 'Start a berry delivery' : 'Grow a feast for the Giant', run: () => startRoute(view === 'feast' ? 'feast' : 'market') };
    if (view === 'gardens') return { label: gardens.some(g => hex(g.identity) === myId) ? 'Hide my garden' : 'Show my garden', disabled: busy || me.state !== PlayerState.Alive, run: () => run(() => actions.shareGarden(!gardens.some(g => hex(g.identity) === myId))) };
    if (view === 'workshop' && !camp && !built) return { label: 'Walk to workshop', disabled: busy || me.state !== PlayerState.Alive, run: () => walk(ADVENTURE_CAMP) };
    return null;
  })();

  const currentAdventure = active && e && next && <>
    <BerrySteps step={e.stage === 'growing' ? 0 : atGoal ? 2 : 1} />
    <div className="berry-mission adventure-card">
      <div className="adventure-hero-heading"><ItemIcon item="berry_goldberry" /><div>
        <span className="adventure-kicker">{e.destination === 'feast' ? 'To the Giant’s feast' : 'To the berry drop-off'}</span>
        <h3>{e.stage === 'growing' ? 'Something big is growing…' : atGoal ? 'A berry worth sharing' : 'Let’s roll!'}</h3>
      </div></div>
      <div className="adventure-stats"><span>{expeditionPayout(e.value, e.destination === 'feast')} goldberries / helper</span><span>{Math.floor(seconds(e.untilTick - tick) / 60)}:{String(seconds(e.untilTick - tick) % 60).padStart(2, '0')} left</span><span>{members.filter(m => m.expeditionId === e.id).length} playing</span></div>
      <p>{next.hint}</p>
      {cooldown > 0 && <p className="adventure-note" role="status">Catch your breath · {cooldown}s</p>}
      {e.stage === 'hauling' && mine && <button className="adventure-text-button" disabled={actionDisabled} onClick={() => act('put_down')}>Put berry down</button>}
    </div>
    {e.stage === 'hauling' && <div className="berry-giant-status" data-near={chebyshev({ x: e.giantX, z: e.giantZ }, berry!) <= 4 && tick >= e.giantUntil}><span aria-hidden="true">{tick < e.baitUntil ? '🍃' : '👃'}</span><div><strong>Giant · {berryGiantMood(e, tick).label}</strong><br />{tick < e.giantUntil ? `${seconds(e.giantUntil - tick)}s to get moving` : tick < e.baitUntil ? `${seconds(e.baitUntil - tick)}s to carry the berry away` : e.destination === 'feast' ? 'Bring the berry to his clearing for a feast.' : 'Use bait or hide the berry to save your reward.'}</div></div>}
    <details className="adventure-details"><summary>Latest adventure news</summary><p>{e.message}</p></details>
    {e.stage === 'hauling' && <details className="adventure-details"><summary>Berry tricks & friends</summary>
      <p className="adventure-note">{!nearBerry ? 'Get close to the berry to help.' : mine ? 'Put it down to hide it or ask Moss for help.' : !grounded ? 'Wait for the carrier to put it down.' : 'A little teamwork goes a long way.'}</p>
      <div className="adventure-actions">
        <button disabled={actionDisabled || !nearBerry || (!grounded && !mine)} onClick={() => act('roll', goal)}>Roll toward goal</button>
        <button disabled={actionDisabled || !nearBerry || !grounded} onClick={() => act('hide')}>Hide under leaves</button>
        <button disabled={actionDisabled || !nearBerry || !grounded} onClick={() => act('porter')}>Ask Moss to carry</button>
        <button disabled={actionDisabled || !nearBerry || (!grounded && !mine) || e.split} onClick={() => act('split')}>Make 2 berry snacks</button>
      </div>
      <p className="adventure-note">Moss {hasTechnique(profile, 13) ? 'carries for free and follows you.' : 'keeps 1 reward berry and heads to your destination.'} {hasTechnique(profile, 3) ? 'Your basket keeps the reward whole when making snacks.' : 'Making snacks costs 1 reward berry.'}</p>
      <div className="adventure-actions">
        <button disabled={actionDisabled || mine || !quantity(hasTechnique(profile, 4) ? 'driftwood' : 'berry_greenberry')} onClick={() => act('bait')}>Lure Giant · 1 {hasTechnique(profile, 4) ? 'driftwood' : 'greenberry'}</button>
        {chebyshev(me, { x: e.pipX, z: e.pipZ }) > 3 ? <button disabled={busy || blocked} onClick={() => walk({ x: e.pipX, z: e.pipZ })}>Walk to Pip</button> : <button disabled={actionDisabled || !quantity('berry_greenberry')} onClick={() => act('bribe')}>Befriend Pip · 1 greenberry</button>}
      </div>
      {mine && <div className="adventure-actions">{players.filter(p => p.online && hex(p.identity) !== myId && members.some(m => hex(m.identity) === hex(p.identity) && m.expeditionId === e.id)).map(p => <button key={hex(p.identity)} disabled={actionDisabled || chebyshev(me, p) > 2} onClick={() => act('pass', { target: p.identity })}>Pass to {p.name}</button>)}</div>}
      <div className="adventure-actions">{[
        { id: 6, action: 'track', at: { x: 14, z: 15 }, reach: 2, walkLabel: 'Follow the tracks' },
        { id: 9, action: 'brace', at: berry!, reach: 2, walkLabel: 'Walk to berry' },
        { id: 10, action: 'shove', at: { x: e.pipX, z: e.pipZ }, reach: 3, walkLabel: 'Approach Pip to shove' },
        { id: 11, action: 'interrupt', at: { x: e.giantX, z: e.giantZ }, reach: 3, walkLabel: 'Approach Giant to interrupt' },
      ].filter(technique => hasTechnique(profile, technique.id)).map(technique => {
        const distant = chebyshev(me, technique.at) > technique.reach;
        const unavailable = technique.id === 6 ? member?.tracked : technique.id === 9 ? !grounded : mine;
        return <button key={technique.id} disabled={busy || blocked || unavailable || (!distant && cooldown > 0)} onClick={() => distant ? walk(technique.at) : act(technique.action)}>{distant ? technique.walkLabel : TECHNIQUES[technique.id].name}</button>;
      })}</div>
    </details>}
    <details className="adventure-details"><summary>Leave this adventure</summary><p>{members.filter(m => m.expeditionId === e.id).length > 1 ? 'Your friends can keep going with the berry.' : 'You’re the last adventurer. Leaving ends this delivery.'}</p><button disabled={busy || blocked} onClick={() => act('leave')}>Leave adventure</button></details>
  </>;

  const result = e && !active && <div className="adventure-result" role="status">
    <strong>{e.stage !== 'complete' ? 'The berry got away!' : e.destination === 'feast' ? '♥ A very big new friend!' : 'Nice work, berry crew!'}</strong>
    {e.stage !== 'complete' ? <p>Your bag and skills are safe. Fancy another go?</p> : member?.contributions ? e.destination === 'feast' ? <><FeastRewards value={e.value} firstFeast={feasts === 1} earned /><GiantFriendship feasts={feasts} /></> : <p>+{expeditionPayout(e.value)} goldberries · +35 Exploring XP completion bonus</p> : <p>The crew shared the berry! Help carry or protect the next one to earn rewards.</p>}
  </div>;

  return <section className="game-panel adventure-panel" aria-label={titles[view]}>
    <header className="panel-heading"><div className="adventure-heading">
      {view !== 'hub' && <button className="adventure-back" aria-label="All adventures" title="All adventures" onClick={() => visit('hub')}>←</button>}
      <h2 ref={heading} tabIndex={-1}>{titles[view]}</h2>
    </div><button className="close-button" onClick={onClose} aria-label="Close adventure">×</button></header>
    <div className="adventure-scroll" ref={scroll}>
      {view === 'hub' && <>
        <p className="adventure-intro">A little mischief. A big adventure.</p>
        <button className="adventure-feature" onClick={() => visit('expedition')}>
          <ItemIcon item="berry_goldberry" /><span><span className="adventure-kicker">{active ? 'Your adventure is underway' : 'Solo or with friends · 6 minutes'}</span><strong>{active ? 'Continue berry adventure' : 'Grow a giant berry'}</strong><span>{active ? 'Your next move is waiting.' : 'Grow it. Carry it. Outwit a hungry Giant.'}</span></span><span aria-hidden="true">→</span>
        </button>
        <div className="adventure-choices">
          <button className="adventure-choice" onClick={() => visit('feast')}><span className="adventure-icon giant-hearts" aria-hidden="true">♥</span><span><strong>Befriend the Berry Giant</strong><small>Bonus berries, a keepsake, and a head start.</small></span><span aria-hidden="true">→</span></button>
          {onSettlements && <button className="adventure-choice" onClick={onSettlements}><img className="adventure-icon" src="/items/frontier/hammer.svg" alt=""/><span><strong>Make a home in the Meadows</strong><small>Follow the camp trail. Gather, build and meet your neighbours.</small></span><span aria-hidden="true">→</span></button>}
          <button className="adventure-choice" onClick={() => visit('workshop')}><ItemIcon item="driftwood" /><span><strong>Camp workshop</strong><small>{built ? 'Built together. Bigger berry rewards!' : 'Build together. Grow bigger rewards.'}</small></span><span aria-hidden="true">→</span></button>
          <button className="adventure-choice" onClick={() => visit('gardens')}><ItemIcon item="berry_greenberry" /><span><strong>Garden visits</strong><small>Show off what you’re growing.</small></span><span aria-hidden="true">→</span></button>
          <button className="adventure-choice" onClick={() => visit('duels')}><img className="adventure-icon" src="/ui/punch.png" alt="" /><span><strong>Friendly duels</strong><small>A friendly scrap. Keep your stuff.</small></span><span aria-hidden="true">→</span></button>
        </div>
      </>}

      {view === 'expedition' && <>
        {currentAdventure}
        {!active && <>
          {result}
          <BerrySteps step={0} />
          <div className="adventure-card berry-mission">
            <div className="adventure-hero-heading"><ItemIcon item="berry_goldberry" /><div><span className="adventure-kicker">Solo or with friends · 6 minutes</span><h3>Small seed. Big adventure.</h3></div></div>
            <p>Grow a giant berry, then carry it past hungry troublemakers.</p>
            <fieldset className="berry-destinations"><legend>Who gets the first bite?</legend>
              <button aria-pressed={destination === 'market'} onClick={() => setDestination('market')}><span aria-hidden="true">⌂</span><strong>Berry drop-off</strong><small>Share with the village</small></button>
              <button aria-pressed={destination === 'feast'} onClick={() => setDestination('feast')}><span aria-hidden="true">♡</span><strong>Giant’s feast</strong><small>Make a very big friend</small></button>
            </fieldset>
            {destination === 'feast' && <FeastRewards value={seedValue} firstFeast={feasts === 0} />}
            <p className="adventure-note">{available.length >= 4 ? 'Four berries are on the move. Join a crew below!' : camp ? `Ready in ${hasTechnique(profile, 0) ? 6 : 18} seconds. Your bag and skills stay safe.` : 'The gardener at camp will help you plant.'}</p>
          </div>
          {available.length > 0 && <details className="adventure-details" open={available.length >= 4}><summary>Join a berry crew · {available.length}</summary>{available.map(row => {
            const cargo = (row.carrier && players.find(p => hex(p.identity) === hex(row.carrier))) || row;
            const canJoin = camp || chebyshev(me, cargo) <= 4;
            return <div className="adventure-join" key={String(row.id)}><strong>{players.find(p => hex(p.identity) === hex(row.leader))?.name ?? 'An adventurer'}’s berry</strong><button disabled={busy || blocked} onClick={() => canJoin ? run(() => actions.expeditionAction('join', row.id)) : walk(cargo)}>{canJoin ? 'Join crew' : 'Walk to crew'}</button></div>;
          })}</details>}
        </>}
        <button className="adventure-text-button" onClick={chooseTechniques}>Choose techniques at camp →</button>
      </>}

      {(view === 'market' || view === 'feast') && <>
        {!active && e?.destination === view && result}
        {active && e?.destination === view ? currentAdventure : e?.stage === 'complete' && e.destination === view ? null : <>
          <div className="adventure-place-intro"><ItemIcon item={view === 'market' ? 'berry_goldberry' : 'berry_mash'} /><h3>{view === 'market' ? 'Big berry. Happy village.' : 'Big appetite. Bigger heart.'}</h3><p>{view === 'market' ? 'Bring a giant berry here and share the rewards.' : 'Grow a giant berry at camp. Bring it to his clearing. Make a friend!'}</p></div>
          {view === 'feast' && <><FeastRewards value={seedValue} firstFeast={feasts === 0} /><GiantFriendship feasts={feasts} /></>}
          {active && <p className="adventure-note">Your berry is headed to {e?.destination === 'feast' ? 'the Giant’s feast' : 'the berry drop-off'}.</p>}
        </>}
      </>}

      {view === 'workshop' && <>
        <div className="adventure-place-intro"><ItemIcon item="driftwood" /><h3>{built ? 'Built by all of us.' : 'A little help builds a lot.'}</h3><p>{built ? 'Every new giant berry gets +1 reward berry.' : 'Finish the workshop for +1 reward berry on every adventure.'}</p></div>
        <div className="workshop-materials">{[{ item: 'driftwood', label: 'Driftwood', amount: wood, target: 20 }, { item: 'obsidian', label: 'Obsidian', amount: obsidian, target: 10 }].map(material => <div className="workshop-material" key={material.item}>
          <ItemIcon item={material.item} /><div><strong>{material.label} <span>{material.amount}/{material.target}</span></strong><progress aria-label={`${material.label} contributed`} value={material.amount} max={material.target} /><small>{quantity(material.item)} in your bag</small></div>
          <button aria-label={`Give 1 ${material.label.toLowerCase()}`} disabled={busy || me.state !== PlayerState.Alive || !camp || material.amount >= material.target || !quantity(material.item)} onClick={() => run(() => actions.contributeProject(material.item))}>{material.amount >= material.target ? '✓' : 'Give 1'}</button>
        </div>)}</div>
        <p className="adventure-note">{project?.meals ?? 0} berry adventures shared by the island.</p>
      </>}

      {view === 'gardens' && <>
        <div className="adventure-place-intro"><ItemIcon item="berry_greenberry" /><h3>Good things are growing.</h3><p>Share a peek at your garden with the island.</p></div>
        {gardens.length === 0 && <p className="adventure-note">Be the first to show what you’re growing.</p>}
        {gardens.map(g => {
          const plants: { itemId: string }[] = JSON.parse(g.plants);
          return <div className="adventure-card" key={hex(g.identity)}><h3>{players.find(p => hex(p.identity) === hex(g.identity))?.name ?? 'An island gardener'}</h3><div className="garden-preview">{plants.map((plant, i) => <span key={i}><ItemIcon item={plant.itemId} />{getItemDef(plant.itemId)?.name ?? 'A growing plant'}</span>)}{plants.length === 0 && <p>Empty beds. So many possibilities.</p>}</div></div>;
        })}
      </>}

      {view === 'duels' && <>
        <div className="adventure-place-intro"><img className="adventure-icon" src="/ui/punch.png" alt="" /><h3>Fancy a friendly scrap?</h3><p>Both players agree. Practice health. Keep your bag.</p></div>
        {players.filter(p => p.online && hex(p.identity) !== myId && chebyshev(me, p) <= 4).map(p => <div className="adventure-join" key={hex(p.identity)}><strong>{p.name}</strong><button aria-label={`Challenge ${p.name}`} disabled={busy || blocked || inSafeRing(me) || inSafeRing(p) || p.state !== PlayerState.Alive || p.hostile || mine} onClick={() => run(() => actions.duelAction('challenge', p.identity))}>Challenge</button></div>)}
        <p className="adventure-note">{inSafeRing(me) ? 'Step outside the safe ring together to spar.' : 'Stand within four tiles of a friend to challenge them.'}</p>
      </>}
      {blocked && (view === 'expedition' || view === 'market' || view === 'feast') && <p className="adventure-note" role="status">{me.state !== PlayerState.Alive ? 'Back to adventuring after you respawn.' : 'Finish your fight, then come back for your berry.'}</p>}
    </div>
    {primary && <footer className="adventure-footer"><button className="primary-button adventure-primary" disabled={primary.disabled} onClick={primary.run}>{primary.label} <span aria-hidden="true">→</span></button></footer>}
  </section>;
}
