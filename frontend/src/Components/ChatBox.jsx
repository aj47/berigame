import React, { memo, useEffect, useRef, useState } from "react";
import { useGameActions } from "../spacetime/actions";
import { useChatMessages, usePlayersByHex } from "../spacetime/hooks";
import { useChatStore } from "../store";

const ChatBox = memo(({ open, onClose }) => {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messages = useChatMessages();
  const players = usePlayersByHex();
  const listRef = useRef(null);
  const setFocusedChat = useChatStore((state) => state.setFocusedChat);
  const { sendChat, setName } = useGameActions();
  useEffect(() => {
    if (open && listRef.current)
      listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open]);
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
          <span className="eyebrow">Around the island</span>
          <h2>Chat</h2>
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
        {messages.length ? (
          messages.map((message) => {
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
            A quiet island. Say hello to the other adventurers.
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
      <p className="fine-print">Make a name for yourself: /name YourName</p>
    </section>
  );
});
export default ChatBox;
