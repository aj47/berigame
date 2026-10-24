import React, { memo, useRef, useState } from 'react';
import {
  LEDGER_FULL_BONUS_SEALS, LEDGER_SEAL_ITEM_ID, LEDGER_SEALS, LEDGER_SLOTS, SKILLS,
  getItemDef, ledgerDay, ledgerFor, ledgerResetInMs, levelForXp, nearLedgerClerk, nearestLedgerClerk,
} from '@sim';
import { useGameActions } from '../spacetime/actions';
import { useInventoryRows, useLedger, useMyIdentityHex, useMyPlayer, useMySkills, useNow } from '../spacetime/hooks';
import { useToastStore } from '../spacetime/stores/toastStore';
import './crafting.css';
import './ledger.css';

const MASS_NOUNS = new Set(['driftwood', 'coral', 'amber', 'moonstone', 'star iron', 'berry mash', 'sunpeach preserves', 'starpetal incense', 'honeycomb']);

/** "6 more pearls", "1 more stone club", "4 more driftwood". */
export function moreOf(count: number, name: string): string {
  const lower = name.toLowerCase();
  if (count === 1 || MASS_NOUNS.has(lower)) return `${count} more ${lower}`;
  if (/[^aeiou]y$/.test(lower)) return `${count} more ${lower.slice(0, -1)}ies`;
  if (/(s|sh|ch|x)$/.test(lower)) return `${count} more ${lower}es`;
  return `${count} more ${lower}s`;
}

export function formatReset(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** The Island Ledger: today's three commissions, handed in at any ledger clerk (the nearest is offered). */
const LedgerPanel = memo(({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const me = useMyPlayer();
  const hex = useMyIdentityHex();
  const skills = useMySkills();
  const rows = useInventoryRows();
  const state = useLedger();
  const now = useNow(30_000);
  const { deliverCommission, setTarget } = useGameActions();
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState('');
  const busy = useRef(false);
  if (!open) return null;

  const levels = [levelForXp(skills?.foragingXp ?? 0), levelForXp(skills?.beachcombingXp ?? 0), levelForXp(skills?.craftingXp ?? 0)];
  const day = ledgerDay(now);
  const commissions = hex ? ledgerFor(hex, day, levels, state) : [];
  const carried = (itemId: string) => rows.reduce((total, row) => total + (row.itemId === itemId ? row.quantity : 0), 0);
  const seals = carried(LEDGER_SEAL_ITEM_ID);
  const near = !!me && nearLedgerClerk({ x: me.x, z: me.z });
  const clerk = nearestLedgerClerk(me ? { x: me.x, z: me.z } : { x: 0, z: 0 });
  const doneCount = commissions.filter((c) => c.done).length;

  const deliver = async (slot: number) => {
    if (busy.current) return;
    busy.current = true;
    setPending(slot);
    setError('');
    try {
      if (await deliverCommission(slot) === false) setError(useToastStore.getState().message ?? 'Could not hand that in. Try again.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not hand that in. Try again.');
    } finally {
      busy.current = false;
      setPending(null);
    }
  };

  return <section className="game-panel crafting-panel ledger-panel" aria-label="Island Ledger">
    <header className="panel-heading">
      <h2>Island Ledger <small>{doneCount}/{LEDGER_SLOTS} today</small></h2>
      <button className="close-button" onClick={onClose} aria-label="Close ledger">×</button>
    </header>
    <div className="ledger-summary">
      <span className="ledger-seals" aria-label={`${seals} ledger seals`}>
        <img src={getItemDef(LEDGER_SEAL_ITEM_ID)?.icon} alt="" /><strong>{seals}</strong> seals
      </span>
      <span className="ledger-reset">New commissions in {formatReset(ledgerResetInMs(now))}</span>
    </div>
    <p className="ledger-hint">
      Each pays {LEDGER_SEALS} seal; finish all three for {LEDGER_FULL_BONUS_SEALS} more.
      {!near && <> <button type="button" className="link-button" onClick={() => setTarget(clerk.x, clerk.z)}>Walk to the {clerk.name}</button></>}
    </p>
    {error && <p role="alert" className="craft-error">{error}</p>}
    <div className="recipe-list" role="list" aria-label="Today's commissions">
      {commissions.map((c) => {
        const item = getItemDef(c.itemId);
        const name = item?.name ?? c.itemId;
        const have = carried(c.itemId);
        const short = Math.max(0, c.quantity - have);
        const reason = c.done ? 'Handed in. Come back tomorrow.'
          : short > 0 ? `You need ${moreOf(short, name)}`
            : !near ? `Bring it to the ${clerk.name}` : 'Ready to hand in';
        const can = !c.done && short === 0 && near;
        const last = !c.done && doneCount === LEDGER_SLOTS - 1;
        return <article role="listitem" key={c.slot} className={`craft-recipe ledger-commission${c.done ? ' is-done' : ''}`}
          data-slot={c.slot} data-ready={can} data-done={c.done}>
          <div className="craft-recipe-heading">
            <img src={item?.icon} alt="" />
            <div>
              <h4>{name} <small>×{c.quantity}</small></h4>
              <span>+{c.xp} {SKILLS[c.skill]?.name} XP · +{LEDGER_SEALS + (last ? LEDGER_FULL_BONUS_SEALS : 0)} seal{last ? 's' : ''}</span>
            </div>
            <button type="button" aria-label={c.done ? `${name} handed in` : `Hand in ${name}`}
              disabled={!can || pending !== null} aria-describedby={`ledger-reason-${c.slot}`}
              onClick={() => void deliver(c.slot)}>
              {c.done ? '✓ Done' : pending === c.slot ? '…' : 'Hand in'}
            </button>
          </div>
          {!c.done && <ul className="craft-ingredients" aria-label={`${name} carried`}>
            <li data-missing={short > 0} aria-label={`${name}: ${have} carried, ${c.quantity} needed`}>
              <img src={item?.icon} alt="" /><span>In your bag</span><strong>{Math.min(have, c.quantity)}/{c.quantity}</strong>
            </li>
          </ul>}
          <p className="craft-recipe-note" id={`ledger-reason-${c.slot}`}>{reason}</p>
        </article>;
      })}
    </div>
  </section>;
});

export default LedgerPanel;
