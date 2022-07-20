import React, { useEffect, useState } from "react";
import { Magic } from "magic-sdk";
import Logout from "./Logout";

interface LoginProps {
  setUserData: any;
  userData: any;
}

const Login = ({ userData, setUserData }: LoginProps) => {
  const magic = new Magic(import.meta.env.VITE_MAGIC_API_KEY, {
    network: "ropsten",
  });
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");

  const submitAuth = async () => {
    const redirectURI = `${window.location.origin}/callback`;
    const DID = await magic.auth.loginWithMagicLink({ email, redirectURI });
    if (DID) setUserData(await magic.user.getMetadata());
  };

  const tryAuth = async () => {
    try {
      const DID = await magic.auth.loginWithCredential();
      window.location.href = window.location.origin + "/play";
    } catch (e) {
      console.error(e);
      window.location.href = window.location.origin;
    }
  };

  const checkAuth = async () => {
    const isLoggedIn = await magic.user.isLoggedIn();
    if (isLoggedIn) {
      const userMetadata = await magic.user.getMetadata();
      setUserData(userMetadata);
      setLoading(false);
    } else if (window.location.pathname !== "/") {
      tryAuth();
    }
    setLoading(false);
  };
  
  const logout = async () => {
    setLoading(true);
    await magic.user.logout();
    window.location.href = window.location.origin;
  }

  useEffect(() => {
    if (userData === null) checkAuth();
    if (window.location.pathname === "/callback") tryAuth();
  }, [userData]);

  if (loading) return <div className="login">Authenticating...</div>;
  if (userData) return <Logout logout={logout}/>

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
