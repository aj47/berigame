import React, { useEffect, useRef, useState } from 'react';
import { PlayerState } from '@sim';
import { useUserInputStore } from '../store';
import { useGameActions } from '../spacetime/actions';
import { useMyIdentityHex, usePlayersByHex, useTick } from '../spacetime/hooks';
import { useChatPrefsStore } from '../spacetime/stores/chatPrefsStore';
import { useToastStore } from '../spacetime/stores/toastStore';
import { useFrontier } from '../frontier/useFrontier';
import { playerAttackProblem } from './playerAttack';

interface Selection {
  playerChoices: string[];
  playerHex?: string;
  e: { clientX: number; clientY: number };
}

/** Resolve identities against live rows: choosing somebody never performs an action by itself. */
export default function PlayerInteraction({ selected }: { selected: Selection }) {
  const players = usePlayersByHex(), me = useMyIdentityHex(), actions = useGameActions();
  const frontier = useFrontier(), tick = useTick();
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const busy = useRef(false);
  useEffect(() => { setError(''); }, [selected]);
  const muted = useChatPrefsStore(state => state.muted);
  const setSelected = useUserInputStore((state: any) => state.setClickedOtherObject);
  const available = (hex: string) => {
    const player = players.get(hex);
    return hex !== me && player?.online && player.state === PlayerState.Alive ? player : null;
  };
  const choices = selected.playerChoices.filter(hex => available(hex));
  const player = selected.playerHex ? available(selected.playerHex) : null;
  const myPlayer = me ? players.get(me) : undefined;
  const attackProblem = player ? playerAttackProblem(myPlayer, player, frontier, tick) : null;
  const sameRegion = !!myPlayer && !!player && (myPlayer.region || 'bramblewild') === (player.region || 'bramblewild');
  const close = () => setSelected(null);
  const choose = (hex: string) => {
    const row = available(hex);
    if (row) setSelected({ ...selected, playerHex: hex, connectionId: row.name });
  };
  if (!selected.playerHex) return <>
    {choices.map(hex => <button className="context-action player-choice" key={hex} onClick={() => choose(hex)}>
      {players.get(hex)!.name}<span aria-hidden="true">›</span>
    </button>)}
    {!choices.length && <p className="player-picker-hint">These players are no longer available.</p>}
  </>;

  const run = async (fn: () => Promise<boolean>) => {
    if (busy.current) return;
    busy.current = true; setPending(true); setError('');
    try {
      const ok = await fn();
      if (useUserInputStore.getState().clickedOtherObject !== selected) return;
      if (ok !== false) close();
      else setError(useToastStore.getState().message ?? 'Could not complete this action. Try again.');
    } catch (cause) {
      if (useUserInputStore.getState().clickedOtherObject === selected) setError(cause instanceof Error ? cause.message : 'Could not complete this action. Try again.');
    } finally { busy.current = false; setPending(false); }
  };
  return <>
    {selected.playerChoices.length > 1 && <button className="context-action" onClick={() => setSelected({ ...selected, playerHex: undefined, connectionId: 'Choose player' })}>← Choose another player</button>}
    {!player ? <p className="player-picker-hint">This player is no longer available.</p> : <>
      <button className="context-action" disabled={pending || !!attackProblem} aria-describedby={attackProblem ? 'player-attack-reason' : undefined} title={attackProblem ?? 'Walk up and keep attacking. Press Esc or Stop to stop.'} onClick={() => void run(() => actions.attack(player.identity))}>Attack<span aria-hidden="true">›</span></button>
      {attackProblem && <p className="player-picker-hint" id="player-attack-reason">{attackProblem}</p>}
      <button className="context-action" disabled={pending || !sameRegion} onClick={() => void run(() => actions.follow(player.identity))}>Follow<span aria-hidden="true">›</span></button>
      <button className="context-action" disabled={pending || !sameRegion} onClick={() => void run(() => actions.requestTrade(player.identity))}>Trade<span aria-hidden="true">›</span></button>
      {error && <p className="player-picker-hint" role="alert">{error}</p>}
      <button className="context-action" onClick={() => {
        const prefs = useChatPrefsStore.getState(), hex = selected.playerHex!;
        const wasMuted = prefs.muted.has(hex);
        prefs.toggleMute(hex);
        useToastStore.getState().show(wasMuted ? `${player.name} unmuted` : `${player.name} muted: you will not see their chat`);
        close();
      }}>{muted.has(selected.playerHex) ? 'Unmute chat' : 'Mute chat'}<span aria-hidden="true">›</span></button>
    </>}
  </>;
}
