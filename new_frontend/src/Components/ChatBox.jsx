import {
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
const ChatBox = ({ setChatMessageSent }) => {
  const [chatOpen, setChatOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  webSocketConnect();


  const sendMessage = () => {
    const messageText = inputText;
    setInputText("");
    webSocketSendMessage(inputText);
    setChatMessageSent(inputText);
    setTimeout(() => {
      setChatMessageSent(null);
    }, 6000);
  };

  const keyDownHandler = (e) => {
    if (e.code === "Enter") {
      e.preventDefault();
      if (!chatOpen) setChatOpen(true);
      if (inputText !== "") sendMessage();
      if (chatOpen) setChatOpen(false);
    }
  };

  const ChatLog = () => {
    const [chatLogArray, setChatLogArray] = useState([]);
    const appendChatLogArray = (data) => {
      console.log(data, "dat");
      setChatLogArray([...chatLogArray, data]);
      console.log(chatLogArray, "chatLogArray");
    };
    setAppendChatLog(appendChatLogArray);
    return (
      <div
        style={{ maxHeight: chatOpen ? "70vh" : 0, padding: chatOpen ? 5 : 0 }}
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
          <textarea
            placeholder="Type your message here..."
            autoFocus={true}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={keyDownHandler}
          />
          <button
            onClick={(e) => {
              sendMessage();
            }}
          >
            Send
          </button>
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
};

export default ChatBox;
