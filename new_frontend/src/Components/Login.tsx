import React, { useEffect, useState } from "react";
import { Magic } from "magic-sdk";

const Login = (props) => {
  const magic = new Magic(import.meta.env.VITE_MAGIC_API_KEY, {
    network: "ropsten",
  });
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");

  const submitAuth = async () => {
    const redirectURI = `${window.location.origin}/login-callback`;
    await magic.auth.loginWithMagicLink({ email, redirectURI });
  };

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
    console.log(userData, "userData");
    if (window.location.pathname === "/login-callback") tryAuth();
    else if (userData === null) checkAuth();
  }, [userData]);

  if (loading) return "loading...";

  return (
    <div className="login">
      <img src="/saturn-og.png" alt="saturn" className="logo" />
      <input
        placeholder="email@domain.com"
        type="email"
        onChange={(e) => setEmail(e.target.value)}
      ></input>
      <button onClick={submitAuth}>Login</button>
    </div>
  );
};

export default Login;
