import { memo, useEffect, useRef, useState } from 'react';
import { useGameActions } from '../spacetime/actions';
import { useChatMessages, usePlayersByHex } from '../spacetime/hooks';
import { useChatStore } from '../store';

const ChatBox = memo(() => {
  const [chatOpen, setChatOpen] = useState(false);
  const setFocusedChat = useChatStore((state) => state.setFocusedChat);
  const { sendChat, setName } = useGameActions();

  const sendMessage = (inputText) => {
    const text = inputText.trim();
    if (text.startsWith('/name ')) setName(text.slice(6));
    else if (text.length > 0) sendChat(text);
  };

  useEffect(() => {
    const keyDownHandler = (e) => {
      if (e.key === 'Enter' && !chatOpen) {
        e.preventDefault();
        setChatOpen(true);
      }
    };
    document.addEventListener('keydown', keyDownHandler, false);
    return () => document.removeEventListener('keydown', keyDownHandler, false);
  }, [chatOpen]);

  const InputTextArea = () => {
    const [inputText, setInputText] = useState('');
    const keyDownHandler = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (inputText !== '') {
          sendMessage(inputText);
          setInputText('');
        }
      }
    };
    return (
      <textarea
        placeholder="Type a message... (/name YourName to rename)"
        autoFocus={true}
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
        onKeyDown={keyDownHandler}
        onFocus={() => setFocusedChat(true)}
        onBlur={() => setFocusedChat(false)}
      />
    );
  };

  const ChatLog = () => {
    const messages = useChatMessages();
    const players = usePlayersByHex();
    const listRef = useRef(null);
    useEffect(() => {
      if (!listRef.current) return;
      listRef.current.style.scrollBehavior = 'smooth';
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }, [messages]);
    return (
      <div id="chat-log" className="chatLog ui-element" ref={listRef}>
        {messages.map((m) => {
          const hex = m.sender.toHexString();
          const name = players.get(hex)?.name ?? `Player-${hex.slice(4, 8)}`;
          return (
            <div key={m.id.toString()}>
              <p><strong>{name}: </strong>{m.text}</p>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <button
        className={`openChatButton ui-element ${chatOpen && 'open'}`}
        onClick={(e) => { e.stopPropagation(); setChatOpen(!chatOpen); }}
      >
        {!chatOpen ? 'Chat' : 'Close Chat'}
      </button>
      {chatOpen && (
        <div id="chatBox">
          <ChatLog />
          <div className="chatInputBar">
            <InputTextArea />
          </div>
        </div>
      )}
    </>
  );
});

export default ChatBox;
