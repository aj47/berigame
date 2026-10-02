import { restoreRecovery } from '../frontier/recovery';
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
    reconnectStatus,
    reconnectAttempt,
    retryConnection,
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
  // With the reconnect controller running, a dropped link after play shows a
  // small banner over the (frozen) world instead of the full loading overlay.
  const banner = disconnected && !assetError && Boolean(reconnectStatus);
  const showing = (isLoading || disconnected) && !banner;
  useEffect(() => {
    if (!showing) {
      setWaitingLong(false);
      return;
    }
    const timer = window.setTimeout(() => setWaitingLong(true), 9000);
    return () => window.clearTimeout(timer);
  }, [showing]);
  if (banner) return <ConnectionBanner status={reconnectStatus} attempt={reconnectAttempt} retry={retryConnection} />;
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
            <label>Restore a character backup<input type="file" accept="application/json" onChange={e=>{const file=e.target.files?.[0];if(file)void restoreRecovery(file).catch(error=>setRecoveryError(error.message));}}/></label>
            <p>Try Rejoin first. Starting again creates a new character in this world. Your previous sign-in will be backed up in this browser. This cannot fix a server outage.</p>
            <button className="primary-button" onClick={startNewCharacter}>Start a new character</button>
            {recoveryError && <p role="alert">{recoveryError}</p>}
          </details>
        )}
        <div className="loading-tips">
          <img src="/ui/punch.png" alt="" />
          <img src="/items/stick.png" alt="" />
          <img src="/items/blueberry.png" alt="" />
          <p>
            Four berry harvests earn Foraging level 2 and your first stick. A stick
            lets you push through the brambles. Keys 1–3 use your first three
            bag slots.
          </p>
        </div>
        <p className="fine-print">
          Tap the ground to move. Tap a tree to gather. Open Help anytime.
        </p>
      </div>
    </div>
  );
};
/** "Reconnecting…" while retrying; "Connection lost — Retry" once the controller gives up. */
export const ConnectionBanner = ({ status, attempt, retry }: { status: string; attempt: number; retry?: () => void }) => {
  const failed = status === "failed";
  const text = failed
    ? "Connection lost —"
    : status === "offline"
      ? "You're offline. Waiting for the network…"
      : attempt > 1
        ? `Reconnecting… (attempt ${attempt})`
        : "Reconnecting…";
  return (
    <div className={`connection-banner ${failed ? "failed" : ""}`} role="status" aria-live="polite" data-testid="connection-banner" data-status={status}>
      {!failed && <span className="spinner" aria-hidden="true" />}
      <span>{text}</span>
      {(failed || status === "offline") && (
        <button className="primary-button" onClick={() => (retry ? retry() : window.location.reload())}>Retry</button>
      )}
    </div>
  );
};
export default LoadingScreen;
