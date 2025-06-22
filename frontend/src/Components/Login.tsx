import React, { useEffect, useState } from "react";
import { auth } from "../Auth";
import Logout from "./Logout";

interface LoginProps {
  setUserData: any;
  userData: any;
}

declare global {
  interface Window {
    google: any;
  }
}

const Login = ({ userData, setUserData }: LoginProps) => {
  const [loading, setLoading] = useState("Loading...");

  const handleGoogleSignIn = async (response: any) => {
    try {
      setLoading("Authenticating with Google...");

      // Send the Google token to our backend
      const apiResponse = await fetch(`${import.meta.env.VITE_API_URL || 'https://dm465kqzfi.execute-api.ap-southeast-2.amazonaws.com/dev'}/google-auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          googleToken: response.credential,
        }),
      });

      const result = await apiResponse.json();

      if (result.success) {
        auth.setToken(result.data.token);
        setUserData(result.data.user);
        setLoading("");
      } else {
        console.error('Authentication failed:', result.message);
        setLoading("");
      }
    } catch (error) {
      console.error('Google Sign-In error:', error);
      setLoading("");
    }
  };

  const checkExistingAuth = async () => {
    setLoading("Checking authentication...");
    const token = await auth.getToken();

    if (token) {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL || 'https://dm465kqzfi.execute-api.ap-southeast-2.amazonaws.com/dev'}/auth`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token,
          },
        });

        const result = await response.json();

        if (result.success) {
          setUserData(result.data.user);
          setLoading("");
          return;
        }
      } catch (error) {
        console.error('Auth check failed:', error);
      }
    }

    setLoading("");
  };

  const logout = async () => {
    setLoading("Logging out...");
    auth.removeToken();
    setUserData(null);
    setLoading("");
  };

  useEffect(() => {
    // Load Google Identity Services
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);

    script.onload = () => {
      if (window.google) {
        window.google.accounts.id.initialize({
          client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
          callback: handleGoogleSignIn,
        });
      }
    };

    if (userData === null) {
      checkExistingAuth();
    } else {
      setLoading("");
    }

    return () => {
      document.head.removeChild(script);
    };
  }, []);

  useEffect(() => {
    if (!loading && !userData && window.google) {
      window.google.accounts.id.renderButton(
        document.getElementById('google-signin-button'),
        {
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
        }
      );
    }
  }, [loading, userData]);

  if (loading) return <div className="login">{loading}</div>;
  if (userData) return <Logout logout={logout} />;

  return (
    <div className="login">
      <h2>Berigame</h2>
      <p>Sign in with your Google account to play</p>
      <div id="google-signin-button"></div>
    </div>
  );
};

export default Login;
