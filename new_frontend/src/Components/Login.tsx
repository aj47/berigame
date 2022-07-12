import React, { useState } from "react";
import { Magic } from 'magic-sdk';

const Login = (props) => {
	const magic = new Magic(import.meta.env.VITE_MAGIC_API_KEY);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [email, setEmail] = useState("");
  const tryAuth = async () => {
    const redirectURI = `${window.location.origin}/login-callback`;
    await magic.auth.loginWithMagicLink({email, redirectURI});
  };

  return (
    <div className="login">
      <img src="/saturn-og.png" alt="saturn" className="logo" />
      <input
        placeholder="email@domain.com"
        type="email"
        onChange={(e) => setEmail(e.target.value)}
      ></input>
      <button onClick={tryAuth}>Login</button>
    </div>
  );
};

export default Login;
