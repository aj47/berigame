import { memo, useEffect, useRef, useState } from "react";
import { connectToChatRoom, webSocketSendMessage } from "../Api";
import { useChatStore, useWebsocketStore } from "../store";
const ChatBox = memo(({}) => {
  const [chatOpen, setChatOpen] = useState(false);
  const websocketConnection = useWebsocketStore(
    (state) => state.websocketConnection
  );
  const setJustSentMessage = useChatStore((state) => state.setJustSentMessage);
  const setFocusedChat = useChatStore((state) => state.setFocusedChat);

  const sendMessage = async (inputText) => {
    await webSocketSendMessage(inputText, websocketConnection);
    setJustSentMessage(inputText);
    setTimeout(() => {
      setJustSentMessage(null);
    }, 8000);
  };

  const keyDownHandler = (e) => {
    if (e.keyCode === 13 && !chatOpen) {
      setChatOpen(false);
    }
    if (e.keyCode === 13 && !chatOpen) {
      e.preventDefault();
      setChatOpen(true);
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", keyDownHandler, false);
  }, []);

  useEffect(() => {
    if (websocketConnection) connectToChatRoom("", websocketConnection);
  }, [websocketConnection]);

  const InputTextArea = memo(() => {
    const [inputText, setInputText] = useState("");
    const keyDownHandler = (e) => {
      if (e.code === "Enter" || e.keyCode === 13) {
        e.preventDefault();
        if (!chatOpen) setChatOpen(true);
        if (inputText !== "") {
          sendMessage(inputText);
          setInputText("");
        }
      }
    };
    return (
      <>
        <textarea
          placeholder="Type your message here..."
          autoFocus={true}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={keyDownHandler}
          onFocus={() => {setFocusedChat(true)}}
          onBlur={() => {setFocusedChat(false)}}
        />

        {/* <button
          onClick={(e) => {
            sendMessage(inputText);
            setInputText("");
          }}
        >
          Send
        </button> */}
      </>
    );
  });

  const ChatLog = memo(() => {
    const chatMessages = useChatStore((state) => state.chatMessages);
    const listRef = useRef(null);

    useEffect(() => {
      listRef.current.style.scrollBehavior = "smooth";
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }, [chatMessages]);
    return (
      <div
        id="chat-log"
        className="chatLog ui-window"
        ref={listRef}
      >
        {chatMessages.map((data, i) => {
          return (
            <div key={i}>
              <p>
                <strong>User-{data.senderId.substring(13)} said: </strong>
                {data.message}
              </p>
            </div>
          );
        })}
      </div>
    );
  });

  return (
    <div id="chatBox">
      {chatOpen && (
        <>
          <ChatLog />
          <div className="chatInputBar">
            <InputTextArea />
          </div>
        </>
      )}
      <button
        className={`openChatButton ${chatOpen && "open"}`}
        onClick={(e) => {
          e.stopPropagation();
          setChatOpen(!chatOpen);
        }}
      >
        {!chatOpen ? "Chat" : "X"}
      </button>
    </div>
  );
});

export default ChatBox;
