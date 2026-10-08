import React, { Suspense, lazy } from 'react';
import { resolveSiteRedirect, resolveSiteRoute } from './site/routeUtils';
import { isGameHost } from './site/siteUrls';
const Game = lazy(() => import('./Game'));
const Site = lazy(() => import('./site/Site'));
const AgentEntry = lazy(() => import('./site/AgentEntry'));
const AdminPanel = lazy(() => import('./admin/AdminPanel'));
const route = resolveSiteRoute(window.location.pathname, window.location.search, window.location.hostname);
const redirect = resolveSiteRedirect(window.location.pathname, window.location.search, window.location.hash, window.location.hostname);
if (redirect) window.location.replace(redirect);
// Old friend invites must reach the game before its invite reader is imported.
if (!redirect && !isGameHost(window.location.hostname) && route.kind === 'game' && window.location.pathname.replace(/\/+$/, '') === '') {
  window.history.replaceState(null, '', `/play${window.location.search}${window.location.hash}`);
}

function App() {
  return <Suspense fallback={<div role="status" style={{ background: '#132c26', color: '#f7f4eb', minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'Georgia, serif', fontSize: 24 }}>Opening BeriGame…</div>}>
    {redirect ? <div role="status">Opening BeriGame…</div> : route.kind === 'game' ? <Game /> : route.kind === 'agent' ? <AgentEntry /> : route.kind === 'admin' ? <AdminPanel /> : <Site route={route} />}
  </Suspense>;
}

export default App;
