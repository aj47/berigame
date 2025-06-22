import React, { useEffect, useState } from "react";
import "./App.css";
import GameComponent from "./Components/3D/GameComponent";
import Login from "./Components/Login";

function App() {
  console.log("BeriGame alpha v1");
  const [userData, setUserData] = useState(null);
  return (
    <>
      {userData && <GameComponent />}
      <Login setUserData={setUserData} userData={userData} />
    </>
  );
}

export default App;
