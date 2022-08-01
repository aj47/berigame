import React, { useEffect, useState } from "react";
import "./App.css";
import Login from "./Components/Login";
import ChatBox from "./Components/ChatBox";
import Logout from "./Components/Logout";
import ThreeJSCanvas from "./Components/3D/ThreeJSCanvas";

function App() {
  const [userData, setUserData] = useState(null);

  return (
    <>
      <ThreeJSCanvas />
      <ChatBox/>
      {/* <Login setUserData={setUserData} userData={userData} /> */}
    </>
  );
}

export default App;
