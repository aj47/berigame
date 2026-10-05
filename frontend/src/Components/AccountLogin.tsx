import React, { useEffect, useState } from 'react';
import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { providers, startEmail, startOAuth, withPasskey, verifyEmail, type Account, type Intent, type Providers } from '../account/accountApi';
import './account.css';

const LABELS = { discord: 'Discord', google: 'Google', email: 'Email', passkey: 'Passkey' } as const;
let cached: Promise<Providers> | undefined;

/** The four login methods, for logging in, saving a guest character, or adding a login. */
export default function AccountLogin({ intent, onDone }: { intent: Intent; onDone: (account: Account, intent: Intent) => void | Promise<void> }) {
  const [available, setAvailable] = useState<Providers | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [emailOpen, setEmailOpen] = useState(false);
  const [requestId, setRequestId] = useState('');
  const [code, setCode] = useState('');
  useEffect(() => {
    let live = true;
    (cached ??= providers()).then(value => { if (live) setAvailable(value); }, () => { cached = undefined; if (live) setError('Accounts are unavailable right now.'); });
    return () => { live = false; };
  }, []);
  const run = async (action: () => Promise<void>) => {
    setError(''); setBusy(true);
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Please try again.'); }
    finally { setBusy(false); }
  };
  if (!available) return error ? <p className="account-error" role="alert">{error}</p> : null;
  const passkey = available.passkey && browserSupportsWebAuthn();
  return <div className="account-login">
    <div className="account-methods">
      {available.discord && <button type="button" disabled={busy} onClick={() => void run(() => startOAuth('discord', intent))}>{LABELS.discord}</button>}
      {available.google && <button type="button" disabled={busy} onClick={() => void run(() => startOAuth('google', intent))}>{LABELS.google}</button>}
      {passkey && <button type="button" disabled={busy} onClick={() => void run(async () => { await onDone(await withPasskey(intent), intent); })}>{LABELS.passkey}</button>}
      {available.email && <button type="button" disabled={busy} aria-expanded={emailOpen} onClick={() => setEmailOpen(open => !open)}>{LABELS.email}</button>}
    </div>
    {emailOpen && !requestId && <form className="account-email" onSubmit={event => { event.preventDefault(); void run(async () => { setRequestId(await startEmail(email, intent)); }); }}>
      <label>Email address
        <input type="email" autoComplete="email" required maxLength={254} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} />
      </label>
      <button type="submit" disabled={busy || !email}>Send login code</button>
    </form>}
    {emailOpen && requestId && <form className="account-email" onSubmit={event => { event.preventDefault(); void run(async () => {
      const result = await verifyEmail(requestId, code);
      await onDone(result.account, intent);
    }); }}>
      <p className="account-hint">We sent a link and a 6-digit code to {email}. Open the link, or enter the code here.</p>
      <label>Code
        <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} disabled={busy}
          onChange={event => setCode(event.target.value.replace(/\D/g, ''))} />
      </label>
      <button type="submit" disabled={busy || code.length !== 6}>Confirm</button>
      <button type="button" className="account-link-button" disabled={busy} onClick={() => { setRequestId(''); setCode(''); }}>Use a different email</button>
    </form>}
    {error && <p className="account-error" role="alert">{error}</p>}
  </div>;
}
