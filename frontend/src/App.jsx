import React, { useEffect, useState } from "react";
import "./App.css";
import GameComponent from "./Components/3D/GameComponent";
import Login from "./Components/Login";
import Landing from "./Components/Landing";

function App() {
  console.log("BeriGame alpha v1");
  const [userData, setUserData] = useState(null);
  const [showModal, setShowModal] = useState(true);

  const closeModal = () => {
    setShowModal(false);
  };

  return (
    <>

    {showModal ? (
        <div className="modal">
          <div className="modal-content">
            <button className="close" onClick={closeModal}>
              &times;
            </button>
            <Landing />
          </div>
        </div>
      ) : null}

    <GameComponent />
      {/* {userData && <GameComponent />} */}
      {/* <Login setUserData={setUserData} userData={userData} /> */}
    </>
  );
}

export default App;
