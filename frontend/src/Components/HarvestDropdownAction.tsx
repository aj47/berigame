import React from 'react';
import { tierNode } from '@sim';
import { useGameActions } from '../spacetime/actions';
import { useMyIdentityHex, useMySkills, usePlayerByHex, useTick, useTrees } from '../spacetime/hooks';
import { identityHex } from '../spacetime/identity';
import { harvestStatus, mySkillLevel } from './harvestUi';
import { performOnIsland } from '../frontier/worldInteraction';

/** Your level in a tier node's skill; only tier nodes subscribe to your skill row. */
function WithSkillLevel({ kind, children }: { kind: number; children: (level: number) => React.ReactElement }) {
  return children(mySkillLevel(useMySkills(), kind));
}

/** Keep the selected node's status live without reopening or moving its menu. */
export default function HarvestDropdownAction({ nodeId, region, onClose }: { nodeId: number; region?: string; onClose: () => void }) {
  const node = useTrees().find(tree => tree.id === nodeId);
  const tick = useTick();
  const myHex = useMyIdentityHex();
  const harvester = usePlayerByHex(node?.harvester ? identityHex(node.harvester) : null);
  const { startHarvest } = useGameActions();
  if (!node) return <button className="context-action" disabled>Resource unavailable</button>;

  const action = (level?: number) => {
    const status = harvestStatus(node, tick, harvester, myHex, level);
    // Coast resources retain their existing wait-and-claim action while regrowing; a level gate blocks both.
    const disabled = !!status.locked || (status.berry && status.unavailable);
    return (
      <button
        className="context-action"
        disabled={disabled}
        title={status.locked ?? undefined}
        onClick={() => {
          if (disabled) return;
          onClose();
          performOnIsland(region, node, () => void startHarvest(node.id));
        }}
      >
        {status.label}{status.locked ? ` — ${status.locked}` : !status.berry && status.unavailable ? ' — wait here' : ''}
        <span aria-hidden="true">›</span>
      </button>
    );
  };
  return tierNode(node.kind) ? <WithSkillLevel kind={node.kind}>{action}</WithSkillLevel> : action();
}
