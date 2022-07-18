import React, { useEffect, useState } from "react";
import "./App.css";
import Login from "./Components/Login";
import ThreeJsCanvas from "./Panes/ThreeJSCanvas";
import { Magic } from "magic-sdk";

function App() {
  const magic = new Magic(import.meta.env.VITE_MAGIC_API_KEY);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  const tryAuth = async () => {
    try {
      await magic.auth.loginWithCredential();
      window.location.href = window.location.origin + "/play";
    } catch (e) {
      console.error(e);
      window.location.href = window.location.origin;
    }
  };

  const checkAuth = async () => {
    const isLoggedIn = await magic.user.isLoggedIn();
    if (isLoggedIn) {
      if (window.location.pathname !== "/play")
        window.location.href = window.location.origin + "/play";
      const userMetadata = await magic.user.getMetadata();
      setUserData(userMetadata);
      setLoading(false);
    } else if (window.location.pathname !== "/") {
      window.location.href = window.location.origin;
    }
    setLoading(false);
  };

  useEffect(() => {
    if (window.location.pathname === "/login-callback") tryAuth();
    else if (userData === null) checkAuth();
  }, [userData]);

  return (
    <>
      {/* <p className="username-text">user: {userData.email}</p> */}
      {loading ? "Loading..." : userData ? <ThreeJsCanvas /> : <Login />}
    </>
  );
}

export default App;
