import React, { useEffect, useRef, useState } from 'react';
import { PlayerState, inSpireFloor } from '@sim';
import { useSpacetimeDB } from 'spacetimedb/react';
import { drawHomeMap, homeMapProjection } from '../frontier/homeMapArt';
import { homePoint, isHomeRegion } from '../../../shared/sim/frontier/homeMap';
import { playerView } from '../spacetime/playerView';
import type { MinimapModel } from '../Components/minimapModel';

const EMPTY_MODEL: MinimapModel = { home: { claims: [] }, me: null, others: [], nodes: [], bags: [], giant: null };
const PAINT_MS = 150;

const placeOf = (p: any): string => (inSpireFloor(p) && (p.region || 'bramblewild') === 'bramblewild' ? 'In the Spire'
  : isHomeRegion(p.region || 'bramblewild') ? '' : String(p.region).replace(/^./, (c) => c.toUpperCase()));

/** One marker: a name over a dot, red while fighting, a cross when down. */
function paintPlayer(ctx: CanvasRenderingContext2D, p: any, x: number, y: number) {
  const dead = p.state === PlayerState.Dead, fighting = p.hostile && !!p.combatTarget;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(20,16,12,.9)';
  if (dead) {
    ctx.beginPath(); ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7); ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#ff8a7a'; ctx.stroke();
  } else {
    ctx.fillStyle = fighting ? '#ff5a45' : '#ffe08a';
    ctx.beginPath(); ctx.arc(x, y, fighting ? 9 : 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.font = '700 17px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.lineWidth = 4;
  ctx.strokeText(p.name, x, y - 11);
  ctx.fillStyle = '#fff7e6';
  ctx.fillText(p.name, x, y - 11);
}

/** The wide shot: the joined map with every online character on it, and the whole cast at the side. */
export default function OverviewMap() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { getConnection } = useSpacetimeDB();
  const [cast, setCast] = useState<any[]>([]);
  useEffect(() => {
    const paint = () => {
      const el = canvas.current, ctx = el?.getContext('2d'), conn = getConnection() as any;
      if (!el || !ctx || !conn?.db?.player) return;
      const size = el.clientHeight;
      if (el.width !== size) el.width = el.height = size;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawHomeMap(ctx, EMPTY_MODEL, size, 'overview');
      const { x, z } = homeMapProjection(size, 'overview');
      const online = [...playerView(conn).iter()].filter((p: any) => p.online);
      for (const p of online) {
        if (!isHomeRegion(p.region || 'bramblewild') || inSpireFloor(p)) continue;
        const at = homePoint(p, p.region || 'bramblewild');
        paintPlayer(ctx, p, x(at.x), z(at.z));
      }
      setCast(online.sort((a: any, b: any) => a.name.localeCompare(b.name)).map((p: any) => ({
        hex: p.identity.toHexString(), name: p.name, hp: p.hp, maxHp: p.maxHp, dead: p.state === PlayerState.Dead, place: placeOf(p),
      })));
    };
    paint();
    const timer = window.setInterval(paint, PAINT_MS);
    return () => window.clearInterval(timer);
  }, [getConnection]);
  return <div className="watch-overview">
    <canvas ref={canvas} className="watch-map" aria-label="Map of the whole world with every online player" />
    <ol className="watch-cast">
      {cast.map((p) => <li key={p.hex} data-dead={p.dead || undefined}>
        <span className="watch-cast-name">{p.name}</span>
        {p.place && <span className="watch-cast-place">{p.place}</span>}
        <span className="watch-cast-hp"><i style={{ width: `${Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100))}%` }} /></span>
      </li>)}
    </ol>
  </div>;
}
