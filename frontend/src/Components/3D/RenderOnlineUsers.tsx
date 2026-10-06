import React, { useMemo } from 'react';
import PlayerAvatar from './PlayerAvatar';
import AvatarDecals from './AvatarDecals';
import { AvatarOverlay } from './AvatarOverlay';
import AnimationCulling from './AnimationCulling';
import TrainingDummy from './TrainingDummy';
import Giant from './Giant';
import DeathBagMarker, { CameraLookProbe } from './DeathBagMarker';
import { useChatPrefsStore } from '../../spacetime/stores/chatPrefsStore';
import { useAppearanceRows, useChatMessages, useMyIdentityHex, useMyPlayer, usePlayers, useTick, useTrainingDummies, useGiants } from '../../spacetime/hooks';
import { CHAT_BUBBLE_TICKS, DUMMY_IDLE_RESET_TICKS, GIANT_REGEN_IDLE_TICKS, GiantState, bubbleText, type Appearance } from '@sim';
import { identityHex } from '../../spacetime/identity';
import { useStackedAvatars } from './avatarStacks';
import Clatterhorn from '../../bosses/clatterhorn/Clatterhorn';
import { useBossStore } from '../../bosses/bossStore';
import { inSpire, isPlayerVisible } from '../../bosses/selectors';

/** Latest chat line per sender that is still fresh enough to float above a head. */
export function useRecentChatBySender(): Map<string, { text: string; tick: number }> {
  const messages = useChatMessages();
  const tick = useTick();
  const muted = useChatPrefsStore((s) => s.muted);
  return useMemo(() => {
    const m = new Map<string, { text: string; tick: number }>();
    // Newest last, so only the tail can be fresh: stop at the first stale line.
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (tick - msg.tick > CHAT_BUBBLE_TICKS) break;
      const hex = identityHex(msg.sender);
      if (!m.has(hex) && !muted.has(hex)) m.set(hex, { text: bubbleText(msg.text), tick: msg.tick });
    }
    return m;
  }, [messages, tick, muted]);
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

/*
 * Element constants: React skips re-rendering an identical element, so these
 * self-subscribing layers are not re-rendered by every server tick here.
 */
const MARKERS = <><DeathBagMarker /><CameraLookProbe /></>;
const CLATTERHORN = <Clatterhorn />;
/* Shared by every avatar, including your own (PlayerController). */
const SHARED_LAYERS = <><AvatarDecals /><AvatarOverlay /><AnimationCulling /></>;
// After this many ticks without a hit the dummy's HP bar is gone and its HP is full,
// so later ticks cannot change what it shows (TrainingDummy: 25-tick bar, dummyHpAt).
const DUMMY_SETTLED_TICKS = Math.max(25, DUMMY_IDLE_RESET_TICKS);

const RenderOnlineUsers = ({ frontierBlocked, frontier }: { frontierBlocked?: Set<string>; frontier?: React.ComponentProps<typeof PlayerAvatar>['frontier'] }) => {
  const players = usePlayers();
  const me = useMyIdentityHex();
  const chat = useRecentChatBySender();
  const appearances = useAppearanceByHex();
  const target = useMyTargetHex();
  const dummies = useTrainingDummies();
  const giants = useGiants();
  const tick = useTick();
  const runHexes = useBossStore((s) => s.myRunHexes);
  const meRow = useMemo(() => (me ? players.find((p) => identityHex(p.identity) === me) ?? null : null), [players, me]);
  const inside = inSpire(meRow);
  // The Spire's logical instancing: inside you see only your own run; outside, nobody on the floor.
  // Chat bubbles and stacks follow, since both are drawn only for these avatars.
  const visible = useMemo(() => players.filter(p => p.online && (!p.region || p.region === 'bramblewild' || p.region === 'settlement')
    && isPlayerVisible(p, meRow, runHexes)), [players, meRow, runHexes]);
  const shown = useStackedAvatars(visible, me, target, tick);

  return (
    <>
      {!inside && dummies.map((d) => <TrainingDummy key={d.id} dummy={d} tick={Math.min(tick, d.lastHitTick + DUMMY_SETTLED_TICKS)} />)}
      {!inside && giants.map((g) => <Giant key={g.id} giant={g} tick={g.state === GiantState.Defeated ? Math.min(tick, g.respawnTick) : Math.min(tick, g.lastHitTick + GIANT_REGEN_IDLE_TICKS)} />)}
      {!inside && CLATTERHORN}
      {MARKERS}
      {visible.map((p) => {
        const hex = identityHex(p.identity);
        const stacked = shown.get(hex);
        if (!stacked) return null;
        return (
          <PlayerAvatar frontier={frontier} frontierBlocked={frontierBlocked} key={hex} row={p} isSelf={false} saved={appearances.get(hex)} targeted={hex === target} chatText={chat.get(hex)?.text} stacked={stacked.join(',')} />
        );
      })}
      {SHARED_LAYERS}
    </>
  );
};

export default RenderOnlineUsers;
