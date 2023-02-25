import React, { useEffect, useState } from "react";
import "./App.css";
import GameComponent from "./Components/3D/GameComponent";

function App() {
  console.log("cubespaced alpha v1.1");
  const [userData, setUserData] = useState(null);

  return (
    <>
    <GameComponent />
      {/* {userData && <GameComponent />}
      <Login setUserData={setUserData} userData={userData} /> */}
    </>
  );
}

export default App;
