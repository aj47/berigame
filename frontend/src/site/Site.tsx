import { homeUrl, wikiUrl, gameUrl, agentUrl } from './siteUrls';
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import './site.css';
import { BerryMark, Arrow } from './SiteIcons';
const Wiki = lazy(() => import('./Wiki'));
const Landing = lazy(() => import('./Landing'));

export default function Site({ route }: { route: { kind: string; slug?: string } }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const menuToggle = useRef<HTMLButtonElement>(null);
  const isWiki = route.kind === 'wiki';
  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuToggle.current?.focus();
      }
    };
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !header.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOutside);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOutside);
    };
  }, [menuOpen]);
  useEffect(() => {
    if (!isWiki) document.title = route.kind === 'not-found' ? 'Page not found · BeriGame' : 'BeriGame · Little island. Giant adventures.';
  }, [isWiki, route.kind]);
  return <div className={`site-shell ${isWiki || route.kind === 'not-found' ? 'site-light' : ''}`}>
    <a className="site-skip" href="#main-content">Skip to content</a>
    <header ref={header} className="site-header">
      <a className="site-brand" href={homeUrl()} aria-label="BeriGame home"><BerryMark /><span>BeriGame</span><span className="site-beta">BETA</span></a>
      <button ref={menuToggle} type="button" className="site-menu-toggle" aria-expanded={menuOpen} aria-controls="site-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? 'Close' : 'Menu'} <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d={menuOpen ? 'm6 6 12 12M6 18 18 6' : 'M4 7h16M4 12h16M4 17h16'} /></svg></button>
      <nav id="site-navigation" className={menuOpen ? 'is-open' : ''} aria-label="Main navigation">
        <a href={homeUrl('#explore')} onClick={() => setMenuOpen(false)}>The island</a>
        <a href={wikiUrl('getting-started')}>How to play</a>
        <a href={wikiUrl()} aria-current={isWiki ? 'page' : undefined}>Wiki & docs</a>
        <a className="site-button site-button-small" href={gameUrl()}>Play in browser <Arrow diagonal /></a>
      </nav>
    </header>
    {route.kind === 'landing' ? <Suspense fallback={<div className="site-loading" role="status">Opening the island…</div>}><Landing /></Suspense> : isWiki ? <div id="main-content" tabIndex={-1}><Suspense fallback={<div className="site-loading" role="status">Opening the field guide…</div>}><Wiki slug={route.slug} /></Suspense></div> : <main id="main-content" className="site-not-found"><span className="site-kicker">A path less travelled</span><h1>This page wandered off.</h1><p>Find your way back to the island, or look something up in the wiki.</p><a className="site-button" href={homeUrl()}>Back to the island <Arrow /></a><a href={wikiUrl()}>Browse the wiki</a></main>}
    <footer className="site-footer"><a href={homeUrl()} className="site-brand"><BerryMark /><span>BeriGame</span></a><p>Little island. Giant adventures.</p><nav aria-label="Footer"><a href={wikiUrl()}>Player wiki</a><a href={wikiUrl('changelog')}>Changelog</a><a href={agentUrl()}>Agent guide</a><a href={gameUrl()}>Enter the island <Arrow diagonal /></a></nav><span className="site-footer-note">An evolving world, built for a little curiosity.</span></footer>
  </div>;
}
