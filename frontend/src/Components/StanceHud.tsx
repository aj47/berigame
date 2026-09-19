import React, { useEffect } from 'react';
import { FIGHT_STATE_NAMES, STANCE_NAMES, Stance } from '@sim';
import { useGameActions } from '../spacetime/actions';
import { useMyPlayer } from '../spacetime/hooks';
import { useChatStore } from '../store';
import { STANCE_ICON } from './3D/StanceBadge';

const ORDER = [Stance.Strike, Stance.Grab, Stance.Guard] as const;
const BEATS: Record<number, string> = {
  [Stance.Strike]: 'beats Grab',
  [Stance.Grab]: 'beats Guard',
  [Stance.Guard]: 'beats Strike',
};

/** Stance picker (1/2/3), current fight state, and Esc to cancel. */
const StanceHud = () => {
  const me = useMyPlayer();
  const { setStance, cancel } = useGameActions();
  const focusedChat = useChatStore((s) => s.focusedChat);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (focusedChat) return;
      if (e.key === '1') setStance(Stance.Strike);
      else if (e.key === '2') setStance(Stance.Grab);
      else if (e.key === '3') setStance(Stance.Guard);
      else if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusedChat, setStance, cancel]);

  if (!me) return null;
  const stateName = FIGHT_STATE_NAMES[me.fightState] ?? 'Neutral';

  return (
    <div className="stance-hud ui-element">
      <div className={`fight-state ${stateName.toLowerCase()}`}>{stateName}</div>
      <div className="stance-buttons">
        {ORDER.map((s, i) => (
          <button
            key={s}
            className={`stance-button ${me.stance === s ? 'active' : ''}`}
            onClick={() => setStance(s)}
            title={`${STANCE_NAMES[s]} ${BEATS[s]} (key ${i + 1})`}
          >
            <span className="stance-icon">{STANCE_ICON[s]}</span>
            <span className="stance-name">{STANCE_NAMES[s]}</span>
            <span className="stance-key">{i + 1}</span>
          </button>
        ))}
      </div>
      <div className="hp-text">HP {me.hp}/{me.maxHp}</div>
    </div>
  );
};

export default StanceHud;
