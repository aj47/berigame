import React, { useMemo, useRef, useState } from 'react';
import {
  DROP_BOXES, DROP_BOX_DEPOSIT_TICKS, GROVE_VAULT_TILE, Pending, PlayerState, TICK_MS, atGroveVault, carriedValue, chebyshev,
  dropBoxInReach, getItemDef, type Slot,
} from '@sim';
import { useGameActions } from '../spacetime/actions';
import { useInventoryRows, useMyPlayer, useMyVaultSlots } from '../spacetime/hooks';
import { slotsFromRows } from './itemUi';
import './economy.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

const AMOUNTS = [{ value: 0, label: 'Whole stack' }, { value: 1, label: '1 item' }, { value: 5, label: 'Up to 5' }, { value: 10, label: 'Up to 10' }];

/** Merge slots into one row per item, in first-seen order. */
function stacks(slots: readonly Slot[]): { itemId: string; quantity: number }[] {
  const out = new Map<string, number>();
  for (const s of slots) if (s) out.set(s.itemId, (out.get(s.itemId) ?? 0) + s.quantity);
  return [...out.entries()].map(([itemId, quantity]) => ({ itemId, quantity }));
}

/**
 * Your personal vault in Bramblewild: the same storage as the Meadows town
 * bank. In the Grove's safe ring you deposit and withdraw at once; at a Coast
 * drop box you can only deposit, it takes a few seconds, and a hit or a step
 * stops it. Items in the vault are never dropped when you are defeated.
 */
export default function VaultPanel({ open, onClose }: Props) {
  // Mount the body only while open, so a closed panel holds no table subscriptions.
  return open ? <VaultPanelBody onClose={onClose} /> : null;
}

function VaultPanelBody({ onClose }: Pick<Props, 'onClose'>) {
  const me = useMyPlayer();
  const rows = useInventoryRows();
  const vault = useMyVaultSlots();
  const actions = useGameActions();
  const [amount, setAmount] = useState(0);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const bag = useMemo(() => slotsFromRows(rows), [rows]);
  if (!me) return null;
  const home = !me.region || me.region === 'bramblewild';
  const alive = me.state !== PlayerState.Dead;
  const atVault = home && atGroveVault(me);
  const box = home && !atVault ? dropBoxInReach(me) : undefined;
  const depositing = me.pending === Pending.Deposit;
  const canDeposit = alive && (atVault || !!box) && !depositing;
  const nearestBox = [...DROP_BOXES].sort((a, b) => chebyshev(me, a) - chebyshev(me, b))[0];
  const seconds = (DROP_BOX_DEPOSIT_TICKS * TICK_MS / 1000).toFixed(1);
  const status = !home ? 'Your vault opens in the Grove safe ring and at the Meadows town bank.'
    : !alive ? 'Respawn before moving items.'
    : depositing ? `Depositing… stand still: a hit or a step stops it.`
    : atVault ? 'In the Grove safe ring: deposit and withdraw at once.'
    : box ? `At the ${box.name}: deposits take ${seconds} s and a hit or a step stops them. Withdraw in the Grove safe ring.`
    : 'Bank in the Grove safe ring (around spawn) or at a Coast drop box. Items in your bag drop if you are defeated.';
  async function run(action: () => Promise<unknown>) {
    if (busy.current) return;
    busy.current = true; setPending(true);
    try { await action(); } finally { busy.current = false; setPending(false); }
  }
  const count = (held: number) => Math.min(amount || held, held, 99);
  const row = (itemId: string, held: number, direction: 'deposit' | 'withdraw') => {
    const def = getItemDef(itemId), name = def?.name ?? itemId, n = count(held);
    const allowed = direction === 'deposit' ? canDeposit : alive && atVault;
    return (
      <li className="vault-item" key={`${direction}-${itemId}`}>
        <img src={def?.icon ?? '/berry.svg'} alt="" />
        <span><strong>{name}</strong><small>{held} {direction === 'deposit' ? 'in bag' : 'stored'}</small></span>
        <button type="button" disabled={pending || !allowed} aria-label={`${direction === 'deposit' ? 'Deposit' : 'Withdraw'} ${n} ${name}`}
          onClick={() => void run(() => direction === 'deposit' ? actions.vaultDeposit(itemId, n) : actions.vaultWithdraw(itemId, n))}>
          {direction === 'deposit' ? 'Deposit' : 'Withdraw'} ×{n}
        </button>
      </li>
    );
  };
  const bagStacks = stacks(bag), vaultStacks = stacks(vault);
  return (
    <section className="game-panel vault-panel" aria-label="Vault">
      <header className="panel-heading">
        <div><h2>Vault</h2></div>
        <button className="close-button" onClick={onClose} aria-label="Close vault">×</button>
      </header>
      <div className="vault-scroll">
        <p className="vault-status" aria-live="polite">{status}</p>
        <p className="vault-unbanked">Unbanked value in your bag: <strong>{carriedValue(bag)}</strong></p>
        {home && alive && !atVault && !box && (
          <div className="vault-walk">
            <button type="button" disabled={pending} onClick={() => void run(() => actions.setTarget(GROVE_VAULT_TILE.x, GROVE_VAULT_TILE.z))}>Walk to the Grove vault</button>
            {nearestBox && <button type="button" disabled={pending} onClick={() => void run(() => actions.setTarget(nearestBox.x, nearestBox.z))}>Walk to the {nearestBox.name.toLowerCase()}</button>}
          </div>
        )}
        <label className="vault-amount">Amount
          <select aria-label="Transfer amount" value={amount} onChange={(e) => setAmount(Number(e.target.value))}>
            {AMOUNTS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>
        <section aria-label="Stored items">
          <h3>In your vault</h3>
          {vaultStacks.length ? <ul className="vault-items">{vaultStacks.map((s) => row(s.itemId, s.quantity, 'withdraw'))}</ul>
            : <p className="vault-hint">Empty. Items stored here are never dropped when you are defeated.</p>}
        </section>
        <section aria-label="Deposit from bag">
          <h3>In your bag</h3>
          {bagStacks.length ? <ul className="vault-items">{bagStacks.map((s) => row(s.itemId, s.quantity, 'deposit'))}</ul>
            : <p className="vault-hint">Your bag is empty.</p>}
        </section>
      </div>
    </section>
  );
}
