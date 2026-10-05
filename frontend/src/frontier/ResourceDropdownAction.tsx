import React from 'react';
import { useGameActions } from '../spacetime/actions';
import { useMyIdentityHex, usePlayerByHex, useTick } from '../spacetime/hooks';
import { resourceStatus } from './resourcePresentation';
import { useResource } from './useResourceHarvest';

/** The Meadows twin of the island's harvest action: live status, one tap to start. */
export default function ResourceDropdownAction({ resourceId, onClose }: { resourceId: string; onClose: () => void }) {
  useTick(); // Count regrowth down while the menu stays open.
  const resource = useResource(resourceId);
  const myHex = useMyIdentityHex();
  const harvester = usePlayerByHex(resource?.harvest?.by ?? null);
  const { frontier } = useGameActions();
  if (!resource) return <button className="context-action" disabled>Resource unavailable</button>;

  const status = resourceStatus(resource, Date.now(), myHex, harvester?.name);
  return (
    <button
      className="context-action"
      disabled={status.unavailable}
      onClick={() => {
        if (status.unavailable) return;
        void frontier({ action: 'gather', id: resource.id });
        onClose();
      }}
    >
      {status.label}
      <span aria-hidden="true">›</span>
    </button>
  );
}
