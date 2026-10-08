import { useFrontier } from "../frontier/useFrontier";
import { MATERIALS, REGIONS } from "../../../shared/sim/frontier/catalog";
import { homePoint, isHomeRegion } from "../../../shared/sim/frontier/homeMap";
import { HOME_MAP_VIEWS, homeMapProjection, mapDestinationAt, type HomeMapView } from "../frontier/homeMapArt";
import { createPortal } from "react-dom";
import React, { useEffect, useRef, useState } from "react";
import { useGardenPlots, useGiantRaid, useGiants, useGroundItems, useInventoryRows, useMyCosmetics, useMyIdentityHex, usePlayers, useTick, useTrees } from "../spacetime/hooks";
import { areaOf, bossConfigOr, countRipe, getItemDef, journeySteps, LANDMARKS, ISLAND_NAME, GRID_SIZE, PlayerState } from "@sim";
import { useFirstDayStore } from "../spacetime/stores/firstDayStore";
import { useGameActions } from "../spacetime/actions";
import { useToastStore } from "../spacetime/stores/toastStore";
import { drawMinimap, landmarkJourneyNote, mapAccessLabel, minimapModel } from "./minimapModel";
import { useBossStore } from "../bosses/bossStore";
import "./minimap.css";

/** Redraws per second: the map is a glance aid, not a per-frame view. */
export const MINIMAP_HZ = 4;
function useMapCanvas(size: number, source: React.MutableRefObject<() => ReturnType<typeof minimapModel>>, view: HomeMapView = 'overview') {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext?.("2d");
    if (!el || !ctx || !size) return;
    const paint = () => {
      // Paint at the displayed size so district numbers stay legible on phones.
      const pixels = el.getBoundingClientRect().width || size, dpr = Math.min(2, window.devicePixelRatio || 1);
      const resolution = Math.round(pixels * dpr);
      if (el.width !== resolution || el.height !== resolution) {
        el.width = resolution; el.height = resolution;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawMinimap(ctx, source.current(), pixels, view);
    };
    paint();
    const timer = window.setInterval(paint, 1000 / MINIMAP_HZ);
    return () => window.clearInterval(timer);
  }, [size, source, view]);
  return canvas;
}

const Minimap = ({ hidden }: { hidden?: boolean }) => {
  const { setTarget, frontier } = useGameActions();
  const settlements = useFrontier(), meHex = useMyIdentityHex(), players = usePlayers();
  const trees = useTrees(), groundItems = useGroundItems(), tick = useTick(), inventory = useInventoryRows();
  const giants = useGiants(), raid = useGiantRaid(), gardenPlots = useGardenPlots();
  const me = players.find(p => p.identity.toHexString() === meHex);
  const keys = { stick: inventory.some(r => r.itemId === 'stick') || me?.weapon === 'stick', club: inventory.some(r => r.itemId === 'stone_club') || me?.weapon === 'stone_club' };
  const currentArea = me?.region === 'settlement' ? 'settlement' : me ? areaOf(me) : 'grove';
  const gardenRipe = countRipe(gardenPlots.map(r => ({ itemId: r.itemId, plantedAtMs: Number(r.plantedAtMicros / 1000n) })), Date.now());
  const home = settlements.enabled ? { claims: settlements.plots.filter(p => p.region === 'settlement' && p.claim).map(p => ({ id: p.id, mine: p.claim?.owner === meHex })) } : undefined;
  const [expanded, setExpanded] = useState(false), [view, setView] = useState<HomeMapView>('bramblewild');
  const [message, setMessage] = useState(''), [pending, setPending] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const busy = useRef(false), mapSession = useRef(0), pointerStart = useRef<{ x: number; y: number } | null>(null);
  const close = () => { mapSession.current++; setExpanded(false); };
  const clatter = useBossStore(s => s.clatter), spireRuns = useBossStore(s => s.runs), bossConfig = useBossStore(s => s.config);
  const goal = useFirstDayStore(s => s.goal), lastChapter = useFirstDayStore(s => s.chapter), cosmetics = useMyCosmetics();
  const bosses = bossConfigOr(bossConfig);
  const journey = journeySteps({ goalId: goal?.id, fallback: lastChapter, cosmetics: cosmetics?.unlocked ?? 0, bosses });
  const chapter = journey.find(c => c.status === 'current');
  // The marker follows the chip's goal; for an in-place step (make, eat, wield) it rests on the chapter's landmark.
  const target = goal?.target ? { ...goal.target, label: chapter ? chapter.title : 'Next' } : chapter && goal ? { ...chapter.place, label: chapter.title } : null;
  const sealed = { glade: !bosses.clatterhornOpen, spire: !bosses.spireOpen };
  const model = () => minimapModel({ home, meHex, players, trees, groundItems, tick, giants, raid, gardenRipe, resources: settlements.resources, nowMs: Date.now(), clatter, spireRuns: spireRuns.values(), target });
  const latest = useRef(model);
  latest.current = model;
  const small = useMapCanvas(120, latest), big = useMapCanvas(expanded ? 480 : 0, latest, view);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const walk = async (region: 'bramblewild' | 'settlement', x: number, z: number) => {
    if (busy.current) return;
    if (!me?.online || me.state !== PlayerState.Alive) { setMessage('Wait until you are back on the island to walk.'); return; }
    const source = me.region || 'bramblewild';
    if (!isHomeRegion(source)) { setMessage('Return to the home island to walk using this map.'); return; }
    if (!home && (source !== 'bramblewild' || region !== 'bramblewild')) { setMessage('The Meadows are currently unavailable.'); return; }
    busy.current = true; setPending(true); setMessage('');
    const session = mapSession.current;
    try {
      const ok = source === 'bramblewild' && region === 'bramblewild'
        ? await setTarget(x, z) : await frontier({ action: 'walk', id: region, x, z });
      if (session !== mapSession.current) return;
      if (ok !== false) close();
      else setMessage(useToastStore.getState().message || 'Cannot reach that spot. Choose another location.');
    } catch (error) {
      if (session === mapSession.current) setMessage(error instanceof Error ? error.message : 'Cannot reach that spot. Choose another location.');
    } finally { busy.current = false; setPending(false); }
  };
  const choosePoint = (x: number, y: number, size: number) => {
    const destination = mapDestinationAt(x, y, size, view, !!home);
    if (!destination) { setMessage('Choose a spot on dry land.'); return; }
    void walk(destination.region as 'bramblewild' | 'settlement', destination.x, destination.z);
  };
  const initialCursor = () => {
    const at = me && isHomeRegion(me.region || 'bramblewild') ? homePoint(me, me.region || 'bramblewild') : null;
    const projection = homeMapProjection(1, view);
    const x = at ? home ? projection.x(at.x) : (at.x + .5) / GRID_SIZE : .5;
    const y = at ? home ? projection.z(at.z) : (at.z + .5) / GRID_SIZE : .5;
    return x >= 0 && x < 1 && y >= 0 && y < 1 ? { x, y } : { x: .5, y: .5 };
  };
  const hasBag = groundItems.some(g => meHex && g.droppedOnDeath && g.droppedBy.toHexString() === meHex);
  const resources = settlements.resources.filter(n => n.region === 'settlement');
  const resourceKinds = [...new Set(resources.map(n => n.item))];
  const nearestResource = (item: string) => {
    const here = me ? homePoint(me, me.region || 'bramblewild') : homePoint(REGIONS.settlement.spawn, 'settlement');
    const nodes = resources.filter(n => n.item === item);
    const now = Date.now();
    const unavailable = (node: typeof nodes[number]) => !!node.harvest || !!node.regrowsAt && node.regrowsAt > now;
    return nodes.sort((a, b) => Number(unavailable(a)) - Number(unavailable(b)) || Math.hypot(homePoint(a, 'settlement').x - here.x, homePoint(a, 'settlement').z - here.z) - Math.hypot(homePoint(b, 'settlement').x - here.x, homePoint(b, 'settlement').z - here.z))[0];
  };
  const title = view === 'overview' ? 'Connected island' : view === 'settlement' ? 'The Meadows' : ISLAND_NAME;
  return <>
    <button className={`minimap ${hidden ? 'minimap-hidden' : ''}`} aria-label={`Island map${hasBag ? ', your dropped bag is marked' : ''}. Tap to expand`} aria-expanded={expanded} onClick={() => { mapSession.current++; setMessage(''); setCursor(null); setView(home && me?.region === 'settlement' ? 'settlement' : 'bramblewild'); setExpanded(true); }}>
      <canvas ref={small} width={120} height={120} aria-hidden="true" />
      <span className="minimap-north" aria-hidden="true">N</span>
      <span className="minimap-compact-label" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16M15 5v16" /></svg>Map</span>
    </button>
    {expanded && createPortal(<div className="minimap-expanded" role="dialog" aria-modal="true" aria-label="Island map" onClick={close}>
      <div className="minimap-card minimap-district-card" onClick={e => e.stopPropagation()}>
        <header className="panel-heading"><h2>{title}</h2><button className="close-button" aria-label="Close map" onClick={close} autoFocus>×</button></header>
        {home && <nav className="map-districts" aria-label="Map view">{([['overview', 'Whole island'], ['bramblewild', 'Bramblewild'], ['settlement', 'Meadows']] as const).map(([id, name]) => <button key={id} aria-pressed={view === id} onClick={() => { setView(id); setCursor(null); setMessage(''); }}>{name}</button>)}</nav>}
        <div className="map-layout">
          <div className="map-visual">
            <div className="minimap-big-wrap"><canvas ref={big} width={480} height={480} role="button" tabIndex={0} aria-label="Choose a walking destination on the map" aria-describedby="map-walk-help" aria-disabled={pending}
              onPointerDown={e => { pointerStart.current = { x: e.clientX, y: e.clientY }; }}
              onClick={e => {
                if (e.button !== 0 || busy.current) return;
                const start = pointerStart.current; pointerStart.current = null;
                if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) return;
                setCursor(null);
                const rect = e.currentTarget.getBoundingClientRect();
                choosePoint(e.clientX - rect.left, e.clientY - rect.top, rect.width);
              }}
              onFocus={() => setCursor(current => current ?? initialCursor())}
              onKeyDown={e => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(e.key)) return;
                e.preventDefault();
                const at = cursor ?? initialCursor();
                if (e.key === 'Enter' || e.key === ' ') { const size = e.currentTarget.getBoundingClientRect().width; choosePoint(at.x * size, at.y * size, size); return; }
                const step = (e.shiftKey ? 5 : 1) / (home ? HOME_MAP_VIEWS[view].span : GRID_SIZE);
                setCursor({ x: Math.max(0, Math.min(.999, at.x + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0))), y: Math.max(0, Math.min(.999, at.y + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0))) });
              }} />
              {cursor && <span className="map-walk-cursor" aria-hidden="true" style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }} />}
              <span className="minimap-north" aria-hidden="true">N</span></div>
            <p className="map-caption" id="map-walk-help">Click or tap a spot on land to walk there.<span className="map-keyboard-help"> Use arrow keys to choose a spot, then Enter to walk.</span></p>
            {(message || pending) && <p className="map-walk-status" role="status">{message || 'Finding a route…'}</p>}
            <div className="map-key"><span><i className="map-key-you" />You</span><span><i className="map-key-player" />Players</span>{view !== 'bramblewild' && <span><i className="map-key-land" />Your land</span>}</div>
          </div>
          <div className="map-destinations">
            {view !== 'settlement' && <section className="map-journey" aria-label="Your journey">
              <h3>Your journey</h3>
              {goal && <p className="map-journey-now"><strong>Now:</strong> {goal.text}</p>}
              <ol>
                {journey.map((c, i) => <li key={c.id} data-status={c.status}>
                  <button title={c.task} aria-current={c.status === 'current' ? 'step' : undefined} onClick={() => walk('bramblewild', c.place.x, c.place.z)}>
                    <span className="map-journey-mark" aria-hidden="true">{c.status === 'done' ? '✓' : i + 1}</span>
                    <span>{c.title}<small>{c.status === 'current' ? c.task : c.status === 'done' ? (c.earned ? 'Done · keepsake earned' : 'Done') : `Needs ${c.needs.charAt(0).toLowerCase()}${c.needs.slice(1)}`}{c.sealed ? ' · not open yet' : ''}</small></span>
                  </button>
                </li>)}
              </ol>
            </section>}
            <h3>Walk to a place</h3>
            <div className="map-places" aria-label="Places to explore">
              {view !== 'settlement' && LANDMARKS.map((place, i) => <button key={place.id} title={place.detail} onClick={() => walk('bramblewild', place.x, place.z)}><span className="map-place-number">{i + 1}</span><span>{place.short}<small>{[landmarkJourneyNote(place.id, sealed), mapAccessLabel(place.access, keys, currentArea)].filter(Boolean).join(' · ')}</small></span></button>)}
              {home && view !== 'bramblewild' && <button onClick={() => walk('settlement', REGIONS.settlement.spawn.x, REGIONS.settlement.spawn.z)}><span className="map-place-number">⌂</span><span>Meadows town<small>{mapAccessLabel('coast', keys, currentArea)}</small></span></button>}
              {home && view !== 'bramblewild' && settlements.plots.filter(p => p.region === 'settlement' && p.claim?.owner === meHex).map(p => <button key={p.id} onClick={() => walk('settlement', p.marker.x, p.marker.z)}><span className="map-place-number">⚑</span><span>Your homestead<small>Plot {p.id.split('-').pop()}</small></span></button>)}
            </div>
            {home && view === 'settlement' && <section className="map-resources"><h3>Gather nearby</h3><div className="map-places">{resourceKinds.map(item => <button key={item} onClick={() => { const n = nearestResource(item); if (n) walk('settlement', n.x - 1, n.z); }}><span className="map-resource-swatch" style={{ background: MATERIALS[item]?.color ?? getItemDef(item)?.color }} aria-hidden="true">{item === 'timber' ? '♠' : ''}</span><span>{MATERIALS[item]?.name ?? getItemDef(item)?.name ?? item}<small>Walk to nearest {item === 'timber' ? 'tree' : 'spot'}</small></span></button>)}</div></section>}
            <details className="map-more-key"><summary>More map symbols</summary><ul className="minimap-legend"><li><i className="lg-berry" />Berry trees</li><li><i className="lg-coast" />Gathering spots</li><li><i className="lg-boulders" />The Giant</li><li><i className="lg-bag" />Dropped bag</li><li><i className="lg-garden" />Garden · gold when ripe</li><li><i style={{ background: "#2e7d6f", borderRadius: "50%" }} />Clatterhorn</li><li><i style={{ background: "#3b2f55", borderRadius: "40% 40% 0 0" }} />Spire Gate · parties inside</li><li><i style={{ background: "transparent", border: "2px solid #e0b52f", borderRadius: "50%" }} />Your next goal</li></ul></details>
          </div>
        </div>
      </div>
    </div>, document.body)}
  </>;
};
export default Minimap;
