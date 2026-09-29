import React, { useEffect } from 'react';
import { useMyPlayer, usePlayers, useTick } from '../spacetime/hooks';
import { tickClock } from '../spacetime/tickClock';
import { identityHex } from '../spacetime/identity';

/**
 * Tiny dev overlay. Also exposes live state on window.__berigame so browser
 * automation can assert on it without scraping the canvas.
 */
const TickDebug = () => {
  const tick = useTick();
  const players = usePlayers();
  const me = useMyPlayer();
  // Read during render: this component re-renders on every tick anyway. Copying it
  // into state from the effect below scheduled a re-render from inside every
  // tick's passive effects; 50 such commits in a row (an idle client watching
  // someone else play) trip React's "Maximum update depth exceeded" warning.
  const period = Math.round(tickClock.period);

  useEffect(() => {
    (window as any).__berigame = {
      tick,
      period: tickClock.period,
      me: me ? { hex: identityHex(me.identity), x: me.x, z: me.z, hp: me.hp, weapon: me.weapon, state: me.state, name: me.name, target: me.combatTarget ? identityHex(me.combatTarget) : null, hostile: me.hostile } : null,
      players: players.map((p) => ({ hex: identityHex(p.identity), name: p.name, x: p.x, z: p.z, hp: p.hp, weapon: p.weapon, online: p.online, target: p.combatTarget ? identityHex(p.combatTarget) : null, hostile: p.hostile })),
    };
  }, [tick, players, me]);

  if (!(import.meta as any).env?.DEV) return null;
  return (
    <div className="tick-debug">
      tick {tick} · {period}ms · {players.filter((p) => p.online).length} online
    </div>
  );
};

export default TickDebug;
