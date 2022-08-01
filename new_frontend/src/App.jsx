import React, { useEffect, useState } from "react";
import "./App.css";
import Login from "./Components/Login";
import ChatBox from "./Components/ChatBox";
import Logout from "./Components/Logout";
import ThreeJsCanvas from "./Panes/ThreeJSCanvas";

function App() {
  const [userData, setUserData] = useState(null);

  return (
    <>
      <ThreeJsCanvas />
      <ChatBox/>
      {/* <Login setUserData={setUserData} userData={userData} /> */}
    </>
  );
}

export default App;
