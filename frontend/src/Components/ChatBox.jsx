import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { useGameActions } from "../spacetime/actions";
import { useChatMessages, useMyPlayer, usePlayersByHex } from "../spacetime/hooks";
import { useChatStore } from "../store";
import { useChatPrefsStore } from "../spacetime/stores/chatPrefsStore";
import { useGiantStore } from "../spacetime/stores/giantStore";
import { CHAT_NEARBY_RADIUS, chatVisible } from "@sim";

/** Your tile, only when it changes (not on every other row update). */
const useMyTile = () => {
  const me = useMyPlayer();
  const x = me?.x, z = me?.z;
  return useMemo(() => (x === undefined ? null : { x, z }), [x, z]);
};

const ChatBox = memo(({ open, onClose, onOpenFriends }) => {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const allMessages = useChatMessages();
  const players = usePlayersByHex();
  const mode = useChatPrefsStore((s) => s.mode);
  const setMode = useChatPrefsStore((s) => s.setMode);
  const muted = useChatPrefsStore((s) => s.muted);
  const tile = useMyTile();
  // Nearby: said within CHAT_NEARBY_RADIUS tiles of where you stand; muted players never show.
  const messages = useMemo(
    () => allMessages.filter((m) => !muted.has(m.sender.toHexString()) && chatVisible(mode, tile, m)),
    [allMessages, muted, mode, tile],
  );
  // World-wide raid lines (the Giant's announcements), interleaved by time.
  const systemLines = useGiantStore((s) => s.systemLines);
  const shown = useMemo(() => {
    if (!systemLines.length) return messages;
    const ms = (m) => Number(m.sentAt?.microsSinceUnixEpoch ?? 0n) / 1000;
    const lines = systemLines.map((l) => ({ system: true, id: `sys-${l.id}`, text: l.text, at: l.at }));
    return [...messages.map((m) => ({ m, at: ms(m) })), ...lines.map((l) => ({ m: l, at: l.at }))]
      .sort((a, b) => a.at - b.at)
      .map((x) => x.m);
  }, [messages, systemLines]);
  const listRef = useRef(null);
  const setFocusedChat = useChatStore((state) => state.setFocusedChat);
  const { sendChat, setName } = useGameActions();
  useEffect(() => {
    if (open && listRef.current)
      listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [shown, open]);
  useEffect(() => {
    if (!open) setFocusedChat(false);
    return () => setFocusedChat(false);
  }, [open, setFocusedChat]);
  if (!open) return null;
  const submit = async (event) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const accepted = text.startsWith("/name ") ? await setName(text.slice(6)) : await sendChat(text);
      if (accepted) setInput("");
    } finally {
      setSending(false);
    }
  };
  return (
    <section className="game-panel chat-panel" aria-label="Chat">
      <header className="panel-heading">
        <div>
          <h2>Chat</h2>
        </div>
        {onOpenFriends && (
          <button className="panel-switch" onClick={onOpenFriends} data-testid="open-friends">
            Friends
          </button>
        )}
        <div className="chat-mode" role="radiogroup" aria-label="Show messages from">
          {[["all", "All"], ["nearby", "Nearby"]].map(([value, label]) => (
            <button
              key={value}
              role="radio"
              aria-checked={mode === value}
              className={mode === value ? "active" : ""}
              title={value === "nearby" ? `Said within ${CHAT_NEARBY_RADIUS} tiles of you` : "Everyone on the island"}
              onClick={() => setMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="close-button"
          onClick={onClose}
          aria-label="Close chat"
        >
          ×
        </button>
      </header>
      <div
        id="chat-log"
        className="chat-log"
        ref={listRef}
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
        tabIndex={0}
      >
        {shown.length ? (
          shown.map((message) => {
            if (message.system) return (
              <p key={message.id} className="chat-system" data-testid="chat-system-line">
                <span>{message.text}</span>
              </p>
            );
            const hex = message.sender.toHexString();
            return (
              <p key={message.id.toString()}>
                <strong>
                  {players.get(hex)?.name ?? `Player-${hex.slice(4, 8)}`}
                </strong>
                <span>{message.text}</span>
              </p>
            );
          })
        ) : (
          <p className="empty-state">
            {mode === "nearby"
              ? `Nothing said within ${CHAT_NEARBY_RADIUS} tiles yet. Switch to All to see the whole island.`
              : "A quiet island. Say hello to the other adventurers."}
          </p>
        )}
      </div>
      <form className="chat-input-bar" onSubmit={submit}>
        <label className="sr-only" htmlFor="chat-message">
          Message
        </label>
        <input
          id="chat-message"
          autoFocus
          value={input}
          maxLength={200}
          placeholder="Say something…"
          onChange={(event) => setInput(event.target.value)}
          onFocus={() => setFocusedChat(true)}
          onBlur={() => setFocusedChat(false)}
          autoComplete="off"
        />
        <button
          className="primary-button"
          disabled={!input.trim() || sending}
          type="submit"
        >
          Send
        </button>
      </form>
      {muted.size > 0 && <p className="fine-print">{muted.size} muted · unmute in Friends</p>}
    </section>
  );
});
export default ChatBox;
