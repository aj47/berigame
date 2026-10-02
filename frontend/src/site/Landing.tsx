import { wikiUrl, gameUrl } from './siteUrls';
import React, { lazy, Suspense, useState } from 'react';
import { Arrow, PlayIcon, LightIcon } from './SiteIcons';
import RegionExplorer from './RegionExplorer';
import IslandLife from './IslandLife';
import TrailerDialog from './TrailerDialog';
import './landingRefinement.css';
import { useHashAnchor } from './useHashAnchor';
const IslandScene = lazy(() => import('./IslandScene'));

export default function Landing() {
  useHashAnchor('landing');
  const [paused, setPaused] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const [sceneReady, setSceneReady] = useState(false);
  const [lighting, setLighting] = useState<'day' | 'dusk'>('day');
  const [trailerOpen, setTrailerOpen] = useState(false);
  return <main id="main-content" className="landing-refined">
    <section className={`landing-hero hero-${lighting}`} aria-labelledby="hero-title">
      <div className="hero-contours" aria-hidden="true" />
      <div className="hero-copy">
        <p className="site-kicker"><span className="live-dot" /> WELCOME TO BRAMBLEWILD</p>
        <h1 id="hero-title">Little island.<br /><em>Giant adventures.</em></h1>
        <p className="hero-description">A shared 3D adventure, right in your browser. Gather, craft, grow, and discover what’s waiting just beyond the brambles.</p>
        <div className="hero-actions"><a href={gameUrl()} className="site-button">Enter the island <Arrow /></a><button type="button" className="hero-watch" onClick={() => setTrailerOpen(true)}><span className="hero-watch-icon"><PlayIcon /></span><span>Watch the film<small>40 seconds on the island</small></span></button></div>
        <div className="hero-details"><span><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2.5" y="3" width="15" height="11" rx="2" stroke="currentColor"/><path d="M7 17h6M10 14v3" stroke="currentColor"/></svg> No download</span><span><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="7" cy="6" r="3" stroke="currentColor"/><path d="M1.5 17v-2a5.5 5.5 0 0 1 11 0v2M13 3a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3.5 5" stroke="currentColor"/></svg> A shared world</span><span>Made for curious people</span></div>
      </div>
      <div className="hero-world">
        <div className="hero-orbit orbit-one" aria-hidden="true" /><div className="hero-orbit orbit-two" aria-hidden="true" />
        <div className={`hero-canvas ${sceneReady ? 'scene-ready' : ''}`}>
          <img className="hero-fallback" src="/site/island.jpg" alt="A lush island with berry trees, a wooden bridge, and a little village" />
          <Suspense fallback={null}><IslandScene lighting={lighting} paused={paused || trailerOpen} onReady={() => setSceneReady(true)} onUnavailable={() => setSceneReady(false)} /></Suspense>
        </div>
        <div className="scene-lighting" role="group" aria-label="Island lighting"><button type="button" disabled={!sceneReady} aria-pressed={lighting === 'day'} onClick={() => setLighting('day')}><LightIcon />Daylight</button><button type="button" disabled={!sceneReady} aria-pressed={lighting === 'dusk'} onClick={() => setLighting('dusk')}><LightIcon moon />Blue hour</button></div>
        <div className="hero-north" aria-hidden="true">N<span>✧</span></div>
        <div className="hero-location"><span className="hero-location-symbol" aria-hidden="true">⌖</span><span><small>A LITTLE WORLD OF YOUR OWN</small><strong>Welcome to the Grove</strong></span><span className="location-line" aria-hidden="true" /></div>
        <div className="hero-scene-controls"><span>{sceneReady ? 'Drag to discover a different angle' : 'A glimpse of the island'}</span><button type="button" aria-label={paused ? 'Resume island animation' : 'Pause island animation'} aria-pressed={paused} onClick={() => setPaused(!paused)}><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">{paused ? <path d="m5 3 8 5-8 5V3Z" /> : <path d="M4 3h2v10H4zm6 0h2v10h-2z" />}</svg></button></div>
      </div>
      <a className="hero-scroll" href="#island"><span aria-hidden="true">↓</span> THERE’S MORE TO DISCOVER</a>
      <span className="hero-edition">GATHER <span>·</span> CRAFT <span>·</span> GROW <span>·</span> EXPLORE</span>
    </section>
    <IslandLife />
    <RegionExplorer />
    <section className="landing-story site-section" aria-labelledby="story-title">
      <div className="story-media"><button type="button" className="cinema-poster" onClick={() => setTrailerOpen(true)} aria-label="Watch the BeriGame cinematic trailer"><img src="/site/adventure.jpg" alt="Adventurers carry a giant berry over a wooden bridge with Pip at their feet" loading="lazy" /><span className="cinema-film-label">A BERIGAME STORY</span><span className="cinema-play"><PlayIcon /></span><span className="cinema-bottom"><strong>Better with company.</strong><span>WATCH THE FILM <span>00:40</span></span></span></button><span className="story-caption">A CINEMATIC GLIMPSE OF ISLAND LIFE <span>BEST SHARED WITH FRIENDS</span></span></div>
      <div className="story-copy"><p className="site-kicker">ONE GIANT BERRY. MANY POSSIBILITIES.</p><h2 id="story-title">A little teamwork.<br /><em>A very big berry.</em></h2><p>Start an expedition at camp. Grow a berry that’s far too big for your bag. Roll it to market, recruit Moss to carry it, or bring everyone together for a woodland feast.</p><p>Just keep an eye on Pip. You’re not the only one who’s hungry.</p><a className="site-text-link" href={wikiUrl('expeditions')}>Plan your first expedition <Arrow /></a></div>
    </section>
    <section className="landing-wiki site-section" aria-labelledby="wiki-callout-title"><div className="wiki-callout-mark" aria-hidden="true"><span>✧</span><svg viewBox="0 0 80 70" fill="none"><path d="M40 18C30 8 14 9 5 12v42c12-3 23-2 35 8m0-44c10-10 26-9 35-6v42c-12-3-23-2-35 8V18Z" stroke="currentColor" strokeWidth="2"/><path d="M14 24c6-1 12 0 18 3m-18 9c6-1 12 0 18 3m16-12c6-3 12-4 18-3m-18 15c6-3 12-4 18-3" stroke="currentColor" strokeWidth="2"/></svg></div><div><p className="site-kicker">THE BERIGAME WIKI</p><h2 id="wiki-callout-title">Every adventure starts<br />with a little know-how.</h2><p>From your very first harvest to the finer points of a Giant raid.<br className="desktop-break" /> Items, recipes, strategies, and all the details in between.</p><a href={wikiUrl()} className="site-button">Open the field guide <Arrow /></a></div><div className="wiki-quick-links"><a href={wikiUrl('getting-started')}><span>01</span>Your first day<Arrow diagonal /></a><a href={wikiUrl('inventory-items')}><span>02</span>Items & equipment<Arrow diagonal /></a><a href={wikiUrl('skills-progression')}><span>03</span>Skills & progression<Arrow diagonal /></a><a href={wikiUrl('combat')}><span>04</span>Combat & survival<Arrow diagonal /></a></div></section>
    <section className="landing-invitation" aria-labelledby="invitation-title"><div><span className="site-kicker">YOUR STORY STARTS SMALL</span><h2 id="invitation-title">Your first berry is waiting.</h2></div><a href={gameUrl()} className="site-button">Let’s see what’s out there <Arrow /></a></section>
    <TrailerDialog open={trailerOpen} onClose={() => setTrailerOpen(false)} />
  </main>;
}
