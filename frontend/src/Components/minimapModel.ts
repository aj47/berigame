import { MATERIALS } from "../../../shared/sim/frontier/catalog";
import { homePoint, isHomeRegion } from "../../../shared/sim/frontier/homeMap";
import { drawHomeMap, legacyMapProjection, type HomeMapView } from "../frontier/homeMapArt";
import {
  terrainField, trailDistance, isBridge, areaOf, LANDMARKS, SCENERY_BLOCKERS,
  GiantState,
  formatCountdown,
  raidStatus,
  type RaidRowLike,
  GARDEN_CENTER,
  GRID_SIZE,
  NodeKind,
  PlayerState,
  SAFE_RADIUS,
  SPAWN_TILE,
  facingToYaw,
  getItemDef,
  type Facing,
} from "@sim";

/** Everything the minimap draws, in tile coordinates (x right, z down: north up). */
export interface MinimapModel {
  home?: { claims: { id: string; mine: boolean }[] };
  me: { x: number; z: number; yaw: number } | null;
  others: { x: number; z: number; hostile: boolean }[];
  resources?: { x: number; z: number; item: string; color: string; ready: boolean }[];
  nodes: { x: number; z: number; kind: number; color: string; ripe: boolean }[];
  bags: { x: number; z: number }[];
  /** The Boulders' Giant (null until seeded). */
  giant: { x: number; z: number; down: boolean; asleep?: boolean; label?: string } | null;
  /** Your garden terrace; `ripe` plots ready to harvest (a gold ring when > 0). */
  garden?: { x: number; z: number; ripe: number };
}

interface Row { x: number; z: number }
interface PlayerRow extends Row { region?: string; identity: { toHexString(): string }; facing: number; state: number; online: boolean; hostile: boolean }
interface TreeRow extends Row { itemId: string; kind: number; cooldownUntilTick: number }
interface GroundRow extends Row { droppedBy: { toHexString(): string }; droppedOnDeath: boolean }

const KIND_COLOR: Record<number, string> = {
  [NodeKind.Driftwood]: "#b08a5c",
  [NodeKind.TideRock]: "#7c8794",
  [NodeKind.Obsidian]: "#3b2f55",
};

export function minimapModel(input: {
  meHex: string | null;
  home?: MinimapModel["home"];
  players: readonly PlayerRow[];
  trees: readonly TreeRow[];
  resources?: readonly { region: string; x: number; z: number; item: string; regrowsAt?: number }[];
  groundItems: readonly GroundRow[];
  tick: number;
  giants?: readonly { x: number; z: number; state: number }[];
  /** The raid schedule and the wall clock, for the countdown under the Giant. */
  raid?: RaidRowLike | null;
  nowMs?: number;
  gardenRipe?: number;
}): MinimapModel {
  const { meHex, tick } = input;
  let me: MinimapModel["me"] = null;
  const others: MinimapModel["others"] = [];
  for (const p of input.players) {
    if (!isHomeRegion(p.region || "bramblewild")) continue;
    const point = input.home ? homePoint(p, p.region || "bramblewild") : p;
    const hex = p.identity.toHexString();
    if (hex === meHex) me = { x: point.x, z: point.z, yaw: facingToYaw(p.facing as Facing) };
    else if (p.online && p.state !== PlayerState.Dead) others.push({ x: point.x, z: point.z, hostile: p.hostile });
  }
  const nodes = input.trees.map((t) => ({
    x: t.x,
    z: t.z,
    kind: t.kind ?? NodeKind.Berry,
    color: KIND_COLOR[t.kind] ?? getItemDef(t.itemId)?.color ?? "#4F46E5",
    ripe: t.cooldownUntilTick <= tick,
  }));
  // Your dropped bag: every item you dropped on death, one marker per tile.
  const seen = new Set<string>();
  const bags: MinimapModel["bags"] = [];
  for (const g of input.groundItems) {
    if (!meHex || !g.droppedOnDeath || g.droppedBy.toHexString() !== meHex) continue;
    const k = `${g.x},${g.z}`;
    if (seen.has(k)) continue;
    seen.add(k);
    bags.push({ x: g.x, z: g.z });
  }
  const g = input.giants?.[0];
  const asleep = !!g && g.state === GiantState.Asleep;
  const status = input.raid ? raidStatus(input.raid, input.nowMs ?? Date.now()) : null;
  const label = !status ? undefined : status.awake ? "RAID" : formatCountdown(status.targetMs, input.nowMs ?? Date.now());
  const giant = g ? { x: g.x, z: g.z, down: g.state === GiantState.Defeated || asleep, asleep, label } : null;
  const resources = input.resources?.filter(n => isHomeRegion(n.region)).map(n => ({
    ...homePoint(n, n.region), item: n.item, color: MATERIALS[n.item]?.color ?? getItemDef(n.item)?.color ?? '#7c8794',
    ready: !n.regrowsAt || n.regrowsAt <= (input.nowMs ?? Date.now()),
  }));
  return { home: input.home, me, others, nodes, resources, bags, giant, garden: { x: GARDEN_CENTER.x - 0.5, z: GARDEN_CENTER.z - 0.5, ripe: input.gardenRipe ?? 0 } };
}

const mapTiles = Array.from({length:GRID_SIZE*GRID_SIZE},(_,k)=>{
  const x=k%GRID_SIZE,z=Math.floor(k/GRID_SIZE),t={x,z},a=areaOf(t),d=terrainField(x,z);
  if(a==='sea')return d> -1.3?'#7ac7c4':null;
  if(isBridge(t))return '#b89562';
  if(a==='hedge')return '#344f2d';
  if(a==='boulder-line')return '#625c54';
  if(a==='boulders')return d<1.3?'#b2a58b':'#858876';
  if(d<1.8)return '#ead09a';
  if(trailDistance(x,z)<1)return '#cbb581';
  return a==='grove'?'#75a354':'#94ac65';
});

/** Paint the map into a square canvas `size` CSS pixels wide (the context is already DPR-scaled). */
export function drawMinimap(ctx: CanvasRenderingContext2D, m: MinimapModel, size: number, view: HomeMapView = 'overview'): void {
  if (m.home) { drawHomeMap(ctx, m, size, view); return; }
  const { scale: s, center: px } = legacyMapProjection(size);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#3f9fb1';
  ctx.fillRect(0,0,size,size);
  for(let z=0;z<GRID_SIZE;z++)for(let x=0;x<GRID_SIZE;x++){
    const color = mapTiles[z*GRID_SIZE+x];
    if(!color)continue;
    ctx.fillStyle=color;ctx.fillRect(x*s,z*s,s+.25,s+.25);
  }
  ctx.fillStyle='#315b3c';
  for(const t of SCENERY_BLOCKERS)ctx.fillRect(t.x*s,t.z*s,s,s);
  ctx.fillStyle='#ecd9a0';
  ctx.fillRect((SPAWN_TILE.x-SAFE_RADIUS)*s,(SPAWN_TILE.z-SAFE_RADIUS)*s,(SAFE_RADIUS*2+1)*s,(SAFE_RADIUS*2+1)*s);
  if(size>=240){
    ctx.font='bold 9px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
    LANDMARKS.forEach((t,i)=>{ctx.fillStyle='#fff5dc';ctx.beginPath();ctx.arc(px(t.x),px(t.z),6,0,Math.PI*2);ctx.fill();ctx.fillStyle='#364936';ctx.fillText(String(i+1),px(t.x),px(t.z));});
  }
  // Gathering nodes: berry trees are round, coast nodes square.
  const r = Math.max(2, s * 0.9);
  for (const n of m.nodes) {
    ctx.globalAlpha = n.ripe ? 1 : 0.4;
    ctx.fillStyle = n.color;
    if (n.kind === NodeKind.Berry) {
      ctx.beginPath();
      ctx.arc(px(n.x), px(n.z), r, 0, Math.PI * 2);
      ctx.fill();
    } else ctx.fillRect(px(n.x) - r, px(n.z) - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;
  // The Giant: a big dark diamond on its footprint (dimmed while it rests).
  if (m.giant) {
    const x = px(m.giant.x), y = px(m.giant.z), k = Math.max(4, s * 2);
    ctx.globalAlpha = m.giant.down ? 0.45 : 1;
    ctx.fillStyle = "#b8412f";
    ctx.strokeStyle = "#2b211a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - k); ctx.lineTo(x + k, y); ctx.lineTo(x, y + k); ctx.lineTo(x - k, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Countdown to the next wake (or RAID while it is up), above the marker.
    if (m.giant.label) {
      const font = Math.min(12, Math.max(8, Math.round(size / 13)));
      ctx.font = `700 ${font}px system-ui, sans-serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(20,16,12,0.85)";
      ctx.fillStyle = m.giant.asleep ? "#e9e3ff" : "#ffcf7a";
      const text = m.giant.asleep ? `z ${m.giant.label}` : m.giant.label;
      const tx = Math.min(size - 2, x + k), ty = Math.max(font + 1, y - k - 1);
      ctx.strokeText(text, tx, ty);
      ctx.fillText(text, tx, ty);
    }
  }
  // Your garden: a small soil square, ringed in gold when something is ripe.
  if (m.garden) {
    const x = px(m.garden.x), y = px(m.garden.z), k = Math.max(2.5, s);
    ctx.fillStyle = "#7a4f2c";
    ctx.fillRect(x - k, y - k, k * 2, k * 2);
    if (m.garden.ripe > 0) {
      ctx.strokeStyle = "#f5c542";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, k * 2.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // Your dropped bag: a red cross in a white ring.
  for (const b of m.bags) {
    const x = px(b.x), y = px(b.z), k = Math.max(3, s * 1.2);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x, y, k + 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#c0392b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - k * 0.7, y - k * 0.7); ctx.lineTo(x + k * 0.7, y + k * 0.7);
    ctx.moveTo(x + k * 0.7, y - k * 0.7); ctx.lineTo(x - k * 0.7, y + k * 0.7);
    ctx.stroke();
  }
  for (const o of m.others) {
    ctx.fillStyle = o.hostile ? "#e0573f" : "#ffffff";
    ctx.strokeStyle = "#1c1a16";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px(o.x), px(o.z), Math.max(2.5, s * 0.8), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  if (m.me) {
    // Facing arrow: yaw rotates +z (down on the map) toward +x.
    const x = px(m.me.x), y = px(m.me.z), k = Math.max(5, s * 2);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-m.me.yaw);
    ctx.fillStyle = "#ffd54a";
    ctx.strokeStyle = "#2b211a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, k);
    ctx.lineTo(k * 0.7, -k * 0.6);
    ctx.lineTo(0, -k * 0.25);
    ctx.lineTo(-k * 0.7, -k * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/** Destination copy reflects both the carried keys and the district already reached. */
export function mapAccessLabel(access: 'grove' | 'coast' | 'boulders', keys: { stick: boolean; club: boolean }, currentArea: string): string {
  if (access === 'grove') return 'Walk here';
  const outsideGrove = ['coast', 'boulder-line', 'boulders', 'settlement'].includes(currentArea);
  if (access === 'coast') return keys.stick || outsideGrove ? 'Accessible · walk here' : 'Stick required';
  return (keys.stick || outsideGrove) && (keys.club || currentArea === 'boulders') ? 'Accessible · walk here' : !keys.stick && !outsideGrove ? 'Stick + stone club required' : 'Stone club required';
}
