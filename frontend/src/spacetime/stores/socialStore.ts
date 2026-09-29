import { create } from 'zustand';
import { EventKind, isEmote } from '@sim';
import { attackPresentation } from '../../animation/combatPresentation';
import { emoteCue } from '../../animation/emotes';
import type { DummyEvent, EmoteEvent } from '../../module_bindings/types';
import { useCombatFxStore } from './combatFxStore';

export interface ActiveEmote {
  seq: number;
  emote: number;
  /** performance.now() when it started. */
  at: number;
  durationMs: number;
}

export interface DummyHit {
  seq: number;
  damage: number;
  itemId: string;
  hp: number;
  reset: boolean;
  /** When the blow lands (the attacker's clip impact), performance.now() clock. */
  at: number;
  delayMs: number;
}

interface SocialState {
  seq: number;
  /** identity hex -> the emote playing on that avatar. */
  emotes: Record<string, ActiveEmote>;
  /** dummy id -> the latest landed blow (damage number, wobble). */
  dummyHits: Record<number, DummyHit>;
  /** dummy id -> the HP the last event reported (fresher than the row between ticks). */
  dummyHp: Record<number, number>;
  pushEmote: (e: EmoteEvent) => void;
  pushDummyHit: (e: DummyEvent) => void;
  /** End `hex`'s emote (moving, attacking or dying interrupts it). */
  clearEmote: (hex: string) => void;
}

const HIT_TTL_MS = 1400;

export const useSocialStore = create<SocialState>((set, get) => ({
  seq: 0,
  emotes: {},
  dummyHits: {},
  dummyHp: {},

  pushEmote: (e) => {
    if (!isEmote(e.emote)) return;
    const cue = emoteCue(e.emote);
    if (!cue) return;
    const hex = e.player.toHexString();
    const seq = get().seq + 1;
    set((s) => ({ seq, emotes: { ...s.emotes, [hex]: { seq, emote: e.emote, at: performance.now(), durationMs: cue.durationMs } } }));
    setTimeout(() => { if (get().emotes[hex]?.seq === seq) get().clearEmote(hex); }, cue.durationMs);
  },

  pushDummyHit: (e) => {
    const at = performance.now();
    const seq = get().seq + 1;
    const attack = attackPresentation(EventKind.Hit, e.itemId);
    const attacker = e.attacker.toHexString();
    // The attacker swings exactly as at a player (combatFxStore owns avatar cues).
    if (attack) {
      useCombatFxStore.setState((s) => ({ cues: { ...s.cues, [attacker]: { ...attack.attacker, role: 'action', at, seq: -seq } } }));
      setTimeout(() => useCombatFxStore.setState((s) => {
        if (s.cues[attacker]?.seq !== -seq) return s;
        const cues = { ...s.cues };
        delete cues[attacker];
        return { cues };
      }), attack.attacker.durationMs + 50);
    }
    const hit: DummyHit = { seq, damage: e.damage, itemId: e.itemId, hp: e.hp, reset: e.reset, at, delayMs: attack?.impactMs ?? 0 };
    set((s) => {
      const emotes = { ...s.emotes };
      delete emotes[attacker];
      return { seq, emotes, dummyHits: { ...s.dummyHits, [e.dummyId]: hit }, dummyHp: { ...s.dummyHp, [e.dummyId]: e.hp } };
    });
    setTimeout(() => set((s) => {
      if (s.dummyHits[e.dummyId]?.seq !== seq) return s;
      const dummyHits = { ...s.dummyHits };
      delete dummyHits[e.dummyId];
      return { dummyHits };
    }), HIT_TTL_MS + hit.delayMs);
  },

  clearEmote: (hex) => set((s) => {
    if (!s.emotes[hex]) return s;
    const emotes = { ...s.emotes };
    delete emotes[hex];
    return { emotes };
  }),
}));
