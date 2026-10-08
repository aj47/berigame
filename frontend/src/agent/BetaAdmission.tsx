import React, { useEffect, useRef, useState } from 'react';
import { SPACETIME_DB, SPACETIME_URI, TOKEN_KEY } from '../spacetime/connection';
import AccountLogin from '../Components/AccountLogin';
import { accountToken, completeReturningLogin, playAccountCharacter } from '../account/accountApi';
import { useToastStore } from '../spacetime/stores/toastStore';
import { admissionIssue, AdmissionIssue, canRenew, expiryKey, idleKey, onSignedOut, renewalDelay, renewKey, renewVisit, RENEW_TOKEN, RETRY_MS, savedExpiry as readExpiry } from '../spacetime/visitRenewal';
import { IDLE_LOGOUT_MINUTES } from '../../../shared/sim/admission';

const EXPIRY_KEY = expiryKey(TOKEN_KEY);
const RENEW_KEY = renewKey(TOKEN_KEY);
const required = import.meta.env.VITE_INVITE_REQUIRED === 'true';
const openBeta = import.meta.env.VITE_OPEN_BETA === 'true';
type Admission = { token: string; uri: string; database: string; expiresAt: string; renewToken?: string };
const savedExpiry = () => { try { return readExpiry(localStorage, TOKEN_KEY); } catch { return 0; } };
const renewable = () => { try { return canRenew(localStorage, TOKEN_KEY); } catch { return false; } };

export default function BetaAdmission({ children }: { children: React.ReactNode }) {
  const [expiry, setExpiry] = useState(savedExpiry);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  // A saved account counts as returning: it brings its character back.
  const [returning, setReturning] = useState(() => renewable() || !!accountToken());
  const [issue, setIssue] = useState<AdmissionIssue | null>(null);
  const [clock, setClock] = useState(Date.now);
  const [paused, setPaused] = useState(false);
  const [retry, setRetry] = useState(0);
  const [resuming, setResuming] = useState(() => /^#(account|login=)/.test(window.location.hash));
  /** Logged out for inactivity: nothing reconnects until the player chooses to return. */
  const [idle, setIdle] = useState(false);
  const accountResumes = useRef<number[]>([]);
  useEffect(() => { if (!issue) return; const timer = window.setInterval(() => setClock(Date.now()), 1000); return () => window.clearInterval(timer); }, [issue]);
  const remaining = issue ? Math.max(0, Math.ceil((issue.retryAt - clock) / 1000)) : 0;
  const issued = useRef<Admission>();
  /** A saved account brings its character back when this browser's visit has ended. */
  const resumeWithAccount = async () => {
    // At most twice in ten minutes, so a character the world will not renew cannot loop.
    const now = Date.now();
    accountResumes.current = accountResumes.current.filter(at => now - at < 600_000);
    if (!accountToken() || accountResumes.current.length >= 2) return false;
    accountResumes.current.push(now);
    try { await playAccountCharacter(); setReturning(true); setRetry(value => value + 1); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Your account could not be loaded. Log in again.'); return false; }
  };
  // Back from Discord/Google (#account) or an emailed link (#login=…).
  useEffect(() => {
    if (!required) return;
    let live = true;
    completeReturningLogin().then(async result => {
      if (!live || !result) return;
      if (result.intent === 'login' || !renewable()) { await playAccountCharacter(); setReturning(true); setRetry(value => value + 1); return; }
      useToastStore.getState().show(result.intent === 'save' ? 'Character saved. Log in on any device to keep playing.' : 'Login added to your account.');
    }).catch(cause => { if (live) setError(cause instanceof Error ? cause.message : 'The login could not be finished. Try again.'); })
      .finally(() => { if (live) setResuming(false); });
    return () => { live = false; };
  }, []);
  // The world took the character offline on an open socket: drop the saved permit (every tab follows
  // through the storage event) and let the renewal below ask the gateway why.
  useEffect(() => {
    if (!required) return;
    return onSignedOut(() => {
      try { localStorage.setItem(EXPIRY_KEY, '0'); } catch { /* the state below still closes the game */ }
      setExpiry(0);
    });
  }, []);
  // Another tab renewed or joined: adopt its permit instead of renewing again.
  useEffect(() => {
    if (!required) return;
    const sync = (event: StorageEvent) => {
      if (event.key === null || event.key === EXPIRY_KEY || event.key === RENEW_KEY || event.key === TOKEN_KEY) {
        setExpiry(savedExpiry()); setReturning(renewable());
        if (savedExpiry() > Date.now()) setIdle(false); // another tab returned from an idle logout
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  // Returning browsers keep their character: renew shortly before the permit ends (F1).
  useEffect(() => {
    if (!required || paused || idle) return;
    let cancelled = false;
    let timer = 0;
    const schedule = (delay: number) => { timer = window.setTimeout(run, delay); };
    const run = async () => {
      if (!renewable()) {
        if (await resumeWithAccount() || cancelled) return;
        if (expiry > Date.now()) schedule(expiry - Date.now());
        else if (expiry) { setExpiry(0); setReturning(false); setError('Your visit has ended. Enter again to return to the island.'); }
        else setReturning(false);
        return;
      }
      let failure: AdmissionIssue | undefined;
      const outcome = await renewVisit({ storage: localStorage, tokenKey: TOKEN_KEY, fetch: window.fetch.bind(window),
        locks: (navigator as any).locks, onIssue: value => { failure = value; } });
      if (cancelled) return;
      if (outcome === 'renewed' || outcome === 'fresh') { setIssue(null); setExpiry(savedExpiry()); schedule(renewalDelay(savedExpiry(), Date.now())); return; }
      if (outcome === 'idle') { setIssue(null); setExpiry(0); setIdle(true); return; }
      if (outcome === 'ended') {
        if (await resumeWithAccount() || cancelled) return;
        setReturning(false); setExpiry(savedExpiry());
        setError('Your island sign-in has ended. Enter again to return.');
        return;
      }
      failure ??= { message: 'The island could not be reached. Check your connection and try again.', retryAt: Date.now() + RETRY_MS };
      setIssue(failure); setClock(Date.now());
      schedule(Math.max(0, failure.retryAt - Date.now())); // unavailable: keep playing until the permit ends, then keep retrying on the gate.
      if (savedExpiry() <= Date.now()) setExpiry(0);
    };
    schedule(renewalDelay(expiry, Date.now()));
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [expiry, paused, retry, idle]);
  /** The player chose to return after an idle logout. */
  const returnFromIdle = async () => {
    if (pending) return;
    setPending(true); setError('');
    let failure: AdmissionIssue | undefined;
    try {
      const outcome = await renewVisit({ storage: localStorage, tokenKey: TOKEN_KEY, fetch: window.fetch.bind(window),
        locks: (navigator as any).locks, onIssue: value => { failure = value; }, resume: true });
      if (outcome === 'renewed' || outcome === 'fresh') { setIdle(false); setIssue(null); setExpiry(savedExpiry()); return; }
      if (outcome === 'ended') { setIdle(false); setReturning(false); setError('Your island sign-in has ended. Enter again to return.'); return; }
      if (outcome === 'unavailable') { setIssue(failure ?? { message: 'The island could not be reached. Check your connection and try again.', retryAt: Date.now() + RETRY_MS }); setClock(Date.now()); }
    } finally { setPending(false); }
  };
  const notice = issue && <section role="status" aria-label="Island connection" style={{ background: '#18271f', color: '#fff', padding: '16px', border: '1px solid #b4cf8b', borderRadius: 12, maxWidth: 480 }}>
    <strong>Waiting to connect</strong><p>{issue.message}</p>
    <p>Your saved character is kept in this browser.</p>
    <p>{remaining > 0 ? `Next attempt available in ${remaining}s.` : paused ? 'Automatic retry is paused.' : 'Ready to retry.'}</p>
    {returning && <><button className="primary-button" disabled={remaining > 0} onClick={() => { setPaused(false); setRetry(value => value + 1); }}>Try again</button>
    <button className="primary-button" onClick={() => setPaused(value => !value)}>{paused ? 'Resume automatic retry' : 'Pause automatic retry'}</button></>}
  </section>;
  if (!required) return <>{children}</>;
  if (idle) {
    return <main className="loading-screen beta-admission"><div className="loading-content">
      <img className="loading-berry" src="/items/blueberry.png" alt="" />
      <span className="eyebrow">The first island · {openBeta ? 'Open beta' : 'Private beta'}</span>
      <h1 className="game-title">BeriGame</h1>
      <p className="game-subtitle">You were logged out after {IDLE_LOGOUT_MINUTES} minutes without playing. Your character and bag are saved.</p>
      {issue && <p role="status">{issue.message}{remaining > 0 ? ` Try again in ${remaining}s.` : ''}</p>}
      {error && <p className="beta-invite-error" role="alert">{error}</p>}
      <button className="primary-button" disabled={pending || remaining > 0} onClick={returnFromIdle}>
        {pending ? 'Returning…' : 'Return to the island'}
      </button>
    </div></main>;
  }
  if (expiry > Date.now()) return <>{children}{notice && <div style={{ position: 'fixed', top: 16, left: 16, zIndex: 10000 }}>{notice}</div>}</>;
  if (returning || resuming) {
    return <main className="loading-screen beta-admission"><div className="loading-content">
      <img className="loading-berry" src="/items/blueberry.png" alt="" />
      <span className="eyebrow">The first island · {openBeta ? 'Open beta' : 'Private beta'}</span>
      <h1 className="game-title">BeriGame</h1>
      <p className="game-subtitle">{issue ? 'Your return is on hold.' : 'Welcome back. Returning you to the island…'}</p>{notice}
    </div></main>;
  }

  async function join(event: React.FormEvent) {
    event.preventDefault();
    if (pending || (issue && issue.retryAt > Date.now())) return;
    setPending(true); setError('');
    try {
      // Check storage before consuming an invite. Retain a received credential in
      // memory if saving fails, so clicking again never redeems the invite twice.
      localStorage.setItem(`${EXPIRY_KEY}:probe`, '0'.repeat(4096));
      localStorage.removeItem(`${EXPIRY_KEY}:probe`);
      if (!issued.current) {
        if (!openBeta && !/^bgh_[A-Za-z0-9_-]{43}$/.test(code.trim())) throw new Error('Paste a player invite from the world operator. Agent invites are used through the API.');
        const response = await fetch('/api/play/v1/sessions', { method: 'POST', headers: {
          ...(!openBeta ? { Authorization: `Bearer ${code.trim()}` } : {}), 'Content-Type': 'application/json',
        }, body: '{}', cache: 'no-store' });
        const body = await response.json();
        if (response.status === 429) { setIssue(admissionIssue(response, body)); setClock(Date.now()); return; }
        if (!response.ok) throw new Error(body?.error?.message ?? 'The island could not be reached. Try again shortly.');
        if (typeof body.token !== 'string' || (body.renewToken !== undefined && !RENEW_TOKEN.test(body.renewToken)) || body.uri !== SPACETIME_URI || body.database !== SPACETIME_DB
          || !(Date.parse(body.expiresAt) > Date.now())) throw new Error('The island returned an invalid sign-in. Contact the world operator.');
        issued.current = body;
      }
      const admission = issued.current!;
      localStorage.setItem(TOKEN_KEY, admission.token);
      if (admission.renewToken) localStorage.setItem(RENEW_KEY, admission.renewToken);
      else localStorage.removeItem(RENEW_KEY);
      localStorage.setItem(EXPIRY_KEY, String(Date.parse(admission.expiresAt)));
      localStorage.removeItem(idleKey(TOKEN_KEY));
      setIssue(null); setCode(''); setReturning(!!admission.renewToken); setExpiry(Date.parse(admission.expiresAt));
    } catch (cause) {
      setError(cause instanceof DOMException ? 'Enable browser storage to keep your island sign-in, then try again.'
        : cause instanceof Error ? cause.message : 'The island could not be reached. Try again shortly.');
    } finally { setPending(false); }
  }

  return <main className="loading-screen beta-admission">
    <div className="loading-content">
      <img className="loading-berry" src="/items/blueberry.png" alt="" />
      <span className="eyebrow">The first island · {openBeta ? 'Open beta' : 'Private beta'}</span>
      <h1 className="game-title">BeriGame</h1>
      <p className="game-subtitle">Find your footing. Pick your battles.</p>
      <form className="beta-invite-form" onSubmit={join}>
        {!openBeta && <><label htmlFor="player-invite">Your player invite</label>
        <input id="player-invite" type="password" autoComplete="off" spellCheck={false} value={code}
          onChange={event => setCode(event.target.value)} placeholder="Paste your invite code" maxLength={64}
          aria-describedby={error ? 'invite-help invite-error' : 'invite-help'} aria-invalid={!!error}
          disabled={pending || !!issued.current} required={!issued.current} /></>}
        <p id="invite-help">{openBeta ? 'No invite needed. Enter and start playing.' : 'Ask the world operator for a player invite.'} This browser remembers your character for 30 days after your last visit.</p>
        {notice}
        {error && <p id="invite-error" className="beta-invite-error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={pending || remaining > 0}>
          {pending ? 'Opening the island…' : issued.current ? 'Continue to the island' : 'Enter the island'}
        </button>
      </form>
      <details className="beta-account">
        <summary>Saved your character? Log in</summary>
        <AccountLogin intent="login" onDone={async () => { await playAccountCharacter(); setReturning(true); setRetry(value => value + 1); }} />
      </details>
      <a className="beta-agent-link" href="/agent">Bringing an agent? Open the field guide <span aria-hidden="true">↗</span></a>
      <div className="loading-tips">
        <img src="/ui/punch.png" alt="" /><img src="/items/stick.png" alt="" /><img src="/items/blueberry.png" alt="" />
        <p>Explore the island. Gather berries. Choose your next move.</p>
      </div>
    </div>
  </main>;
}
