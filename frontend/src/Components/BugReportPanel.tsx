import React, { useEffect, useState } from 'react';
import { useMyPlayer } from '../spacetime/hooks';
import { useLoadingStore } from '../store';
import { tickClock } from '../spacetime/tickClock';
import { diagnosticAsset, diagnosticHistory, recordDiagnostic } from '../spacetime/diagnostics';
import './bugReport.css';

export function GameDiagnostics() {
  const me = useMyPlayer();
  useEffect(() => {
    if (me) recordDiagnostic('player', { region: me.region || 'bramblewild', x: me.x, z: me.z, hp: me.hp, state: me.state, online: me.online, tick: tickClock.tick });
  }, [me?.region, me?.x, me?.z, me?.hp, me?.state, me?.online]);
  useEffect(() => {
    const onError = (event: ErrorEvent) => recordDiagnostic('browser-error', { file: diagnosticAsset(event.filename), line: event.lineno, column: event.colno });
    const onRejection = () => recordDiagnostic('unhandled-rejection', {});
    const visibility = () => recordDiagnostic('visibility', { visible: document.visibilityState === 'visible' });
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  return null;
}

export function createBugReport(description: string) {
  const connection = useLoadingStore.getState();
  return JSON.stringify({
    format: 'berigame-bug-report-v1', capturedAt: new Date().toISOString(), description: description.slice(0, 2000),
    page: window.location.pathname,
    build: Array.from(document.scripts).map(script => diagnosticAsset(script.src)).filter(Boolean),
    browser: navigator.userAgent,
    viewport: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio },
    connection: { online: navigator.onLine, connected: connection.websocketConnected, loaded: connection.gameDataLoaded, stalled: connection.worldUpdatesStalled, attempt: connection.reconnectAttempt },
    clock: { tick: tickClock.tick, periodMs: Math.round(tickClock.period), lastTickAgeMs: tickClock.arrivedAt ? Math.max(0, Math.round(performance.now() - tickClock.arrivedAt)) : null },
    recent: diagnosticHistory(),
  }, null, 2);
}

export default function BugReportPanel({ onClose }: { onClose: () => void }) {
  const [description, setDescription] = useState('');
  const [report, setReport] = useState(() => createBugReport(''));
  const [status, setStatus] = useState('');
  const capture = () => { const next = createBugReport(description); setReport(next); return next; };
  const copy = async () => {
    try { await navigator.clipboard.writeText(capture()); setStatus('Report copied. Paste it into the feedback channel.'); }
    catch { setStatus('Could not copy. Select the report below or download it.'); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([capture()], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'berigame-bug-report.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setStatus('Report downloaded. Attach it to your feedback post.');
  };
  return <section className="game-panel bug-report-panel" aria-label="Report a bug">
    <header className="panel-heading"><h2>Report a bug</h2><button className="close-button" onClick={onClose} aria-label="Close bug report">×</button></header>
    <p>Describe what happened, then copy or download the report for <a href="https://discord.com/channels/1556010824827404308/1556011187936690281" target="_blank" rel="noreferrer">#feedback-n-bugs ↗</a>.</p>
    <label>What happened?<textarea maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} placeholder="What were you doing? What did you expect?" /></label>
    <p className="bug-report-note">Includes recent movement, action outcomes, tick timing and connection status. No chat, sign-in tokens or other players’ details. Nothing is sent automatically.</p>
    <div className="bug-report-actions"><button onClick={copy}>Copy report</button><button onClick={download}>Download report</button></div>
    {status && <p role="status">{status}</p>}
    <details><summary>Inspect captured diagnostics</summary><button onClick={capture}>Refresh diagnostics</button><textarea aria-label="Captured diagnostics" value={report} readOnly /></details>
  </section>;
}
