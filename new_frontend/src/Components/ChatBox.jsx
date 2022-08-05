import {
  memo,
  ReactComponentElement,
  ReactElement,
  useEffect,
  useState,
} from "react";
import {
  setAppendChatLog,
  webSocketConnect,
  webSocketConnection,
  webSocketSendMessage,
} from "../Api";
const ChatBox = memo(({ setChatMessageSent }) => {
  const [chatOpen, setChatOpen] = useState(false);
  webSocketConnect();

  const sendMessage = (inputText) => {
    webSocketSendMessage(inputText);
    setChatMessageSent(inputText);
    setTimeout(() => {
      setChatMessageSent(null);
    }, 8000);
  };
  
  const keyDownHandler = (e) => {
    if (e.code === "Enter" && !chatOpen) {
      e.preventDefault();
      setChatOpen(true);
    }
  }
  document.addEventListener("keydown", keyDownHandler, false);

  const InputTextArea = () => {
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

        <button
          onClick={(e) => {
            sendMessage(inputText);
            setInputText("");
          }}
        >
          Send
        </button>
      </>
    );
  };

  const ChatLog = () => {
    const [chatLogArray, setChatLogArray] = useState([]);
    const appendChatLogArray = (data) => {
      setChatLogArray([...chatLogArray, data]);
    };
    setAppendChatLog(appendChatLogArray);
    return (
      <div
        style={{ maxHeight: chatOpen ? 400 : 0, padding: chatOpen ? 5 : 0 }}
        className="chatLog"
      >
        {chatLogArray.map((data, i) => {
          return (
            <div key={i}>
              <p>
                <strong>Player said: </strong>
                {data.message}
              </p>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div id="chatBox">
      <ChatLog />
      {chatOpen && (
        <div className="chatInputBar">
          <InputTextArea />
        </div>
      )}
      <button
        className="openChatButton"
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
