import { create } from 'zustand';
import { EventKind } from '@sim';
import { exchangePresentation, type AnimationCue } from '../../animation/combatPresentation';
import type { CombatEvent } from '../../module_bindings/types';

export interface FloatingNumber {
  seq: number;
  kind: number;
  amount: number;
  text: string;
  at: number;
  delayMs: number;
}

interface CombatFxState {
  seq: number;
  /** identity hex -> number to float above that player */
  numbers: Record<string, FloatingNumber>;
  /** identity hex -> bumps every time that player swings */
  attackSeq: Record<string, number>;
  cues: Record<string, AnimationCue>;
  pushEvent: (e: CombatEvent) => void;
  clearNumber: (hex: string, seq: number) => void;
}

const NUMBER_TTL_MS = 1400;

export const useCombatFxStore = create<CombatFxState>((set, get) => ({
  seq: 0,
  numbers: {},
  attackSeq: {},
  cues: {},

  pushEvent: (e) => {
    const attacker = e.attacker.toHexString();
    const defender = e.defender.toHexString();
    const at = performance.now();
    set((s) => {
      const seq = s.seq + 1;
      const numbers = { ...s.numbers };
      const attackSeq = { ...s.attackSeq };
      const cues = { ...s.cues };
      const exchange = exchangePresentation(e.kind, e.attackerStance, e.defenderStance);
      if (exchange) {
        cues[attacker] = { ...exchange.attacker, at, seq };
        cues[defender] = { ...exchange.defender, at, seq };
        setTimeout(() => set((state) => {
          const next = { ...state.cues };
          for (const hex of [attacker, defender]) if (next[hex]?.seq === seq) delete next[hex];
          return { cues: next };
        }), NUMBER_TTL_MS);
      }
      const float = (hex: string, text: string, amount = 0) => {
        numbers[hex] = { seq, kind: e.kind, amount, text, at, delayMs: exchange?.impactMs ?? 0 };
        setTimeout(() => get().clearNumber(hex, seq), NUMBER_TTL_MS + (exchange?.impactMs ?? 0));
      };
      switch (e.kind) {
        case EventKind.Hit:
          attackSeq[attacker] = (attackSeq[attacker] ?? 0) + 1;
          float(defender, String(e.damage), e.damage);
          break;
        case EventKind.Counter:
          attackSeq[attacker] = (attackSeq[attacker] ?? 0) + 1;
          float(attacker, String(e.damage), e.damage);
          break;
        case EventKind.Clash:
          attackSeq[attacker] = (attackSeq[attacker] ?? 0) + 1;
          float(defender, '');
          break;
        case EventKind.Eat:
          float(defender, `+${e.damage}`, e.damage);
          break;
        case EventKind.Death:
          // The defeat animation communicates this without another floating label.
          delete numbers[defender];
          break;
        case EventKind.HarvestDone:
          float(defender, '+1');
          break;
        default:
          break;
      }
      return { seq, numbers, attackSeq, cues };
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
