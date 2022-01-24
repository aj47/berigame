import { ReactComponentElement, ReactElement, useState } from "react";
import MetaverseCanvas from "./components/MetaverseCanvas";
import { webSocketSendMessage } from "./scripts/helpers/Api";

function App() {
  const [chatOpen, setChatOpen] = useState(false);

  const ChatInputBar = () => {
    const [inputText, setInputText] = useState("");
    return (
      <div className="chatInputBar">
        <textarea
          value={inputText}
          onChange={e => setInputText(e.target.value)}
        />
        <button
          onClick={(e) => {
            webSocketSendMessage(JSON.stringify(inputText));
            setInputText("");
          }}
        >
          Send
        </button>
      </div>
    );
  };

  return (
    <div>
      <div id="chatBox">
        <div
          style={{ maxHeight: chatOpen ? 400 : 0, padding: chatOpen ? 5 : 0 }}
          className="chatLog"
        ></div>
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
      <MetaverseCanvas />
    </div>
  );
}

export default App;
