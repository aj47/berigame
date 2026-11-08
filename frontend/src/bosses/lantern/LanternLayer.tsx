import { memo, useEffect } from 'react';
import { SpireMemberState, SpireStage } from '@sim';
import { useBossStore } from '../bossStore';
import LanternHud from './LanternHud';
import LanternLobbyPanel from './LanternLobbyPanel';
import LanternResult from './LanternResult';

/**
 * Lanternmaw's DOM layer, the Spire's layout: the HUD on the floor (and the party chip while your run fights on),
 * the Fen Gate's lobby panel outside, and the result card anywhere, by membership.
 */
const LanternLayer = memo(({ inside }: { inside: boolean }) => {
  const lobbyOpen = useBossStore((s) => s.lanternLobbyOpen);
  const inLobby = useBossStore((s) => s.myLanternMember?.state === SpireMemberState.Lobby && s.myLanternRun?.stage === SpireStage.Lobby);
  const runActive = useBossStore((s) => s.myLanternRun?.stage === SpireStage.Active && s.myLanternMember?.state !== SpireMemberState.Left);
  useEffect(() => { if (runActive) useBossStore.getState().setLanternLobbyOpen(false); }, [runActive]);
  return <>
    {(inside || runActive) && <LanternHud />}
    {!inside && (lobbyOpen || inLobby) && <LanternLobbyPanel />}
    <LanternResult />
  </>;
});

export default LanternLayer;
