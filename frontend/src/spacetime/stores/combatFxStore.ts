import { create } from 'zustand';
import { EventKind } from '@sim';
import type { CombatEvent } from '../../module_bindings/types';

export interface FloatingNumber {
  seq: number;
  kind: number;
  amount: number;
  text: string;
  at: number;
}

interface CombatFxState {
  seq: number;
  /** identity hex -> number to float above that player */
  numbers: Record<string, FloatingNumber>;
  /** identity hex -> bumps every time that player swings */
  attackSeq: Record<string, number>;
  pushEvent: (e: CombatEvent) => void;
  clearNumber: (hex: string, seq: number) => void;
}

const NUMBER_TTL_MS = 1400;

export const useCombatFxStore = create<CombatFxState>((set, get) => ({
  seq: 0,
  numbers: {},
  attackSeq: {},

  pushEvent: (e) => {
    const attacker = e.attacker.toHexString();
    const defender = e.defender.toHexString();
    const at = performance.now();
    set((s) => {
      const seq = s.seq + 1;
      const numbers = { ...s.numbers };
      const attackSeq = { ...s.attackSeq };
      const float = (hex: string, text: string, amount = 0) => {
        numbers[hex] = { seq, kind: e.kind, amount, text, at };
        setTimeout(() => get().clearNumber(hex, seq), NUMBER_TTL_MS);
      };
      switch (e.kind) {
        case EventKind.Hit:
          attackSeq[attacker] = (attackSeq[attacker] ?? 0) + 1;
          float(defender, String(e.damage), e.damage);
          break;
        case EventKind.Counter:
          attackSeq[attacker] = (attackSeq[attacker] ?? 0) + 1;
          float(attacker, `COUNTER ${e.damage}`, e.damage);
          break;
        case EventKind.Clash:
          attackSeq[attacker] = (attackSeq[attacker] ?? 0) + 1;
          float(defender, 'CLASH');
          break;
        case EventKind.Eat:
          float(defender, `+${e.damage}`, e.damage);
          break;
        case EventKind.Death:
          float(defender, '💀');
          break;
        case EventKind.HarvestDone:
          float(defender, '+1 berry');
          break;
        default:
          break;
      }
      return { seq, numbers, attackSeq };
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
