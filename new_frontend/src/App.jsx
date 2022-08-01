import React, { useEffect, useState } from "react";
import "./App.css";
import Login from "./Components/Login";
import Logout from "./Components/Logout";
import ThreeJsCanvas from "./Panes/ThreeJSCanvas";

function App() {
  const [userData, setUserData] = useState(null);

  return (
    <>
      <ThreeJsCanvas />
      {/* <Login setUserData={setUserData} userData={userData} /> */}
    </>
  );
}

export default App;
