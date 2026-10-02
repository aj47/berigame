import React from 'react';
import { GIANT_FEAST_BONUS, EXPEDITION_COMPLETION_XP, expeditionPayout, giantFriendship } from '@sim';
import './berryGiant.css';

export function GiantFriendship({ feasts }: { feasts: number }) {
  const friendship = giantFriendship(feasts);
  return <div className="giant-friendship" aria-label="Berry Giant friendship">
    <div><strong>{friendship.label}</strong><span aria-label={`${friendship.tier} of 3 friendship hearts`} className="giant-hearts">{'♥'.repeat(friendship.tier)}<span aria-hidden="true">{'♡'.repeat(3 - friendship.tier)}</span></span></div>
    <p>{friendship.pauseSeconds ? `+${friendship.pauseSeconds}s before he chases berries you grow.` : 'First feast: a keepsake + 12s extra head start.'}</p>
    {friendship.nextFeasts !== null && feasts > 0 && <small>{Math.max(0, friendship.nextFeasts - feasts)} more {friendship.nextFeasts - feasts === 1 ? 'feast' : 'feasts'} to the next heart</small>}
  </div>;
}

export function FeastRewards({ value, firstFeast = false, earned = false }: { value?: number; firstFeast?: boolean; earned?: boolean }) {
  return <div className={`giant-rewards${earned ? ' is-earned' : ''}`} aria-label={earned ? 'Feast rewards earned' : 'Feast rewards'}>
    <div><img src="/items/goldberry.png" alt="" /><strong>{value === undefined ? `+${GIANT_FEAST_BONUS} bonus goldberries` : `${earned ? '+' : ''}${expeditionPayout(value, true)} goldberries`}</strong></div>
    <span>{earned ? '+' : ''}{EXPEDITION_COMPLETION_XP} Befriending XP · completion bonus</span>
    {firstFeast && <div className="giant-keepsake-reward"><span aria-hidden="true">♥</span><strong>Berry Heart keepsake</strong><small>{earned ? 'Character → Details' : 'Your first feast'}</small></div>}
    {!earned && <small>Every helper earns a share. Keep the berry whole for more!</small>}
  </div>;
}
