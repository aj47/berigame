import React, { useState } from 'react';
import { exportRecovery, restoreRecovery } from '../frontier/recovery';

/** Recovery restores sign-in access; it is never a manual game save. */
export default function CharacterRecovery() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setError(''); setBusy(true);
    try { await action(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };
  return <fieldset className="settings-group">
    <legend>Your character</legend>
    <p className="settings-hint">Your progress, coins and land save automatically on the server.</p>
    <details>
      <summary>Restore access on another browser</summary>
      <p className="settings-hint">Your current browser remembers your sign-in. An optional recovery key lets you return to this character if you lose that sign-in or change browsers. Keep it private.</p>
      <button disabled={busy} onClick={() => void run(exportRecovery)}>Download recovery key</button>
      <p className="settings-hint">Downloading a new key replaces your previous one.</p>
      <label>Use a recovery key
        <input type="file" accept="application/json" disabled={busy} onChange={event => {
          const file = event.target.files?.[0];
          if (file) void run(() => restoreRecovery(file));
        }} />
      </label>
      {error && <p role="alert">{error}</p>}
    </details>
  </fieldset>;
}
