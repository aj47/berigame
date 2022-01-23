import { ReactComponentElement, ReactElement, useState } from "react";
import MetaverseCanvas from "./components/MetaverseCanvas";

function App() {
  const [chatOpen, setChatOpen] = useState(false);

  const ChatInputBar = () => {
    return (
      <div className="chatInputBar">
        <textarea />
        <button>Send</button>
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
