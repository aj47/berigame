import React, { useEffect, useRef, useState } from 'react';
import { SPACETIME_DB, SPACETIME_URI, TOKEN_KEY } from '../spacetime/connection';

const EXPIRY_KEY = `${TOKEN_KEY}:permit-expires`;
const required = (import.meta as any).env?.VITE_INVITE_REQUIRED === 'true';
type Admission = { token: string; uri: string; database: string; expiresAt: string };
function savedExpiry() {
  try { return localStorage.getItem(TOKEN_KEY) ? Number(localStorage.getItem(EXPIRY_KEY)) || 0 : 0; }
  catch { return 0; }
}

export default function BetaAdmission({ children }: { children: React.ReactNode }) {
  const [expiry, setExpiry] = useState(savedExpiry);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const issued = useRef<Admission>();
  useEffect(() => {
    if (!required || expiry <= Date.now()) return;
    const timer = window.setTimeout(() => { setExpiry(0); setError('Your visit has ended. Use a new invite to return to the island.'); }, expiry - Date.now());
    return () => window.clearTimeout(timer);
  }, [expiry]);
  if (!required || expiry > Date.now()) return <>{children}</>;

  async function join(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError('');
    try {
      // Check storage before consuming an invite. Retain a received credential in
      // memory if saving fails, so clicking again never redeems the invite twice.
      localStorage.setItem(`${EXPIRY_KEY}:probe`, '0'.repeat(4096));
      localStorage.removeItem(`${EXPIRY_KEY}:probe`);
      if (!issued.current) {
        if (!/^bgh_[A-Za-z0-9_-]{43}$/.test(code.trim())) throw new Error('Paste a player invite from the world operator. Agent invites are used through the API.');
        const response = await fetch('/api/play/v1/sessions', { method: 'POST', headers: {
          Authorization: `Bearer ${code.trim()}`, 'Content-Type': 'application/json',
        }, body: '{}', cache: 'no-store' });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message ?? 'The island could not be reached. Try again shortly.');
        if (typeof body.token !== 'string' || body.uri !== SPACETIME_URI || body.database !== SPACETIME_DB
          || !(Date.parse(body.expiresAt) > Date.now())) throw new Error('The island returned an invalid sign-in. Contact the world operator.');
        issued.current = body;
      }
      const admission = issued.current!;
      localStorage.setItem(TOKEN_KEY, admission.token);
      localStorage.setItem(EXPIRY_KEY, String(Date.parse(admission.expiresAt)));
      setCode(''); setExpiry(Date.parse(admission.expiresAt));
    } catch (cause) {
      setError(cause instanceof DOMException ? 'Enable browser storage to keep your island sign-in, then try again.'
        : cause instanceof Error ? cause.message : 'The island could not be reached. Try again shortly.');
    } finally { setPending(false); }
  }

  return <main className="loading-screen beta-admission">
    <div className="loading-content">
      <img className="loading-berry" src="/items/blueberry.png" alt="" />
      <span className="eyebrow">The first island · Private beta</span>
      <h1 className="game-title">BeriGame</h1>
      <p className="game-subtitle">Find your footing. Pick your battles.</p>
      <form className="beta-invite-form" onSubmit={join}>
        <label htmlFor="player-invite">Your player invite</label>
        <input id="player-invite" type="password" autoComplete="off" spellCheck={false} value={code}
          onChange={event => setCode(event.target.value)} placeholder="Paste your invite code" maxLength={64}
          aria-describedby={error ? 'invite-help invite-error' : 'invite-help'} aria-invalid={!!error}
          disabled={pending || !!issued.current} required={!issued.current} />
        <p id="invite-help">One invite opens a one-hour visit. Ask the world operator for a code.</p>
        {error && <p id="invite-error" className="beta-invite-error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? 'Opening the island…' : issued.current ? 'Continue to the island' : 'Enter the island'}
        </button>
      </form>
      <a className="beta-agent-link" href="/agent">Bringing an agent? Open the field guide <span aria-hidden="true">↗</span></a>
      <div className="loading-tips">
        <img src="/ui/stance-strike.png" alt="" /><img src="/ui/stance-grab.png" alt="" /><img src="/ui/stance-guard.png" alt="" />
        <p>Explore the island. Gather berries. Choose your next move.</p>
      </div>
    </div>
  </main>;
}
