import { ReactComponentElement, ReactElement, useState } from "react";
import { webSocketConnect, webSocketConnection, webSocketSendMessage } from "../scripts/helpers/Api";
const ChatBox = () => {
  const [chatOpen, setChatOpen] = useState(true);
  webSocketConnect();

  const ChatLog = () => {
    const [chatLogArray, setChatLogArray] = useState([])
    const websocketConnection = webSocketConnection;
    websocketConnection.onmessage = e => {
      setChatLogArray([...chatLogArray, e.data]);
    }
    return (
      <div
        style={{ maxHeight: chatOpen ? 400 : 0, padding: chatOpen ? 5 : 0 }}
        className="chatLog"
      >
        {chatLogArray.map((data, i) => {
          const log = JSON.parse(data)
          if (!log.chatMessage) return;
          return (
            <ul key={i} >
              <li>{log.message}</li>
            </ul>
          );
        })}
      </div>
    );
  };

  const ChatInputBar = () => {
    const [inputText, setInputText] = useState("");
    return (
      <div className="chatInputBar">
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
        />
        <button
          onClick={(e) => {
            webSocketSendMessage(inputText);
            setInputText("");
          }}
        >
          Send
        </button>
      </div>
    );
  };

  return (
    <div id="chatBox">
      {chatOpen && <ChatLog />}
      {chatOpen && <ChatInputBar />}
      <button
        className="openChatButton"
        onClick={(e) => {
          e.stopPropagation();
          setChatOpen(!chatOpen);
        }}
      >
        {!chatOpen ? "Chat" : "^"}
      </button>
    </div>
  );
};

export default ChatBox;
