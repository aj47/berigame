import React, { useMemo } from 'react';
import PlayerAvatar from './PlayerAvatar';
import AvatarDecals from './AvatarDecals';
import { AvatarOverlay } from './AvatarOverlay';
import AnimationCulling from './AnimationCulling';
import { useAppearanceRows, useChatMessages, useMyIdentityHex, useMyPlayer, usePlayers, useTick } from '../../spacetime/hooks';
import { CHAT_BUBBLE_TICKS, type Appearance } from '@sim';
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

/** Saved appearance rows by identity hex: one pass per appearance change, not one search per avatar per render. */
export function useAppearanceByHex(): Map<string, Appearance> {
  const rows = useAppearanceRows();
  return useMemo(() => {
    const m = new Map<string, Appearance>();
    for (const row of rows) m.set(identityHex(row.identity), row);
    return m;
  }, [rows]);
}

/** Your combat target's identity hex while you are hostile, else null. */
export function useMyTargetHex(): string | null {
  const me = useMyPlayer();
  return me?.hostile && me.combatTarget ? identityHex(me.combatTarget) : null;
}

const RenderOnlineUsers = () => {
  const players = usePlayers();
  const me = useMyIdentityHex();
  const chat = useRecentChatBySender();
  const appearances = useAppearanceByHex();
  const target = useMyTargetHex();

  return (
    <>
      {players.map((p) => {
        if (!p.online) return null;
        const hex = identityHex(p.identity);
        if (hex === me) return null;
        return (
          <PlayerAvatar key={hex} row={p} isSelf={false} saved={appearances.get(hex)} targeted={hex === target} chatText={chat.get(hex)?.text} />
        );
      })}
      {/* Shared by every avatar, including your own (PlayerController). */}
      <AvatarDecals />
      <AvatarOverlay />
      <AnimationCulling />
    </>
  );
};

export default RenderOnlineUsers;
