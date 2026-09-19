import { Html } from '@react-three/drei';
import React from 'react';
import { FightState, STANCE_NAMES, Stance } from '@sim';

export const STANCE_ICON: Record<number, string> = {
  [Stance.Strike]: '👊',
  [Stance.Grab]: '✋',
  [Stance.Guard]: '🛡️',
};

const STATE_CLASS: Record<number, string> = {
  [FightState.Neutral]: 'neutral',
  [FightState.Advantage]: 'advantage',
  [FightState.Disadvantage]: 'disadvantage',
};

/** Stance icon (visible to everyone) tinted by the player's fight state. */
const StanceBadge = ({ stance, fightState, yOffset }: { stance: number; fightState: number; yOffset: number }) => (
  <Html zIndexRange={[4, 0]} center position={[0, yOffset, 0]} className={`stance-badge ${STATE_CLASS[fightState] ?? 'neutral'}`}>
    <span title={STANCE_NAMES[stance]}>{STANCE_ICON[stance] ?? '?'}</span>
  </Html>
);

export default StanceBadge;
