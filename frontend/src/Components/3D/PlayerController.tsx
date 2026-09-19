import React from 'react';
import PlayerAvatar from './PlayerAvatar';
import { useRecentChatBySender } from './RenderOnlineUsers';
import { useMyPlayer, useTick } from '../../spacetime/hooks';

/** Your own avatar. It is driven by the same server rows as everyone else's. */
const PlayerController = (props: { setPlayerRef: (ref: React.MutableRefObject<any>) => void }) => {
  const me = useMyPlayer();
  const tick = useTick();
  const chat = useRecentChatBySender();
  if (!me) return null;
  const bubble = chat.get(me.identity.toHexString());
  return (
    <PlayerAvatar
      row={me}
      isSelf
      currentTick={tick}
      chatText={bubble?.text}
      chatTick={bubble?.tick}
      setPlayerRef={props.setPlayerRef}
    />
  );
};

export default PlayerController;
