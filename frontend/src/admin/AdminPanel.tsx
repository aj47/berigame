import React, { useCallback, useEffect, useState } from 'react';
import './admin.css';
import type { Snapshot } from './types';
import { ago, dayDate } from './format';
import { ActivityTab, EconomyTab, GatewayTab, OverviewTab, PlayersTab } from './tabs';
import { PlayerDrawer } from './PlayerDrawer';
import { AuthError, adminFetch } from './api';

/**
 * Owner-only admin panel at /admin. Every number comes from the Worker's
 * ADMIN_TOKEN-protected /api/admin routes; the token never leaves this browser
 * except in that header. docs/ANALYTICS.md describes what is recorded.
 */
const TOKEN_KEY = 'berigame.admin.token';
const TABS = ['Overview', 'Players', 'Activity', 'Economy', 'Gateway'] as const;
type Tab = (typeof TABS)[number];

function tabFromHash(): Tab {
  const hash = decodeURIComponent(window.location.hash.slice(1));
  return (TABS as readonly string[]).includes(hash) ? (hash as Tab) : 'Overview';
}
function readToken(): string {
  try { return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}
function storeToken(token: string, remember: boolean) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    if (remember) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked: the token lives for this page only */ }
}
function clearToken() {
  try { sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); } catch { /* nothing stored */ }
}

function SignIn({ onToken, error }: { onToken: (token: string, remember: boolean) => void; error: string }) {
  const [value, setValue] = useState('');
  const [remember, setRemember] = useState(false);
  return <main className="adm-signin">
    <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) onToken(value.trim(), remember); }}>
      <h1>BeriGame admin</h1>
      <p>Paste the beta Worker's <code>ADMIN_TOKEN</code>.</p>
      <input type="password" autoComplete="current-password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Admin token" autoFocus />
      <label><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember on this device</label>
      {error && <div className="adm-error" role="alert">{error}</div>}
      <button type="submit">Open panel</button>
    </form>
  </main>;
}

export default function AdminPanel() {
  const [token, setToken] = useState(readToken);
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => { document.title = 'Admin · BeriGame'; }, []);
  useEffect(() => { window.history.replaceState(null, '', `#${tab}`); }, [tab]);
  useEffect(() => {
    const follow = () => setTab(tabFromHash());
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setData(await adminFetch<Snapshot>('/api/admin/stats', token, { days }));
      setError('');
    } catch (e) {
      if (e instanceof AuthError) { clearToken(); setToken(''); }
      setError((e as Error).message);
    } finally { setLoading(false); }
  }, [token, days]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!auto || !token) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    return () => clearInterval(timer);
  }, [auto, token, load]);

  if (!token) return <div className="admin-root"><SignIn error={error} onToken={(t, remember) => { storeToken(t, remember); setError(''); setToken(t); }} /></div>;

  const game = data?.game;
  return <div className="admin-root">
    <header className="adm-header">
      <div className="adm-title">
        <h1>BeriGame admin</h1>
        {game && <span className="adm-muted">tick {game.world.tick.toLocaleString()} · updated {ago(game.generatedAt)}{loading ? ' · refreshing…' : ''}</span>}
      </div>
      <div className="adm-controls">
        <label>Range <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select></label>
        <label className="adm-check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-refresh</label>
        <button onClick={() => void load()} disabled={loading}>Refresh</button>
        <button className="adm-ghost" onClick={() => { clearToken(); setToken(''); setData(null); }}>Sign out</button>
      </div>
    </header>
    <nav className="adm-tabs" role="tablist">
      {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}
    </nav>
    {error && <div className="adm-error adm-banner" role="alert">{error}</div>}
    <main className="adm-main">
      {!data ? <div className="adm-muted adm-loading">{loading ? 'Loading the island…' : 'No data yet.'}</div> : <>
        {game && game.activitySince !== null && game.series.length > 0 && game.activitySince > game.series[0].day && (tab === 'Overview' || tab === 'Activity') &&
          <div className="adm-note">Daily activity has been recorded since {dayDate(game.activitySince)} (UTC). Earlier days show new players and coins only.</div>}
        {tab === 'Overview' && <OverviewTab data={data} onPlayer={setSelected} />}
        {tab === 'Players' && <PlayersTab data={data} onPlayer={setSelected} />}
        {tab === 'Activity' && <ActivityTab data={data} />}
        {tab === 'Economy' && <EconomyTab data={data} onPlayer={setSelected} />}
        {tab === 'Gateway' && <GatewayTab data={data} />}
      </>}
    </main>
    {selected && <PlayerDrawer id={selected} token={token} onClose={() => setSelected(null)} />}
  </div>;
}
