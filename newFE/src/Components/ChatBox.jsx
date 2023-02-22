import { memo, useEffect, useRef, useState } from "react";
import { connectToChatRoom, webSocketSendMessage } from "../Api";
import { useChatStore, useWebsocketStore } from "../store";
const ChatBox = memo(({ setChatMessageSent }) => {
  const [chatOpen, setChatOpen] = useState(false);
  const websocketConnection = useWebsocketStore(
    (state) => state.websocketConnection
  );

  const sendMessage = async (inputText) => {
    await webSocketSendMessage(inputText, websocketConnection);
    setChatMessageSent(inputText);
    setTimeout(() => {
      setChatMessageSent(null);
    }, 8000);
  };

  const keyDownHandler = (e) => {
    if (e.code === "Escape" && !chatOpen) {
      setChatOpen(false);
    }
    if (e.code === "Enter" && !chatOpen) {
      e.preventDefault();
      setChatOpen(true);
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", keyDownHandler, false);
  }, []);

  useEffect(() => {
    if (websocketConnection)
      connectToChatRoom("", websocketConnection);
  }, [websocketConnection]);

  const InputTextArea = memo(() => {
    const [inputText, setInputText] = useState("");
    const keyDownHandler = (e) => {
      if (e.code === "Enter") {
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
        style={{ maxHeight: chatOpen ? "70vh" : 0, padding: chatOpen ? 5 : 0 }}
        className="chatLog"
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
      <ChatLog />
      {chatOpen && (
        <div className="chatInputBar">
          <InputTextArea />
        </div>
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
  