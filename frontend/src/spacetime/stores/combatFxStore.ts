import { create } from 'zustand';
import { EventKind, getItemDef } from '@sim';
import { attackPresentation, type AnimationCue } from '../../animation/combatPresentation';
import type { CombatEvent } from '../../module_bindings/types';
import { onCombatEvent } from '../../fx/combatFx';

export interface FloatingNumber {
  seq: number;
  kind: number;
  amount: number;
  text: string;
  /** The event's item: the attacker's weapon for a Hit ('' = punch), the item for a harvest or find. */
  itemId: string;
  at: number;
  delayMs: number;
}

interface CombatFxState {
  seq: number;
  /** identity hex -> damage, healing or harvest number to float above that player */
  numbers: Record<string, FloatingNumber>;
  /**
   * identity hex -> bonus item a harvest turned up. Kept apart from `numbers`
   * so the harvest's own '+1' (same tick, either insert order) cannot replace it.
   */
  finds: Record<string, FloatingNumber>;
  cues: Record<string, AnimationCue>;
  pushEvent: (e: CombatEvent) => void;
  clearNumber: (hex: string, seq: number) => void;
}

const NUMBER_TTL_MS = 1400;
/** A find floats up once the harvest '+1' has risen out of the way. */
const FIND_DELAY_MS = 600;

export const useCombatFxStore = create<CombatFxState>((set, get) => ({
  seq: 0,
  numbers: {},
  finds: {},
  cues: {},

  pushEvent: (e) => {
    const attacker = e.attacker.toHexString();
    const defender = e.defender.toHexString();
    const at = performance.now();
    set((s) => {
      const seq = s.seq + 1;
      const numbers = { ...s.numbers };
      let finds = s.finds;
      const cues = { ...s.cues };
      const attack = attackPresentation(e.kind, e.itemId);
      if (attack) {
        cues[attacker] = { ...attack.attacker, role: 'action', at, seq };
        // The defender flinches when the blow lands. Never cut their own swing short:
        // one still playing at impact wins, and one ending before impact finishes
        // first, with the flinch queued behind it.
        const reaction: AnimationCue = { ...attack.defender, role: 'reaction', at: at + attack.impactMs, seq, attacker };
        const current = cues[defender];
        const swingEnds = current?.role === 'action' ? current.at + current.durationMs : -Infinity;
        if (defender !== attacker && swingEnds <= reaction.at) {
          cues[defender] = swingEnds > at ? { ...current!, then: reaction } : reaction;
        }
        setTimeout(() => set((state) => {
          const next = { ...state.cues };
          for (const hex of [attacker, defender]) if (next[hex]?.seq === seq) delete next[hex];
          return { cues: next };
        }), NUMBER_TTL_MS);
      }
      const float = (hex: string, text: string, amount = 0, delayMs = attack?.impactMs ?? 0) => {
        numbers[hex] = { seq, kind: e.kind, amount, text, itemId: e.itemId, at, delayMs };
        setTimeout(() => get().clearNumber(hex, seq), NUMBER_TTL_MS + delayMs);
      };
      switch (e.kind) {
        case EventKind.Hit:
          // Lands with the attacker's clip: 160ms for a punch, later for the stick's wind-up.
          float(defender, String(e.damage), e.damage);
          break;
        case EventKind.Eat:
          // Eating never sets a cue, so an attack in progress keeps playing.
          float(defender, `+${e.damage}`, e.damage);
          break;
        case EventKind.Death:
          // The defeat animation communicates this without another floating label.
          delete numbers[defender];
          break;
        case EventKind.HarvestDone:
          float(defender, '+1');
          break;
        case EventKind.ItemFound: {
          finds = { ...s.finds, [defender]: { seq, kind: e.kind, amount: 1, text: `+ ${getItemDef(e.itemId)?.name ?? e.itemId}`, itemId: e.itemId, at, delayMs: FIND_DELAY_MS } };
          setTimeout(() => set((state) => {
            if (state.finds[defender]?.seq !== seq) return state;
            const next = { ...state.finds };
            delete next[defender];
            return { finds: next };
          }), NUMBER_TTL_MS + FIND_DELAY_MS);
          break;
        }
        default:
          break;
      }
      // Sounds, hit flash and impact dust, timed to the same impact.
      onCombatEvent(e.kind, e.itemId, attacker, defender, at, attack?.impactMs ?? 0);
      return { seq, numbers, finds, cues };
    });
  },

  clearNumber: (hex, seq) =>
    set((s) => {
      if (s.numbers[hex]?.seq !== seq) return s;
      const numbers = { ...s.numbers };
      delete numbers[hex];
      return { numbers };
    }),
}));
