import { useFrontier } from "../frontier/useFrontier";
import { MATERIALS, REGIONS } from "../../../shared/sim/frontier/catalog";
import { homePoint } from "../../../shared/sim/frontier/homeMap";
import { type HomeMapView } from "../frontier/homeMapArt";
import { createPortal } from "react-dom";
import React, { useEffect, useRef, useState } from "react";
import { useGardenPlots, useGiantRaid, useGiants, useGroundItems, useInventoryRows, useMyIdentityHex, usePlayers, useTick, useTrees } from "../spacetime/hooks";
import { areaOf, countRipe, getItemDef, LANDMARKS, ISLAND_NAME } from "@sim";
import { useGameActions } from "../spacetime/actions";
import { drawMinimap, mapAccessLabel, minimapModel } from "./minimapModel";
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
      const pixels = el.clientWidth || size, dpr = Math.min(2, window.devicePixelRatio || 1);
      const resolution = Math.round(pixels * dpr);
      if (el.width !== resolution || el.height !== resolution) {
        el.width = resolution; el.height = resolution;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
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
  const latest = useRef(() => minimapModel({ home, meHex, players, trees, groundItems, tick, giants, raid, gardenRipe, resources: settlements.resources, nowMs: Date.now() }));
  latest.current = () => minimapModel({ home, meHex, players, trees, groundItems, tick, giants, raid, gardenRipe, resources: settlements.resources, nowMs: Date.now() });
  const small = useMapCanvas(120, latest), big = useMapCanvas(expanded ? 480 : 0, latest, view);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const walk = (region: 'bramblewild' | 'settlement', x: number, z: number) => {
    if (region === 'bramblewild' && me?.region !== 'settlement') void setTarget(x, z);
    else void frontier({ action: 'walk', id: region, x, z });
    setExpanded(false);
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
    <button className={`minimap ${hidden ? 'minimap-hidden' : ''}`} aria-label={`Island map${hasBag ? ', your dropped bag is marked' : ''}. Tap to expand`} aria-expanded={expanded} onClick={() => { setView(home && me?.region === 'settlement' ? 'settlement' : 'bramblewild'); setExpanded(true); }}>
      <canvas ref={small} width={120} height={120} aria-hidden="true" />
      <span className="minimap-north" aria-hidden="true">N</span>
      <span className="minimap-compact-label" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16M15 5v16" /></svg>Map</span>
    </button>
    {expanded && createPortal(<div className="minimap-expanded" role="dialog" aria-modal="true" aria-label="Island map" onClick={() => setExpanded(false)}>
      <div className="minimap-card minimap-district-card" onClick={e => e.stopPropagation()}>
        <header className="panel-heading"><h2>{title}</h2><button className="close-button" aria-label="Close map" onClick={() => setExpanded(false)} autoFocus>×</button></header>
        {home && <nav className="map-districts" aria-label="Map view">{([['overview', 'Whole island'], ['bramblewild', 'Bramblewild'], ['settlement', 'Meadows']] as const).map(([id, name]) => <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>{name}</button>)}</nav>}
        <div className="map-layout">
          <div className="map-visual">
            <div className="minimap-big-wrap"><canvas ref={big} width={480} height={480} aria-hidden="true" /><span className="minimap-north" aria-hidden="true">N</span></div>
            <p className="map-caption">{view === 'overview' ? 'One island, joined by the harbour trail. Choose a district for a closer view.' : view === 'settlement' ? 'Follow the paths to town, gathering spots and your homestead.' : 'Numbers match the destinations. Choose a place to walk there.'}</p>
            <div className="map-key"><span><i className="map-key-you" />You</span><span><i className="map-key-player" />Players</span>{view !== 'bramblewild' && <span><i className="map-key-land" />Your land</span>}</div>
          </div>
          <div className="map-destinations">
            <h3>Walk to a place</h3>
            <div className="map-places" aria-label="Places to explore">
              {view !== 'settlement' && LANDMARKS.map((place, i) => <button key={place.id} title={place.detail} onClick={() => walk('bramblewild', place.x, place.z)}><span className="map-place-number">{i + 1}</span><span>{place.short}<small>{mapAccessLabel(place.access, keys, currentArea)}</small></span></button>)}
              {home && view !== 'bramblewild' && <button onClick={() => walk('settlement', REGIONS.settlement.spawn.x, REGIONS.settlement.spawn.z)}><span className="map-place-number">⌂</span><span>Meadows town<small>{mapAccessLabel('coast', keys, currentArea)}</small></span></button>}
              {home && view !== 'bramblewild' && settlements.plots.filter(p => p.region === 'settlement' && p.claim?.owner === meHex).map(p => <button key={p.id} onClick={() => walk('settlement', p.marker.x, p.marker.z)}><span className="map-place-number">⚑</span><span>Your homestead<small>Plot {p.id.split('-').pop()}</small></span></button>)}
            </div>
            {home && view === 'settlement' && <section className="map-resources"><h3>Gather nearby</h3><div className="map-places">{resourceKinds.map(item => <button key={item} onClick={() => { const n = nearestResource(item); if (n) walk('settlement', n.x - 1, n.z); }}><span className="map-resource-swatch" style={{ background: MATERIALS[item]?.color ?? getItemDef(item)?.color }} aria-hidden="true">{item === 'timber' ? '♠' : ''}</span><span>{MATERIALS[item]?.name ?? getItemDef(item)?.name ?? item}<small>Walk to nearest {item === 'timber' ? 'tree' : 'spot'}</small></span></button>)}</div></section>}
            <details className="map-more-key"><summary>More map symbols</summary><ul className="minimap-legend"><li><i className="lg-berry" />Berry trees</li><li><i className="lg-coast" />Gathering spots</li><li><i className="lg-boulders" />The Giant</li><li><i className="lg-bag" />Dropped bag</li><li><i className="lg-garden" />Garden · gold when ripe</li></ul></details>
          </div>
        </div>
      </div>
    </div>, document.body)}
  </>;
};
export default Minimap;
