import React, { useState } from 'react';
import { ADVENTURE_CAMP, BERRY_PATCH, BERRY_MARKET, GIANT_FEAST, TECHNIQUES, chebyshev, hasTechnique, getItemDef } from '@sim';
import { useAdventureProfiles, useExpeditions, useExpeditionMembers, useFriendlyDuels, useGardenShowcases, useIslandProjects, useMyPlayer, usePlayers, useTick } from '../spacetime/hooks';
import { useGameActions } from '../spacetime/actions';
import './adventure.css';
const hex = (id: any) => id?.toHexString() ?? '';
export const openAdventure = () => window.dispatchEvent(new Event('berigame-adventure'));
export function AdventureHud({ visible }: { visible: boolean }) {
  const me = useMyPlayer(), members = useExpeditionMembers(), expeditions = useExpeditions();
  const m = members.find(m => hex(m.identity) === hex(me?.identity)), e = expeditions.find(e => e.id === m?.expeditionId);
  if (!e || !visible) return null;
  return <button className="adventure-hud" onClick={openAdventure}><strong>Giant berry · {e.stage}</strong><span>{e.message}</span></button>;
}
export function DuelHud() {
  const me = useMyPlayer(), duels = useFriendlyDuels(), tick = useTick(), actions = useGameActions();
  const d = duels.find(d => hex(d.a) === hex(me?.identity) || hex(d.b) === hex(me?.identity));
  if (!me || !d) return null;
  const other = hex(d.a) === hex(me.identity) ? d.b : d.a;
  return <aside className="duel-hud" aria-label="Friendly duel"><strong>{d.stage === 'countdown' ? `Ready in ${Math.max(0, Math.ceil((d.startsTick - tick) * .6))}…` : d.stage === 'active' ? `Friendly duel · ${d.aHp} : ${d.bHp}` : d.result}</strong>
    {d.stage === 'requested' && hex(d.b) === hex(me.identity) && <button onClick={() => actions.duelAction('accept', other)}>Accept duel</button>}
    {d.stage !== 'complete' && <button onClick={() => actions.duelAction(d.stage === 'requested' ? 'decline' : 'surrender', other)}>{d.stage === 'requested' ? 'Cancel' : 'Surrender'}</button>}
    {d.stage === 'active' && <small>Walk into reach to spar. Leave the area to end. Your bag and health are safe.</small>}
  </aside>;
}
export default function AdventurePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMyPlayer(), players = usePlayers(), members = useExpeditionMembers(), expeditions = useExpeditions(), profiles = useAdventureProfiles();
  const projects = useIslandProjects(), gardens = useGardenShowcases(), tick = useTick(), actions = useGameActions();
  const [destination, setDestination] = useState('market'), [busy, setBusy] = useState(false);
  if (!open || !me) return null;
  const myId = hex(me.identity), m = members.find(m => hex(m.identity) === myId), e = expeditions.find(e => e.id === m?.expeditionId), pp = profiles.find(p => hex(p.identity) === myId);
  const active = e && ['growing','hauling'].includes(e.stage), mine = hex(e?.carrier) === myId;
  const berry = e?.carrier ? players.find(p => hex(p.identity) === hex(e.carrier)) ?? e : e;
  const project = projects[0], camp = chebyshev(me, ADVENTURE_CAMP) <= 4;
  const run = async (fn: () => Promise<unknown>) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const act = (action: string, extra: Parameters<typeof actions.expeditionAction>[2] = {}) => run(() => actions.expeditionAction(action, e?.id ?? 0n, extra));
  const walk = (at: { x: number; z: number }) => run(() => actions.setTarget(at.x, at.z));
  const goal = e?.destination === 'feast' ? GIANT_FEAST : BERRY_MARKET;
  return <section className="game-panel adventure-panel" aria-label="Adventure"><header className="panel-heading"><h2>Adventure</h2><button className="close-button" onClick={onClose} aria-label="Close adventure">×</button></header>
    <div className="adventure-scroll">
      <div className="adventure-actions"><button disabled={busy} onClick={() => walk(ADVENTURE_CAMP)}>Walk to camp</button><button onClick={() => { onClose(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' })); }}>Choose techniques</button></div>
      {!active && <div className="adventure-card"><h3>Plant an adventure</h3><p>Ready in 18 seconds. Play solo or invite anyone to join. A lost berry never costs your bag or skills.</p><label>Where shall it go? <select value={destination} onChange={e => setDestination(e.target.value)}><option value="market">Market · berries for everyone</option><option value="feast">Giant’s feast · earn its trust</option></select></label><button className="primary-button" disabled={busy || !camp} onClick={() => run(() => actions.expeditionAction('start', 0n, { destination }))}>{camp ? 'Plant strange seed' : 'Visit camp to plant'}</button></div>}
      {e && <div className="adventure-card"><h3>{e.stage === 'growing' ? `Growing · ${Math.max(0, Math.ceil((e.ripeTick - tick) * .6))}s` : e.stage === 'hauling' ? `Cargo · ${e.value} reward berries` : e.stage === 'complete' ? 'Adventure complete' : 'The cargo was lost'}</h3><p role="status">{e.message}</p>
        {active && <><small>{Math.max(0, Math.ceil((e.untilTick - tick) * .6))} seconds left · {members.filter(m => m.expeditionId === e.id).length} adventurers</small>
          <div className="adventure-actions"><button disabled={busy} onClick={() => walk(berry ?? BERRY_PATCH)}>Walk to berry</button><button disabled={busy} onClick={() => walk(goal)}>Walk to {e.destination === 'feast' ? 'feast' : 'market'}</button></div>
          {e.stage === 'hauling' && <><div className="adventure-actions"><button disabled={busy || !!e.carrier && !mine || e.mossCarrying} onClick={() => act(mine ? 'put_down' : 'take')}>{mine ? 'Put down' : 'Carry · both hands'}</button><button disabled={busy} onClick={() => act('roll', goal)}>Roll toward destination</button><button disabled={busy} onClick={() => act(e.destination === 'feast' ? 'feed' : 'deliver')}>Finish delivery</button></div>
            <div className="adventure-actions"><button disabled={busy} onClick={() => act('hide')}>Hide under leaves</button><button disabled={busy || e.split} onClick={() => act('split')}>Split off food</button><button disabled={busy || e.mossCarrying} onClick={() => act('porter')}>Ask Moss to carry</button></div>
            <p className="fine-print">Moss keeps one reward berry unless you equip Porter pact. He drops cargo when frightened. Pip steals unattended bites; bribe him near his position.</p>
            <div className="adventure-actions"><button disabled={busy} onClick={() => act('bait')}>Bait Giant · {hasTechnique(pp, 4) ? '1 wood' : '1 greenberry'}</button><button disabled={busy} onClick={() => walk({ x: e.pipX, z: e.pipZ })}>Walk to Pip</button><button disabled={busy} onClick={() => act('bribe')}>Bribe Pip · 1 greenberry</button></div>
            {mine && players.filter(p => p.online && hex(p.identity) !== myId && members.some(m => hex(m.identity) === hex(p.identity) && m.expeditionId === e.id)).map(p => <button key={hex(p.identity)} disabled={busy || chebyshev(me, p) > 2} onClick={() => act('pass', { target: p.identity })}>Pass to {p.name}</button>)}
            <div className="adventure-actions">{[6,9,10,11].filter(id => hasTechnique(pp,id)).map(id => <button key={id} disabled={busy} onClick={() => act(({6:'track',9:'brace',10:'shove',11:'interrupt'} as Record<number,string>)[id])}>{TECHNIQUES[id].name}</button>)}</div>
          </>}
          <button disabled={busy} onClick={() => act('leave')}>Leave expedition · leave cargo for others</button>
        </>}
      </div>}
      {!active && expeditions.filter(e => ['growing','hauling'].includes(e.stage)).map(e => <div className="adventure-card" key={String(e.id)}><strong>{players.find(p => hex(p.identity) === hex(e.leader))?.name ?? 'An adventurer'}’s berry</strong><p>{e.message}</p><button disabled={busy} onClick={() => run(() => actions.expeditionAction('join', e.id))}>Join expedition</button></div>)}
      <div className="adventure-card"><h3>A camp we build together</h3><p>{project?.wood ?? 0}/20 driftwood · {project?.obsidian ?? 0}/10 obsidian · {project?.meals ?? 0} shared adventures</p><p className="fine-print">Finish the workshop to grow every future expedition berry with one extra reward. Your contributions stay after you leave.</p><div className="adventure-actions"><button disabled={busy || !camp || (project?.wood ?? 0) >= 20} onClick={() => run(() => actions.contributeProject('driftwood'))}>Give 1 driftwood</button><button disabled={busy || !camp || (project?.obsidian ?? 0) >= 10} onClick={() => run(() => actions.contributeProject('obsidian'))}>Give 1 obsidian</button></div></div>
      <div className="adventure-card"><h3>Garden visits</h3><button onClick={() => actions.shareGarden(!gardens.some(g => hex(g.identity) === myId))}>{gardens.some(g => hex(g.identity) === myId) ? 'Hide my garden' : 'Show my garden to others'}</button>{gardens.map(g => <p key={hex(g.identity)}><strong>{players.find(p => hex(p.identity) === hex(g.identity))?.name ?? 'An island gardener'}</strong>: {JSON.parse(g.plants).map((p: { itemId: string }) => getItemDef(p.itemId)?.name).join(', ') || 'Empty beds, ready to plant'}</p>)}</div>
      <div className="adventure-card"><h3>Friendly duels</h3><p className="fine-print">Both agree, three-second countdown. Practice health only; nobody loses their bag. Step outside the safe ring.</p>{players.filter(p => p.online && hex(p.identity) !== myId && chebyshev(me,p) <= 4).map(p => <button key={hex(p.identity)} onClick={() => actions.duelAction('challenge', p.identity)}>Challenge {p.name}</button>)}<p className="fine-print">Find another player within four tiles to challenge them.</p></div>
    </div>
  </section>;
}
