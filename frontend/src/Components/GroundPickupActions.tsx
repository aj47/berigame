import React, { useRef, useState } from 'react';
import { getItemDef, type Tile } from '@sim';
import { useGroundItems, useTick } from '../spacetime/hooks';
import { useGameActions } from '../spacetime/actions';
import { performOnIsland } from '../frontier/worldInteraction';

/** The place stays fixed while pile quantities and availability follow live rows. */
export default function GroundPickupActions({ tiles, selectedId, region, onClose }: {
  tiles: readonly Tile[];
  selectedId?: bigint;
  region?: string;
  onClose: () => void;
}) {
  const groundItems = useGroundItems();
  const tick = useTick();
  const { pickupItem } = useGameActions();
  const [pending, setPending] = useState<bigint | null>(null);
  const [failed, setFailed] = useState<bigint | null>(null);
  const inFlight = useRef(false);
  const items = groundItems.filter(item => item.quantity > 0 && item.expiresTick > tick && tiles.some(tile => tile.x === item.x && tile.z === item.z))
    .sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId));

  const pickUp = async (id: bigint) => {
    const item = items.find(item => item.id === id);
    if (inFlight.current || !item) return;
    if (region && region !== 'bramblewild') {
      // Crossing from Meadows closes the menu; the pickup runs on arrival.
      performOnIsland(region, item, () => void pickupItem(id));
      return;
    }
    inFlight.current = true;
    setPending(id);
    setFailed(null);
    try {
      if (await pickupItem(id)) onClose();
      else setFailed(id);
    } catch {
      setFailed(id);
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  };

  if (!items.length) return selectedId !== undefined ? <p className="player-picker-hint">Items no longer here.</p> : null;
  return <div className="context-ground">
    <div className="context-ground-heading">On the ground</div>
    {items.map(item => {
      const def = getItemDef(item.itemId);
      const label = `${item.quantity}× ${def?.name ?? item.itemId}`;
      return <React.Fragment key={item.id.toString()}>
        <button className="context-action context-pickup" disabled={pending !== null}
          onClick={() => void pickUp(item.id)}>
          {def && <img src={def.icon} alt="" />}
          <span className="context-pickup-label">{pending === item.id ? 'Picking up' : failed === item.id ? 'Retry pickup' : 'Pick up'} {label}</span>
          <span aria-hidden="true">›</span>
        </button>
        {failed === item.id && <p className="context-pickup-error" role="alert">Couldn’t pick that up. Try again.</p>}
      </React.Fragment>;
    })}
  </div>;
}
