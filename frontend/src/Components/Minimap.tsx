import React, { useEffect, useRef, useState } from "react";
import { useGroundItems, useMyIdentityHex, usePlayers, useTick, useTrees } from "../spacetime/hooks";
import { drawMinimap, minimapModel } from "./minimap";

/** Redraws per second: the map is a glance aid, not a per-frame view. */
export const MINIMAP_HZ = 4;

function useMapCanvas(size: number, source: React.MutableRefObject<() => ReturnType<typeof minimapModel>>) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext?.("2d");
    if (!el || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = Math.round(size * dpr);
    el.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const paint = () => drawMinimap(ctx, source.current(), size);
    paint();
    const timer = window.setInterval(paint, 1000 / MINIMAP_HZ);
    return () => window.clearInterval(timer);
  }, [size, source]);
  return canvas;
}

/**
 * Corner map of the island: the Grove, the bramble hedge, gathering nodes,
 * you (with facing), other adventurers and your dropped bag. Tap to expand.
 */
const Minimap = ({ hidden }: { hidden?: boolean }) => {
  const meHex = useMyIdentityHex();
  const players = usePlayers();
  const trees = useTrees();
  const groundItems = useGroundItems();
  const tick = useTick();
  const [expanded, setExpanded] = useState(false);
  const latest = useRef(() => minimapModel({ meHex, players, trees, groundItems, tick }));
  latest.current = () => minimapModel({ meHex, players, trees, groundItems, tick });
  const source = useRef(() => latest.current());
  const small = useMapCanvas(120, source);
  const big = useMapCanvas(expanded ? 300 : 0, source);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const hasBag = groundItems.some((g) => meHex && g.droppedOnDeath && g.droppedBy.toHexString() === meHex);
  return (
    <>
      <button
        className={`minimap ${hidden ? "minimap-hidden" : ""}`}
        aria-label={`Island map${hasBag ? ", your dropped bag is marked" : ""}. Tap to expand`}
        aria-expanded={expanded}
        onClick={() => setExpanded(true)}
      >
        <canvas ref={small} width={120} height={120} aria-hidden="true" />
        <span className="minimap-north" aria-hidden="true">N</span>
      </button>
      {expanded && (
        <div className="minimap-expanded" role="dialog" aria-label="Island map" onClick={() => setExpanded(false)}>
          <div className="minimap-card" onClick={(e) => e.stopPropagation()}>
            <header className="panel-heading">
              <h2>The island</h2>
              <button className="close-button" aria-label="Close map" onClick={() => setExpanded(false)} autoFocus>
                ×
              </button>
            </header>
            <div className="minimap-big-wrap">
              <canvas ref={big} width={300} height={300} aria-hidden="true" />
              <span className="minimap-north" aria-hidden="true">N</span>
            </div>
            <ul className="minimap-legend">
              <li><i className="lg-me" />You</li>
              <li><i className="lg-other" />Adventurers</li>
              <li><i className="lg-berry" />Berry trees</li>
              <li><i className="lg-coast" />Driftwood / tide rocks</li>
              <li><i className="lg-hedge" />Bramble hedge</li>
              <li><i className="lg-bag" />Your dropped bag</li>
            </ul>
          </div>
        </div>
      )}
    </>
  );
};
export default Minimap;
