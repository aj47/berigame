import React from 'react';

export default function SocialTabs({ active, onMessages, onFriends, friendCount }: {
  active: 'messages' | 'friends';
  onMessages?: () => void;
  onFriends?: () => void;
  friendCount: number;
}) {
  return <nav className="social-tabs" aria-label="Chat and friends">
    <button type="button" aria-pressed={active === 'messages'} onClick={onMessages}>Messages</button>
    <button type="button" aria-pressed={active === 'friends'} onClick={onFriends} data-testid="open-friends">Friends <span>{friendCount}</span></button>
  </nav>;
}
