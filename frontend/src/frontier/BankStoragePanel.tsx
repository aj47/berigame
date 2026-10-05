import React, { useEffect, useRef, useState } from 'react';
import { getItemDef, levelForXp, PlayerState } from '@sim';
import { FRONTIER, PIECES, REGIONS, SPECIES, type Location } from '../../../shared/sim/frontier/catalog';
import { isHomeRegion } from '../../../shared/sim/frontier/homeMap';
import type { FrontierSnapshot } from '../../../shared/sim/frontier/snapshot';
import { useGameActions } from '../spacetime/actions';
import { useInventoryRows, useMyPlayer, usePlayers } from '../spacetime/hooks';
import { approachWorldInteraction } from './worldInteraction';
import './bankStorage.css';

/** The personal bank is the existing private vault; other containers retain their own access rules. */
export default function BankStoragePanel({ state, onBag, onTravel, request }: {
  state: FrontierSnapshot; onBag: () => void; onTravel: () => void;
  /** A chest clicked in the world; `id` changes on every request so a repeat click reselects it. */
  request?: { storage?: string; id: number };
}) {
  const me = useMyPlayer(), inventory = useInventoryRows(), players = usePlayers(), actions = useGameActions();
  const [storage, setStorage] = useState(request?.storage ?? ''), [quantity, setQuantity] = useState(0);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const busy = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (request?.storage) setStorage(request.storage); }, [request?.storage, request?.id]);
  if (!me) return null;
  const id = me.identity.toHexString(), region = me.region || 'bramblewild', vaultId = `vault-${id}`;
  const storageId = storage || vaultId, personal = storageId === vaultId;
  const container = state.containers.find(c => c.id === storageId);
  const building = state.buildings.find(b => b.id === storageId);
  const boat = state.boats.find(b => b.id === container?.boat);
  const pet = state.creatures.find(c => `pet-${c.id}` === storageId);
  const destination = personal ? { region: 'settlement', ...REGIONS.settlement.spawn } as Location : building ?? boat ?? pet;
  const nearby = !!destination && destination.region === region
    && Math.max(Math.abs(me.x - destination.x), Math.abs(me.z - destination.z)) <= (personal ? 4 : 2);
  const accessible = nearby || !!boat?.crew.includes(id);
  const alive = me.state !== PlayerState.Dead;
  const aboard = state.boats.some(b => b.crew.includes(id));
  const canWalk = destination && !aboard && (destination.region === region || (isHomeRegion(region) && isHomeRegion(destination.region)));
  const needsBeastcraft = !!pet && (!state.profile.active.includes(3) || levelForXp(state.profile.xp[3]) < 2);
  const unavailable = !alive ? 'Respawn before moving items.' : needsBeastcraft ? 'Activate Beastcraft level 2 to use pack storage.'
    : pet && !pet.active ? 'Call your pack companion to use its storage.' : !accessible
      ? personal ? 'Visit the bank beside the steward in Meadows town to deposit or withdraw.' : 'Move beside this storage to deposit or withdraw.' : '';
  const slots = container?.slots ?? [], occupied = slots.filter(Boolean).length;
  const capacity = personal ? Math.max(FRONTIER.bankSlots, slots.length) : slots.length;
  const bag = inventory.filter(row => row.owner.toHexString() === id);
  const nearbyPlayers = players.filter(p => p.online && (p.region || 'bramblewild') === region && p.identity.toHexString() !== id);
  const amount = (held: number) => Math.min(quantity || held, held, 99);
  const label = (c: FrontierSnapshot['containers'][number]) => {
    const b = state.buildings.find(b => b.id === c.id);
    const p = state.creatures.find(p => `pet-${p.id}` === c.id);
    return b ? `${b.label || PIECES[b.piece]?.name || 'Chest'} · ${REGIONS[b.region].name} ${b.x}, ${b.z}`
      : c.boat ? `Boat cargo · ${c.boat}` : p ? `${SPECIES.find(species => species.id === p.species)?.name ?? 'Companion'} pack` : c.id;
  };
  async function run(action: () => Promise<unknown>, success?: () => void) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(''); setNotice('');
    try {
      const result = await action();
      if (!mounted.current) return;
      if (result === false) setError('Could not complete that action. Check your location and available space, then try again.');
      else success?.();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not complete that action. Try again.');
    } finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  const walk = (point: Location) => run(() => isHomeRegion(region) && isHomeRegion(point.region)
    ? actions.frontier({ action: 'walk', id: point.region, x: point.x, z: point.z })
    : region === 'bramblewild' ? actions.setTarget(point.x, point.z)
      : actions.frontier({ action: 'move', x: point.x, z: point.z }), onTravel);
  const transfer = (target: 'deposit' | 'withdraw', item: string, held: number) => {
    const count = amount(held), name = getItemDef(item)?.name ?? item;
    return run(() => actions.frontier({ action: 'container', id: storageId, target, item, quantity: count }),
      () => setNotice(`${target === 'deposit' ? 'Deposited' : 'Withdrew'} ${count} ${name}.`));
  };
  const itemRow = (item: string, held: number, key: number, target: 'deposit' | 'withdraw') => {
    const def = getItemDef(item), name = def?.name ?? item, count = amount(held);
    return <li className="bank-item" key={key}>
      <img src={def?.icon ?? '/berry.svg'} alt="" />
      <span><strong>{name}</strong><small>{held} {target === 'deposit' ? 'in bag' : 'stored'}</small></span>
      <button disabled={pending || !!unavailable} aria-label={`${target === 'deposit' ? 'Deposit' : 'Withdraw'} ${count} ${name}`}
        onClick={() => void transfer(target, item, held)}>{target === 'deposit' ? 'Deposit' : 'Withdraw'} <span>×{count}</span></button>
    </li>;
  };
  return <div className="bank-storage">
    <div className="bank-intro"><strong>{personal ? 'Your personal bank' : 'Storage'}</strong><button onClick={onBag}>Open bag</button></div>
    <p className="bank-protection">{personal ? 'Only you can access your bank. Stored items stay safe when you are defeated or your plot is captured.' : 'Chest, boat and companion storage use their own access rules. Use your personal bank for protected loot.'}</p>
    <label>Storage location<select aria-label="Storage location" value={storageId} disabled={pending} onChange={e => { setStorage(e.target.value); setError(''); setNotice(''); }}>
      <option value={vaultId}>Personal bank · Meadows town</option>
      {state.containers.filter(c => c.id !== vaultId).map(c => <option value={c.id} key={c.id}>{label(c)}</option>)}
    </select></label>
    <div className="bank-location" aria-live="polite">
      <p>{unavailable || (personal ? 'At the bank · ready to deposit and withdraw.' : 'Storage in reach · ready to transfer.')}</p>
      {!accessible && alive && (canWalk ? <button disabled={pending} onClick={() => {
        if (personal) void walk(destination!);
        else {
          // Chests occupy solid tiles. Use the world approach controller to find
          // a reachable spot beside them, as world-object clicks already do.
          approachWorldInteraction(destination!, () => { if (mounted.current) setNotice('Storage is now in reach.'); });
        }
      }}>{personal ? 'Walk to bank' : 'Walk to storage'}</button>
        : <p className="frontier-hint">{personal ? `${aboard ? 'Dock and disembark at' : 'Sail to'} Driftwood Harbour, then take the Meadows trail to town.` : 'Travel to this storage’s region first.'}</p>)}
    </div>
    <label className="bank-amount">Transfer amount<select aria-label="Transfer amount" value={quantity} disabled={pending} onChange={e => setQuantity(Number(e.target.value))}>
      <option value={0}>Whole stack</option><option value={1}>1 item</option><option value={5}>Up to 5</option><option value={10}>Up to 10</option>
    </select></label>
    {error && <p className="frontier-error" role="alert">{error}</p>}
    {notice && <p className="bank-notice" role="status">{notice}</p>}
    <section aria-label="Stored items"><h3>{personal ? 'Bank' : 'Stored'} <small>{occupied}/{capacity} slots</small></h3>
      {occupied ? <ul className="bank-items">{slots.map((slot, index) => slot && itemRow(slot.itemId, slot.quantity, index, 'withdraw'))}</ul>
        : <p className="frontier-hint">{personal ? 'Your bank is empty. Deposit supplies below to keep them safe.' : 'This storage is empty.'}</p>}
    </section>
    <section aria-label="Deposit from bag"><h3>Deposit from your bag</h3>
      {bag.length ? <ul className="bank-items">{bag.map(row => itemRow(row.itemId, row.quantity, row.slot, 'deposit'))}</ul> : <p className="frontier-hint">Your bag is empty.</p>}
    </section>
    <details><summary>Trade nearby</summary>
      {nearbyPlayers.map(p => <button key={p.identity.toHexString()} disabled={pending || !alive}
        onClick={() => void run(() => actions.requestTrade(p.identity))}>Trade with {p.name}</button>)}
      {!nearbyPlayers.length && <p className="frontier-hint">No other players in this region.</p>}
    </details>
    {!!state.drops.some(d => d.region === region) && <details><summary>Dropped bags</summary>
      {state.drops.filter(d => d.region === region).map(d => <article key={d.id}>
        <span>Bag at {d.x}, {d.z}</span><button disabled={pending || !alive || aboard} onClick={() => void walk(d)}>Walk here</button>
        <button disabled={pending || !alive} onClick={() => void run(() => actions.frontier({ action: 'pickup_bag', id: d.id }))}>Pick up</button>
      </article>)}
    </details>}
  </div>;
}
