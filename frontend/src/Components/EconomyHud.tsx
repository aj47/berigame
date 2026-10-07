import React, { useMemo } from 'react';
import { LOAD_GLOW_VALUE, atGroveVault, carriedValue, dropBoxInReach, energyView, loadLevel } from '@sim';
import { useInventoryRows, useMyEnergy, useMyPlayer, useNow } from '../spacetime/hooks';
import { slotsFromRows } from './itemUi';
import './economy.css';

const BAND_LABEL = { rested: 'Rested ×2', normal: 'Energy', tired: 'Tired' } as const;

function duration(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * The economy strip under the health bar: the gathering energy meter, the value
 * you carry unbanked (what you drop if defeated), and a Bank button where your
 * vault opens (the Grove safe ring) or a Coast drop box takes deposits.
 */
export default function EconomyHud({ onOpenVault }: { onOpenVault?: () => void }) {
  const me = useMyPlayer();
  const rows = useInventoryRows();
  const stored = useMyEnergy();
  const now = useNow(5000);
  const carried = useMemo(() => carriedValue(slotsFromRows(rows)), [rows]);
  if (!me) return null;
  const energy = energyView(stored, now);
  const level = loadLevel(carried);
  const fill = Math.round((energy.points / Math.max(1, energy.max)) * 100);
  const line = Math.round((energy.restedLine / Math.max(1, energy.max)) * 100);
  const home = !me.region || me.region === 'bramblewild';
  const atVault = home && atGroveVault(me);
  const box = home && !atVault ? dropBoxInReach(me) : undefined;
  const rules = 'Rested (above the line) gathering pays double; with nothing left only one gather in four pays. Online it refills up to the line; time logged out fills it above';
  // Before your first harvest the server has not sized your meter yet (it depends on your character's age), so no numbers.
  const energyTitle = stored
    ? `${energy.points} of ${energy.max} seconds of gathering. ${rules}${energy.refillInMs ? `. Back at the line in ${duration(energy.refillInMs)}` : ''}.`
    : `Gathering pays normally. ${rules}.`;
  return (
    <div className="hud-economy">
      <div
        className={`energy-meter ${energy.band}`}
        role="meter"
        aria-label={`Energy: ${BAND_LABEL[energy.band]}`}
        aria-valuenow={energy.points}
        aria-valuemin={0}
        aria-valuemax={energy.max}
        title={energyTitle}
      >
        <div className="energy-fill" style={{ width: `${fill}%` }} />
        <div className="energy-line" style={{ left: `${line}%` }} aria-hidden="true" />
        <span>{BAND_LABEL[energy.band]}</span>
      </div>
      {carried > 0 && (
        <span
          className={`carry-chip load-${level}`}
          title={`Unbanked value ${carried}. Everything in your bag drops if you are defeated${carried >= LOAD_GLOW_VALUE ? ', and other players can see you glow' : ''}. Bank it in the Grove safe ring or at a Coast drop box.`}
        >
          Unbanked {carried}
        </span>
      )}
      {(atVault || box) && onOpenVault && (
        <button type="button" className="bank-button" onClick={onOpenVault} title={atVault ? 'Open your vault' : `Deposit at the ${box!.name}`}>
          {atVault ? 'Vault' : 'Drop box'}
        </button>
      )}
    </div>
  );
}
