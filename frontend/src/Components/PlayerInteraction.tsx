import React from 'react';
import { PlayerState } from '@sim';
import { useUserInputStore } from '../store';
import { useGameActions } from '../spacetime/actions';
import { useMyIdentityHex, usePlayersByHex } from '../spacetime/hooks';
import { useChatPrefsStore } from '../spacetime/stores/chatPrefsStore';
import { useToastStore } from '../spacetime/stores/toastStore';

interface Selection {
  playerChoices: string[];
  playerHex?: string;
  e: { clientX: number; clientY: number };
}

/** Resolve identities against live rows: choosing somebody never performs an action by itself. */
export default function PlayerInteraction({ selected }: { selected: Selection }) {
  const players = usePlayersByHex(), me = useMyIdentityHex(), actions = useGameActions();
  const friends = useChatPrefsStore(state => state.friends), muted = useChatPrefsStore(state => state.muted);
  const setSelected = useUserInputStore((state: any) => state.setClickedOtherObject);
  const available = (hex: string) => {
    const player = players.get(hex);
    return hex !== me && player?.online && player.state === PlayerState.Alive ? player : null;
  };
  const choices = selected.playerChoices.filter(hex => available(hex));
  const player = selected.playerHex ? available(selected.playerHex) : null;
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

  const run = (fn: () => unknown) => { fn(); close(); };
  return <>
    {selected.playerChoices.length > 1 && <button className="context-action" onClick={() => setSelected({ ...selected, playerHex: undefined, connectionId: 'Choose player' })}>← Choose another player</button>}
    {!player ? <p className="player-picker-hint">This player is no longer available.</p> : <>
      <button className="context-action" onClick={() => run(() => actions.attack(player.identity))}>Attack<span aria-hidden="true">›</span></button>
      <button className="context-action" onClick={() => run(() => actions.follow(player.identity))}>Follow<span aria-hidden="true">›</span></button>
      <button className="context-action" onClick={() => run(() => actions.requestTrade(player.identity))}>Trade<span aria-hidden="true">›</span></button>
      {!friends.has(selected.playerHex) && <button className="context-action" onClick={() => run(() => actions.addFriend(player.identity))}>Add friend<span aria-hidden="true">›</span></button>}
      <button className="context-action" onClick={() => run(() => {
        const prefs = useChatPrefsStore.getState(), hex = selected.playerHex!;
        const wasMuted = prefs.muted.has(hex);
        prefs.toggleMute(hex);
        useToastStore.getState().show(wasMuted ? `${player.name} unmuted` : `${player.name} muted: you will not see their chat`);
      })}>{muted.has(selected.playerHex) ? 'Unmute chat' : 'Mute chat'}<span aria-hidden="true">›</span></button>
    </>}
  </>;
}
