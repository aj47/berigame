import { ReactComponentElement, ReactElement, useState } from "react";
import { setAppendChatLog, webSocketConnect, webSocketConnection, webSocketSendMessage } from "../scripts/helpers/Api";
const ChatBox = () => {
  const [chatOpen, setChatOpen] = useState(false);
  webSocketConnect();

  const ChatLog = () => {
    const [chatLogArray, setChatLogArray] = useState([])
    const appendChatLogArray = (data) => {
      console.log(data, "dat");
      setChatLogArray([...chatLogArray, data]);
      console.log(chatLogArray, "chatLogArray");
    }
    setAppendChatLog(appendChatLogArray);
    return (
      <div
        style={{ maxHeight: chatOpen ? 400 : 0, padding: chatOpen ? 5 : 0 }}
        className="chatLog"
      >
        {chatLogArray.map((data, i) => {
          return (
            <div key={i} >
              <p><strong>Player said: </strong>{data.message}</p>
            </div>
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
      <ChatLog />
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
