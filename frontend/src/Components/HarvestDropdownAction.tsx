import React from 'react';
import { useGameActions } from '../spacetime/actions';
import { useMyIdentityHex, usePlayerByHex, useTick, useTrees } from '../spacetime/hooks';
import { identityHex } from '../spacetime/identity';
import { harvestStatus } from './harvestUi';
import { performOnIsland } from '../frontier/worldInteraction';

/** Keep the selected node's status live without reopening or moving its menu. */
export default function HarvestDropdownAction({ nodeId, region, onClose }: { nodeId: number; region?: string; onClose: () => void }) {
  const node = useTrees().find(tree => tree.id === nodeId);
  const tick = useTick();
  const myHex = useMyIdentityHex();
  const harvester = usePlayerByHex(node?.harvester ? identityHex(node.harvester) : null);
  const { startHarvest } = useGameActions();
  if (!node) return <button className="context-action" disabled>Resource unavailable</button>;

  const status = harvestStatus(node, tick, harvester, myHex);
  // Coast resources retain their existing wait-and-claim action while regrowing.
  const disabled = status.berry && status.unavailable;
  return (
    <button
      className="context-action"
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onClose();
        performOnIsland(region, node, () => void startHarvest(node.id));
      }}
    >
      {status.label}{!status.berry && status.unavailable ? ' — wait here' : ''}
      <span aria-hidden="true">›</span>
    </button>
  );
}
