import React, { useEffect, useState } from 'react';
import AccountLogin from './AccountLogin';
import { accountToken, logOut, profile, removeLogin, type Account } from '../account/accountApi';
import { useToastStore } from '../spacetime/stores/toastStore';

const PROVIDER = { discord: 'Discord', google: 'Google', email: 'Email', passkey: 'Passkey' } as const;

/** Settings: save this character to an account, or manage the account's logins. */
export default function AccountSection() {
  const [account, setAccount] = useState<Account | null>(null);
  const [signedIn, setSignedIn] = useState(() => !!accountToken());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    profile().then(value => { if (live) setAccount(value); }, cause => {
      if (!live) return;
      if (!accountToken()) setSignedIn(false);
      else setError(cause instanceof Error ? cause.message : 'Your account could not be loaded.');
    });
    return () => { live = false; };
  }, [signedIn]);
  const done = (value: Account, intent: string) => {
    setAccount(value); setSignedIn(true);
    useToastStore.getState().show(intent === 'save' ? 'Character saved. Log in on any device to keep playing.' : 'Login added to your account.');
  };
  if (!signedIn) return <fieldset className="settings-group account-section">
    <legend>Account</legend>
    <p className="settings-hint">Save this character to an account so you can log in on any device. Without one, it stays in this browser only.</p>
    <AccountLogin intent="save" onDone={done} />
  </fieldset>;
  return <fieldset className="settings-group account-section">
    <legend>Account</legend>
    <p className="settings-hint">{account?.playerId ? 'Your character is saved to this account.' : account ? 'This account has no character in this world.' : 'Loading your account…'}</p>
    {account && <ul className="account-logins" aria-label="Logins">
      {account.logins.map(login => <li key={login.id}>
        <span><strong>{PROVIDER[login.provider]}</strong> {login.label}</span>
        {account.logins.length > 1 && <button type="button" disabled={busy} aria-label={`Remove ${PROVIDER[login.provider]} login ${login.label}`} onClick={() => {
          setBusy(true); setError('');
          removeLogin(login.id).then(setAccount, cause => setError(cause instanceof Error ? cause.message : 'Please try again.')).finally(() => setBusy(false));
        }}>Remove</button>}
      </li>)}
    </ul>}
    <details>
      <summary>Add a login</summary>
      <AccountLogin intent="add" onDone={done} />
    </details>
    {error && <p className="account-error" role="alert">{error}</p>}
    {confirming && <p className="settings-hint">Your character stays saved to your account. Log in again to play it here.</p>}
    <button type="button" className="account-logout" disabled={busy} onClick={() => {
      if (!confirming) { setConfirming(true); return; }
      setBusy(true); void logOut();
    }}>{confirming ? 'Confirm log out' : 'Log out on this browser'}</button>
  </fieldset>;
}
