import { useState } from "react";
import MetaverseCanvas from "./components/MetaverseCanvas";

function App() {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div>
      <div id="chatBox">
        {chatOpen && <div className="chatLog"></div>}
        <button
          className="openChatButton"
          onClick={(e) => {
            console.log("yo");
            e.stopPropagation();
            setChatOpen(!chatOpen);
          }}
        >
          Chat
        </button>
      </div>
      <MetaverseCanvas />
    </div>
  );
}

export default App;
