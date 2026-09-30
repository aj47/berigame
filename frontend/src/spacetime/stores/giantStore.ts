import { create } from 'zustand';
import { EventKind, GiantEventKind, RaidOutcome, getItemDef } from '@sim';
import { attackPresentation } from '../../animation/combatPresentation';
import type { GiantEvent } from '../../module_bindings/types';
import { useCombatFxStore } from './combatFxStore';
import { useToastStore } from './toastStore';

export interface GiantHit {
  seq: number;
  damage: number;
  itemId: string;
  hp: number;
  /** When the blow lands (the attacker's clip impact), performance.now() clock. */
  at: number;
  delayMs: number;
}

interface GiantFxState {
  seq: number;
  /** The latest landed blow on the Giant (damage number, flinch). */
  hit: GiantHit | null;
  /** HP the last hit reported (fresher than the row between ticks). */
  hp: number | null;
  /** performance.now() of the last slam/stomp landing (the dust burst and the slam pose). */
  slamAt: number;
  /** performance.now() of the last defeat. */
  defeatAt: number;
  /** World-wide raid lines (announcements, wake, sleep) shown in chat as system lines. */
  systemLines: readonly RaidLine[];
  pushEvent: (e: GiantEvent, meHex: string | null) => void;
}

export interface RaidLine { id: number; at: number; text: string }
const MAX_LINES = 12;
let lastLineKey = '';

/** The text of a world-wide raid event, or null for fight events. */
export function raidLineText(e: Pick<GiantEvent, 'kind' | 'quantity' | 'hp'>): string | null {
  switch (e.kind) {
    case GiantEventKind.Announce:
      return e.quantity === 1 ? 'The Giant stirs in the Boulders: it wakes in 1 minute!' : `The Giant stirs in the Boulders: it wakes in ${e.quantity} minutes.`;
    case GiantEventKind.Wake:
      return `The Giant is awake! Raid on in the Boulders (${e.hp} HP). Bring a stone club.`;
    case GiantEventKind.Sleep:
      return e.quantity === RaidOutcome.Defeated ? 'The Giant falls and sleeps again. Well fought!' : 'The Giant grew bored and went back to sleep.';
    default:
      return null;
  }
}

const HIT_TTL_MS = 1400;
const NUMBER_TTL_MS = 1400;

/** Float `text` over a player through the shared combat FX numbers (no swing cue: the Giant is not a player). */
function floatOnPlayer(hex: string, text: string, amount: number) {
  const at = performance.now();
  useCombatFxStore.setState((s) => {
    const seq = s.seq + 1;
    setTimeout(() => useCombatFxStore.getState().clearNumber(hex, seq), NUMBER_TTL_MS);
    return { seq, numbers: { ...s.numbers, [hex]: { seq, kind: EventKind.Hit, amount, text, itemId: '', at, delayMs: 0 } } };
  });
}

/** Giant events (an event table): blows on it, its slams on players, defeats and rewards. */
export const useGiantStore = create<GiantFxState>((set, get) => ({
  seq: 0,
  hit: null,
  hp: null,
  slamAt: -Infinity,
  defeatAt: -Infinity,
  systemLines: [],

  pushEvent: (e, meHex) => {
    const at = performance.now();
    const hex = e.player.toHexString();
    const line = raidLineText(e);
    if (line) {
      // One line per server event, even if the insert callback fires twice for it.
      const key = `${e.tick}:${e.kind}:${e.quantity}`;
      if (key === lastLineKey) return;
      lastLineKey = key;
      const lines = get().systemLines;
      const id = (lines[lines.length - 1]?.id ?? 0) + 1;
      set({ systemLines: [...lines, { id, at: Date.now(), text: line }].slice(-MAX_LINES) });
      useToastStore.getState().show(line);
      if (e.kind === GiantEventKind.Wake) set({ hp: null, hit: null });
      return;
    }
    switch (e.kind) {
      case GiantEventKind.Hit: {
        const seq = get().seq + 1;
        const attack = attackPresentation(EventKind.Hit, e.itemId);
        // The attacker swings exactly as at a player (combatFxStore owns avatar cues).
        if (attack) {
          useCombatFxStore.setState((s) => ({ cues: { ...s.cues, [hex]: { ...attack.attacker, role: 'action', at, seq: -seq } } }));
          setTimeout(() => useCombatFxStore.setState((s) => {
            if (s.cues[hex]?.seq !== -seq) return s;
            const cues = { ...s.cues };
            delete cues[hex];
            return { cues };
          }), attack.attacker.durationMs + 50);
        }
        set({ seq, hit: { seq, damage: e.damage, itemId: e.itemId, hp: e.hp, at, delayMs: attack?.impactMs ?? 0 }, hp: e.hp });
        setTimeout(() => { if (get().hit?.seq === seq) set({ hit: null }); }, HIT_TTL_MS + (attack?.impactMs ?? 0));
        break;
      }
      case GiantEventKind.Slam:
        set({ slamAt: at });
        break;
      case GiantEventKind.PlayerHit:
        floatOnPlayer(hex, String(e.damage), e.damage);
        break;
      case GiantEventKind.Defeat:
        set({ defeatAt: at, hp: 0 });
        break;
      case GiantEventKind.Respawn:
        set({ hp: null, hit: null });
        break;
      case GiantEventKind.Reward:
        if (hex === meHex) {
          const name = getItemDef(e.itemId)?.name ?? e.itemId;
          useToastStore.getState().show(`The Giant falls! You earned ${e.quantity} ${name.toLowerCase()} and the Giant's Tooth`);
        }
        break;
    }
  },
}));
