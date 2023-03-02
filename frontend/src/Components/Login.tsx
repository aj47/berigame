import React, { useEffect, useState } from "react";
import { auth } from "../Auth";
import { Magic } from "magic-sdk";
import Logout from "./Logout";

interface LoginProps {
  setUserData: any;
  userData: any;
}

const Login = ({ userData, setUserData }: LoginProps) => {
  const [magic, setMagic] = useState<any>(null);
  const [loading, setLoading] = useState("Loading...");
  const [email, setEmail] = useState("");

  const initUserData = async () => {
    setLoading("Authenticating user...")
    const userMetadata = await magic.user.getMetadata();
    setLoading("Logging in...");
    const DID = await magic.user.getIdToken();
    auth.setToken(DID);
    setUserData({ ...userMetadata, DID });
    setLoading("");
  };

  const submitAuth = async () => {
    const redirectURI = `${window.location.origin}/callback`;
    const DID = await magic.auth.loginWithMagicLink({ email, redirectURI });
    if (DID) initUserData();
  };

  const tryAuth = async () => {
    setLoading("Attempting Authentication...");
    const token = await auth.getToken();
    try {
      const DID = await magic.auth.loginWithCredential(token);
      if (DID) initUserData();
    } catch (e) {
      setLoading("");
    }
  };

  const checkAuth = async () => {
    setLoading("Attempting Authentication...");
    const isLoggedIn = await magic.user.isLoggedIn();
    if (isLoggedIn) {
      initUserData();
    } else {
      tryAuth();
    }
  };

  const logout = async () => {
    setLoading("Logging out...");
    await magic.user.logout();
    window.location.href = window.location.origin;
  };

  useEffect(() => {
    if (!magic) {
      setMagic(
        new Magic(import.meta.env.VITE_MAGIC_API_KEY)
      );
      return;
    }
    if (userData === null) checkAuth();
    else setLoading("");
  }, [userData, magic]);

  if (loading) return <div className="login">{loading}</div>;
  if (userData) return <Logout logout={logout} />;

  return (
    <div className="login">
      {/* <img src="/logo.png" alt="logo" className="logo" /> */}
      <h2>Berigame</h2>
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
