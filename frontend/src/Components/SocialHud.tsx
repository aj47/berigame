import React, { useEffect, useRef, useState } from 'react';
import { EMOTE_LIST, PlayerState, chebyshev } from '@sim';
import { useMyPlayer, useTick } from '../spacetime/hooks';
import { useGameActions } from '../spacetime/actions';
import { bagLifeLeft, compassAngle, formatTicks, useCameraLook, useMyDeathBag } from '../spacetime/deathBag';
import { useLoadingStore } from '../store';
import { isTyping } from './keyboard';
import './social.css';

export const EMOTE_KEY = 'e';

/**
 * The defeat panel. While you are down: what happened, where your things
 * fell and the respawn countdown. Afterwards, while your death piles exist: a
 * compact compass to them with the time left before they vanish.
 */
export const DeathPanel = () => {
  const me = useMyPlayer();
  const tick = useTick();
  const bag = useMyDeathBag();
  const look = useCameraLook();
  const [dismissed, setDismissed] = useState<number | null>(null);
  if (!me) return null;
  const dead = me.state === PlayerState.Dead;
  if (!dead && (!bag || dismissed === bag.droppedTick)) return null;
  const left = bag ? bag.expiresTick - tick : 0;
  const life = bag ? bagLifeLeft(bag, tick) : 0;
  const distance = bag ? chebyshev(me, bag) : 0;
  const angle = bag && !dead ? compassAngle(me, bag, look) : 0;
  return (
    <section className={`death-panel ${dead ? 'down' : 'compact'}`} role="status" aria-live="polite" data-testid="death-panel">
      {dead && <strong className="death-title">You were defeated</strong>}
      {bag ? (
        <div className="death-bag-line">
          {!dead && (
            <span className="bag-compass" aria-hidden="true" style={{ transform: `rotate(${angle}rad)` }} data-angle={angle.toFixed(2)}><svg viewBox="0 0 20 20"><path d="M10 1 L17 9 L12.5 9 L12.5 19 L7.5 19 L7.5 9 L3 9 Z" /></svg></span>
          )}
          <span>
            {dead ? 'Your bag lies at ' : 'Your bag · '}
            <b>{bag.x},{bag.z}</b>
            {!dead && <> · {distance === 0 ? 'here' : `${distance} tiles`}</>}
            {' · '}
            <span className={life < 0.25 ? 'bag-urgent' : ''}>{formatTicks(left)} left</span>
          </span>
          {!dead && <button className="death-dismiss" aria-label="Hide the bag compass" onClick={() => setDismissed(bag.droppedTick)}>×</button>}
        </div>
      ) : dead ? <span className="death-bag-line">You carried nothing, so nothing was dropped.</span> : null}
      {dead && <span className="death-respawn">Back on your feet in {formatTicks(Math.max(0, me.respawnTick - tick))}</span>}
      {bag && <div className="bag-life" aria-hidden="true"><div style={{ width: `${life * 100}%` }} /></div>}
    </section>
  );
};

/** The emote wheel: a button and the E key open it; 1-4 or a click picks an emote. */
export const EmoteWheel = () => {
  const [open, setOpen] = useState(false);
  const { emote } = useGameActions();
  const me = useMyPlayer();
  const latest = useRef({ open, emote });
  latest.current = { open, emote };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() === EMOTE_KEY && !e.repeat) { setOpen((v) => !v); e.preventDefault(); return; }
      if (!latest.current.open) return;
      const index = ['1', '2', '3', '4'].indexOf(e.key);
      if (index >= 0 && EMOTE_LIST[index]) {
        // Claim the digit before the quick bar sees it.
        e.preventDefault(); e.stopImmediatePropagation();
        latest.current.emote(EMOTE_LIST[index].id);
        setOpen(false);
      } else if (e.key === 'Escape') { e.stopImmediatePropagation(); setOpen(false); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  if (!me || me.state === PlayerState.Dead) return null;
  return (
    <div className={`emote-wheel ${open ? 'open' : ''}`}>
      {open && (
        <div className="emote-ring" role="menu" aria-label="Emotes">
          {EMOTE_LIST.map((def, i) => (
            <button key={def.key} role="menuitem" className={`emote-option emote-${def.key}`} style={{ '--i': i } as React.CSSProperties}
              onClick={() => { emote(def.id); setOpen(false); }} title={`${def.name} (${i + 1})`}>
              <span>{def.name}</span>
              <kbd>{i + 1}</kbd>
            </button>
          ))}
        </div>
      )}
      <button className="emote-toggle" aria-expanded={open} aria-label="Emotes (E)" title="Emotes (E)" onClick={() => setOpen((v) => !v)}>
        <span>Emote</span><kbd>E</kbd>
      </button>
    </div>
  );
};

const SocialHud = () => {
  const loading = useLoadingStore((s: any) => s.isLoading);
  if (loading) return null;
  return (
    <div className="social-hud">
      <DeathPanel />
      <EmoteWheel />
    </div>
  );
};

export default SocialHud;
