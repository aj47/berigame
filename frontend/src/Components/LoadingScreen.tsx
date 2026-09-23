import React, { useEffect, useRef, useState } from "react";
import { useLoadingStore } from "../store";
import { TOKEN_KEY } from "../spacetime/connection";
import { resetSessionToken } from "../spacetime/sessionToken";

const LoadingScreen = () => {
  const {
    isLoading,
    loadingProgress,
    loadingMessage,
    websocketConnected,
    gameDataLoaded,
    assetError,
    connectionIssue,
    worldUpdatesStalled,
    hasSavedSignIn,
  } = useLoadingStore();
  const [waitingLong, setWaitingLong] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const startNewCharacter = () => {
    try {
      resetSessionToken(localStorage, TOKEN_KEY);
      window.location.reload();
    } catch {
      setRecoveryError("The saved sign-in could not be backed up. It has been kept; check browser storage settings before trying again.");
    }
  };
  const hasPlayed = useRef(false);
  useEffect(() => {
    if (!isLoading && websocketConnected) hasPlayed.current = true;
  }, [isLoading, websocketConnected]);
  const disconnected =
    hasPlayed.current && (!websocketConnected || !gameDataLoaded || worldUpdatesStalled);
  const showing = isLoading || disconnected;
  useEffect(() => {
    if (!showing) {
      setWaitingLong(false);
      return;
    }
    const timer = window.setTimeout(() => setWaitingLong(true), 9000);
    return () => window.clearTimeout(timer);
  }, [showing]);
  if (!showing) return null;
  return (
    <div
      className={`loading-screen ${disconnected ? "connection-lost" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="loading-content">
        <img className="loading-berry" src="/items/blueberry.png" alt="" />
        <span className="eyebrow">The first island</span>
        <h1 className="game-title">BeriGame</h1>
        <p className="game-subtitle">Find your footing. Pick your battles.</p>
        {disconnected ? (
          <>
            <h2>Connection interrupted</h2>
            <p>
              {worldUpdatesStalled
                ? 'Live updates have stopped. Controls are paused, but the world keeps running. Rejoin to reconnect with your character.'
                : 'Your world connection was lost. Rejoin to continue with your character.'}
            </p>
          </>
        ) : (
          <>
            <div
              className="loading-progress"
              role="progressbar"
              aria-label="Loading the island"
              aria-valuenow={Math.round(loadingProgress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div style={{ width: `${loadingProgress * 100}%` }} />
            </div>
            <p className="loading-message">
              {loadingMessage || "Preparing the island…"}
            </p>
          </>
        )}
        {(waitingLong || disconnected || assetError || connectionIssue || worldUpdatesStalled) && (
          <div className="loading-recovery">
            <p>
              {assetError || (worldUpdatesStalled ? 'Waiting for fresh world updates.' : websocketConnected
                ? "The world is taking longer than usual to load."
                : "Still waiting for the game server.")}
            </p>
            <button
              className="primary-button"
              onClick={() => window.location.reload()}
            >
              Rejoin island
            </button>
          </div>
        )}
        {connectionIssue && hasSavedSignIn && (
          <details className="loading-recovery">
            <summary>Sign-in recovery</summary>
            <p>Try Rejoin first. Starting again creates a new character in this world. Your previous sign-in will be backed up in this browser. This cannot fix a server outage.</p>
            <button className="primary-button" onClick={startNewCharacter}>Start a new character</button>
            {recoveryError && <p role="alert">{recoveryError}</p>}
          </details>
        )}
        <div className="loading-tips">
          <img src="/ui/stance-strike.png" alt="" />
          <img src="/ui/stance-grab.png" alt="" />
          <img src="/ui/stance-guard.png" alt="" />
          <p>Strike beats Grab. Grab beats Guard. Guard beats Strike.</p>
        </div>
        <p className="fine-print">
          Tap the ground to move. Tap a tree to gather. Open Help anytime.
        </p>
      </div>
    </div>
  );
};
export default LoadingScreen;
