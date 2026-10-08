import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { DoubleSide, MeshBasicMaterial, PlaneGeometry, RingGeometry, ConeGeometry, type Group } from 'three';
import {
  CLATTER_CHARGE_WINDUP, CLATTER_DIR8, CLATTER_DRUM_WINDUP, CLATTER_GLADE, CLATTER_SPIN_WINDUP, ClatterEndKind, ClatterState, GRID_SIZE,
  bulletDangerKeys, clatterSpinTiles, clatterSwarmBullets, clatterSwarmFreeLines, clatterTelegraph, tileToWorld,
} from '@sim';
import { locateAvatar } from '../../animation/avatarRegistry';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';
import { tickClock } from '../../spacetime/tickClock';
import { useBossStore, type ClatterhornRow } from '../bossStore';
import DangerTiles from '../DangerTiles';
import { clatterBaitHex } from './clatterPlayers';

export interface ClatterTelegraphProps {
  row: ClatterhornRow;
  /** The world tick the row belongs to. */
  tick: number;
}

/** Colours shared with the Giant's marks (danger), the spin's safe eye and the swarm's free lines. */
export const TELEGRAPH_COLORS = {
  danger: '#d7342a', drum: '#e8a33c', safe: '#5fd38a', runnerNext: '#ff4a2e', runnerLater: '#f2a33a', free: '#7fe0a0',
} as const;

const G = CLATTER_GLADE;
const noRaycast = () => null;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const inGlade = (x: number, z: number) => x >= G.x0 && x <= G.x1 && z >= G.z0 && z <= G.z1;

/** Telegraph lead (ticks) of a windup row: the charge's by stored phase, else 3. */
export function telegraphLead(row: Pick<ClatterhornRow, 'state' | 'phase'>): number {
  if (row.state === ClatterState.ChargeWindup) return CLATTER_CHARGE_WINDUP[Math.min(3, Math.max(1, row.phase))];
  if (row.state === ClatterState.SpinWindup) return CLATTER_SPIN_WINDUP;
  if (row.state === ClatterState.DrumWindup) return CLATTER_DRUM_WINDUP;
  return 0;
}

/** The spin's safe eye: the 3 x 3 under the beetle, clipped to the glade. */
export function spinEyeTiles(centre: { x: number; z: number }): number[] {
  const out: number[] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const x = centre.x + dx, z = centre.z + dz;
    if (inGlade(x, z)) out.push(z * GRID_SIZE + x);
  }
  return out;
}

/** Glade tiles of the swarm's never-used columns (N/S: x values; E/W: z values). */
export function swarmFreeTiles(row: ClatterhornRow): number[] {
  const lines = clatterSwarmFreeLines(row);
  const out: number[] = [];
  const vertical = (row.swarmSide & 1) === 0;
  for (const v of lines) {
    if (vertical) for (let z = G.z0; z <= G.z1; z++) out.push(z * GRID_SIZE + v);
    else for (let x = G.x0; x <= G.x1; x++) out.push(v * GRID_SIZE + x);
  }
  return out;
}

/** Swarm fire tick of a row (the landing tick while winding up), 0 = no swarm. */
const swarmFire = (row: ClatterhornRow) =>
  row.state === ClatterState.DrumWindup ? row.stateUntilTick : row.state === ClatterState.Drumming ? row.swarmTick : 0;

// Shared meshes and materials (one beetle): module-level so frames never touch React props.
const plane = new PlaneGeometry(1, 1);
/** A plane whose back edge sits on the origin and that grows along +z. */
const lanePlane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
const ring = new RingGeometry(0.72, 1, 32).rotateX(-Math.PI / 2);
const cone = new ConeGeometry(0.22, 0.45, 4).rotateX(Math.PI);
/** One bar of a flat chevron (two bars make a 'V' pointing along +z). */
const chevron = new PlaneGeometry(0.16, 0.9).rotateX(-Math.PI / 2);
export const telegraphMaterials = {
  fill: new MeshBasicMaterial({ color: '#ff3b1f', transparent: true, opacity: 0.4, depthWrite: false, side: DoubleSide, toneMapped: false }),
  chevron: new MeshBasicMaterial({ color: '#ffe0d0', transparent: true, opacity: 0.75, depthWrite: false }),
  flip: new MeshBasicMaterial({ color: '#ffd36e', transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }),
  glance: new MeshBasicMaterial({ color: '#f08a3c', transparent: true, opacity: 0.9, depthWrite: false }),
  skid: new MeshBasicMaterial({ color: '#e9dcc4', transparent: true, opacity: 0.85, depthWrite: false }),
  bait: new MeshBasicMaterial({ color: '#ff6b4a', transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }),
  baitMe: new MeshBasicMaterial({ color: '#ffd36e', transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }),
  plume: new MeshBasicMaterial({ color: '#d9c8a6', transparent: true, opacity: 0.55, depthWrite: false }),
};

const END_CAP_NAME: Record<number, string> = {
  [ClatterEndKind.Flip]: 'clatter-endcap-flip', [ClatterEndKind.Glance]: 'clatter-endcap-glance', [ClatterEndKind.Skid]: 'clatter-endcap-skid',
};

/**
 * Lane, spin ring and drum plumes from `clatterTelegraph(row)` through
 * DangerTiles, a fill back-dated to the windup's first tick (as the Giant's),
 * chevrons toward the lane's end, the end-cap (cracked stone = Flip, scuff =
 * Glance/Skid), the spin's safe eye (a slam's safe ring 2) in cool green, a pulsing reticle over the
 * bait, and while a swarm is live its free lines and the runners' danger for
 * the next two ticks (FINAL_SPEC 7.2). World coordinates.
 */
export default function ClatterTelegraph({ row, tick }: ClatterTelegraphProps) {
  const tele = useMemo(() => clatterTelegraph(row),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [row.state, row.x, row.z, row.dir, row.endX, row.endZ, row.endKind, row.stateUntilTick, row.swarmSide, row.swarmFree, row.bait]);
  const fill = useRef<Group>(null);
  const reticle = useRef<Group>(null);
  const meHex = useBossStore((s) => s.meHex);
  const reduced = useSettingsStore((s) => s.reduceMotion);
  const live = useRef(row);
  live.current = row;
  const seen = useRef({ windupAt: -Infinity, key: '' });

  // Back-date the fill to the tick the windup started, so a late joiner sees the right progress.
  const windKey = tele ? `${row.state}:${row.stateUntilTick}:${row.x}:${row.z}` : '';
  useEffect(() => {
    const s = seen.current;
    if (!windKey || s.key === windKey) return;
    const start = row.stateUntilTick - telegraphLead(row);
    s.windupAt = performance.now() - Math.max(0, tickClock.tick - start) * tickClock.period;
    s.key = windKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windKey]);

  const F = swarmFire(row);
  const runners = useMemo(() => (F > 0 ? clatterSwarmBullets(row) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [F, row.swarmSide, row.swarmFree]);
  const freeTiles = useMemo(() => (F > 0 ? swarmFreeTiles(row) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [F, row.swarmSide, row.swarmFree]);
  const runnerNext = useMemo(() => (runners ? bulletDangerKeys(runners, tick + 1, inGlade) : null), [runners, tick]);
  const runnerLater = useMemo(() => {
    if (!runners) return null;
    const later = bulletDangerKeys(runners, tick + 2, inGlade);
    if (runnerNext) for (const k of runnerNext) later.delete(k);
    return later;
  }, [runners, runnerNext, tick]);

  // The safe tiles: the eye under a spin, ring 2 around a slam (both still in reach).
  const eye = useMemo(() => (tele?.attack === 'spin' ? spinEyeTiles(tele.from) : tele?.attack === 'slam' ? [...clatterSpinTiles(tele.from)] : null), [tele]);

  useFrame(() => {
    const now = performance.now();
    const r = live.current, t = tele;
    const f = fill.current;
    if (f) {
      f.visible = !!t;
      if (t) {
        const lead = telegraphLead(r);
        const k = Math.max(0.02, clamp01((now - seen.current.windupAt) / (Math.max(1, lead) * tickClock.period)));
        if (t.attack === 'charge') f.scale.set(1, 1, k);
        else f.scale.set(k, k, k);
        telegraphMaterials.fill.opacity = reduced ? 0.38 : 0.3 + k * 0.2 + Math.sin(now * 0.02) * 0.05;
      }
    }
    if (!reduced) telegraphMaterials.chevron.opacity = 0.55 + 0.3 * Math.sin(now * 0.012);
    const ret = reticle.current;
    if (ret) {
      const hex = t?.attack === 'charge' ? clatterBaitHex(r.bait) : null;
      const at = hex ? locateAvatar(hex) : null;
      ret.visible = !!at;
      if (at) {
        const bob = reduced ? 0 : Math.sin(now * 0.008) * 0.12;
        ret.position.set(at.x, 2.55 + bob, at.z);
        const s = reduced ? 1 : 1 + 0.12 * Math.sin(now * 0.012);
        ret.scale.set(s, s, s);
      }
    }
  });

  const charge = tele?.attack === 'charge' ? tele : null;
  const d = charge ? CLATTER_DIR8[charge.dir & 7] : null;
  const yaw = d ? Math.atan2(d[0], d[1]) : 0;
  const [sx, , sz] = tileToWorld(tele?.from ?? row);
  // Lane length in world units from the start centre to the far edge of the end body.
  const laneLen = charge && d ? Math.hypot(charge.to.x - charge.from.x, charge.to.z - charge.from.z) + 1.5 * Math.hypot(d[0], d[1]) : 0;
  const laneWidth = d && d[0] !== 0 && d[1] !== 0 ? 3 * Math.SQRT2 * 0.82 : 3;
  const chevrons: [number, number][] = [];
  if (charge && d) {
    const len = Math.max(Math.abs(charge.to.x - charge.from.x), Math.abs(charge.to.z - charge.from.z));
    for (let k = 1; k <= len; k += 2) {
      const [cx, , cz] = tileToWorld({ x: charge.from.x + d[0] * k, z: charge.from.z + d[1] * k });
      chevrons.push([cx, cz]);
    }
  }
  const capName = charge ? END_CAP_NAME[charge.endKind] ?? 'clatter-endcap-skid' : null;
  const endWorld = charge ? tileToWorld(charge.to) : null;
  const stoneWorld = charge && d ? tileToWorld({ x: charge.to.x + 2 * d[0], z: charge.to.z + 2 * d[1] }) : null;
  const isMe = !!meHex && !!charge && clatterBaitHex(row.bait) === meHex;

  return (
    <group name="clatter-telegraph">
      {tele && <DangerTiles tiles={tele.tiles} color={tele.attack === 'drum' ? TELEGRAPH_COLORS.drum : TELEGRAPH_COLORS.danger} opacity={0.3} stripes />}
      {eye && <DangerTiles tiles={eye} color={TELEGRAPH_COLORS.safe} opacity={0.32} />}
      {freeTiles && <DangerTiles tiles={freeTiles} color={TELEGRAPH_COLORS.free} opacity={0.12} />}
      {runnerNext && runnerNext.size > 0 && <DangerTiles tiles={runnerNext} color={TELEGRAPH_COLORS.runnerNext} opacity={0.42} stripes />}
      {runnerLater && runnerLater.size > 0 && <DangerTiles tiles={runnerLater} color={TELEGRAPH_COLORS.runnerLater} opacity={0.18} />}

      {/* The fill: grows along the lane, or out from the centre for the spin and the drum. */}
      <group ref={fill} name="clatter-fill" visible={false} position={[sx, 0.04, sz]} rotation={[0, yaw, 0]}>
        {tele?.attack === 'charge' && <mesh geometry={lanePlane} material={telegraphMaterials.fill} scale={[laneWidth, 1, laneLen]} raycast={noRaycast} />}
        {tele?.attack === 'spin' && <mesh geometry={ring} material={telegraphMaterials.fill} scale={[2.5, 1, 2.5]} raycast={noRaycast} />}
        {tele?.attack === 'slam' && <mesh geometry={plane} material={telegraphMaterials.fill} rotation={[-Math.PI / 2, 0, 0]} scale={[3, 3, 1]} raycast={noRaycast} />}
        {tele?.attack === 'drum' && tele.tiles.map((key) => {
          const [px, , pz] = tileToWorld({ x: key % GRID_SIZE, z: Math.floor(key / GRID_SIZE) });
          return <mesh key={key} geometry={cone} material={telegraphMaterials.plume} position={[px - sx, 0.25, pz - sz]} scale={[1.2, 1.6, 1.2]} raycast={noRaycast} />;
        })}
      </group>

      {chevrons.map(([cx, cz], i) => (
        <group key={i} position={[cx, 0.05, cz]} rotation={[0, yaw, 0]}>
          <mesh geometry={chevron} material={telegraphMaterials.chevron} position={[-0.26, 0, -0.1]} rotation={[0, 0.7, 0]} raycast={noRaycast} />
          <mesh geometry={chevron} material={telegraphMaterials.chevron} position={[0.26, 0, -0.1]} rotation={[0, -0.7, 0]} raycast={noRaycast} />
        </group>
      ))}

      {charge && capName && endWorld && d && (
        <group name={capName} position={[endWorld[0] + d[0] * 1.5, 0.06, endWorld[2] + d[1] * 1.5]} rotation={[0, yaw, 0]}>
          {charge.endKind === ClatterEndKind.Flip ? (
            <>
              <mesh geometry={plane} material={telegraphMaterials.flip} rotation={[-Math.PI / 2, 0, 0]} scale={[laneWidth, 0.22, 1]} raycast={noRaycast} />
              {stoneWorld && (
                <group position={[stoneWorld[0] - endWorld[0] - d[0] * 1.5, 0, stoneWorld[2] - endWorld[2] - d[1] * 1.5]}>
                  <mesh geometry={ring} material={telegraphMaterials.flip} scale={[0.75, 1, 0.75]} raycast={noRaycast} />
                  {[0.4, 1.9, 3.6].map((a) => (
                    <mesh key={a} geometry={plane} material={telegraphMaterials.flip} position={[Math.sin(a) * 0.45, 0.01, Math.cos(a) * 0.45]} rotation={[-Math.PI / 2, 0, a]} scale={[0.06, 0.6, 1]} raycast={noRaycast} />
                  ))}
                </group>
              )}
            </>
          ) : (
            <mesh geometry={plane} material={charge.endKind === ClatterEndKind.Glance ? telegraphMaterials.glance : telegraphMaterials.skid}
              rotation={[-Math.PI / 2, 0, charge.endKind === ClatterEndKind.Glance ? 0.45 : 0]} scale={[laneWidth * 0.8, 0.3, 1]} raycast={noRaycast} />
          )}
        </group>
      )}

      <group ref={reticle} name="clatter-bait" visible={false}>
        <mesh geometry={ring} material={isMe ? telegraphMaterials.baitMe : telegraphMaterials.bait} scale={[0.5, 1, 0.5]} raycast={noRaycast} />
        <mesh geometry={cone} material={isMe ? telegraphMaterials.baitMe : telegraphMaterials.bait} position={[0, 0.4, 0]} raycast={noRaycast} />
      </group>
    </group>
  );
}

