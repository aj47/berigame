import React, { useMemo } from 'react';
import PlayerAvatar from './PlayerAvatar';
import { useChatMessages, useMyIdentityHex, usePlayers, useTick } from '../../spacetime/hooks';
import { CHAT_BUBBLE_TICKS } from '@sim';
import { identityHex } from '../../spacetime/identity';

/** Latest chat line per sender that is still fresh enough to float above a head. */
export function useRecentChatBySender(): Map<string, { text: string; tick: number }> {
  const messages = useChatMessages();
  const tick = useTick();
  return useMemo(() => {
    const m = new Map<string, { text: string; tick: number }>();
    for (const msg of messages) {
      if (tick - msg.tick <= CHAT_BUBBLE_TICKS) m.set(identityHex(msg.sender), { text: msg.text, tick: msg.tick });
    }
    return m;
  }, [messages, tick]);
}

const RenderOnlineUsers = () => {
  const players = usePlayers();
  const me = useMyIdentityHex();
  const tick = useTick();
  const chat = useRecentChatBySender();

  return (
    <>
      {players.map((p) => {
        if (!p.online) return null;
        const hex = identityHex(p.identity);
        if (hex === me) return null;
        const bubble = chat.get(hex);
        return (
          <PlayerAvatar key={hex} row={p} isSelf={false} currentTick={tick} chatText={bubble?.text} chatTick={bubble?.tick} />
        );
      })}
    </>
  );
};

export default RenderOnlineUsers;
