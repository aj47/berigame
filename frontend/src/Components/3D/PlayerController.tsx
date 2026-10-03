import React from 'react';
import PlayerAvatar from './PlayerAvatar';
import { useAppearanceByHex, useRecentChatBySender } from './RenderOnlineUsers';
import { useMyPlayer } from '../../spacetime/hooks';
import { identityHex } from '../../spacetime/identity';

/** Your own avatar. It is driven by the same server rows as everyone else's. */
const PlayerController = (props: { frontierBlocked?: Set<string>; frontier?: React.ComponentProps<typeof PlayerAvatar>['frontier']; setPlayerRef: (ref: React.MutableRefObject<any>) => void }) => {
  const me = useMyPlayer();
  const chat = useRecentChatBySender();
  const appearances = useAppearanceByHex();
  if (!me) return null;
  const hex = identityHex(me.identity);
  return (
    <PlayerAvatar
      // A new identity is a new character: remount so animation and motion state start fresh.
      key={hex}
      row={me}
      frontier={props.frontier}
      frontierBlocked={props.frontierBlocked}
      isSelf
      saved={appearances.get(hex)}
      chatText={chat.get(hex)?.text}
      setPlayerRef={props.setPlayerRef}
    />
  );
};

export default PlayerController;
