import React, { useEffect, useState } from "react";
import { auth } from "../Auth";
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

  const initUserData = async () => {
    const userMetadata = await magic.user.getMetadata();
    const DID = await magic.user.getIdToken();
    auth.setToken(DID);
    setUserData({ ...userMetadata, DID });
    setLoading(false);
  };

  const submitAuth = async () => {
    const redirectURI = `${window.location.origin}/callback`;
    const DID = await magic.auth.loginWithMagicLink({ email, redirectURI });
    if (DID) initUserData();
  };

  const tryAuth = async () => {
    const token = await auth.getToken();
    if (!token) return;
    try {
      const DID = await magic.auth.loginWithCredential(token);
      if (DID) initUserData();
    } catch (e) {
      console.error(e);
    }
  };

  const checkAuth = async () => {
    const isLoggedIn = await magic.user.isLoggedIn();
    if (isLoggedIn) {
      initUserData();
    } else {
      tryAuth();
    }
    setLoading(false);
  };

  const logout = async () => {
    setLoading(true);
    await magic.user.logout();
    window.location.href = window.location.origin;
  };

  useEffect(() => {
    if (userData === null) checkAuth();
    else setLoading(false);
  }, [userData]);

  if (loading) return <div className="login">Authenticating...</div>;
  if (userData) return <Logout logout={logout} />;

  return (
    <div className="login">
      <img src="/logo.png" alt="logo" className="logo" />
      <h2>cubespaced</h2>
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
