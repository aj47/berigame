import { homePoint, homePath, homeLocation, isHomeRegion } from "../../../shared/sim/frontier/homeMap";
import { regionalPath } from '../../../shared/sim/frontier/regions';
import { buildingBlocker } from '../../../shared/sim/frontier/building';
import type { Location, RegionId } from '../../../shared/sim/frontier/catalog';
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';
import { MOVEMENT_STEPS_PER_TICK, bfsPath, chebyshev, facingToYaw, goalIsTile, tileKey, tileToWorld, type Facing, type Tile } from '@sim';
import { tickClock } from '../spacetime/tickClock';
import { recordDiagnostic } from '../spacetime/diagnostics';
import { useWorldBlocked } from '../spacetime/hooks';
import { MOVEMENT_ANIMATION_GRACE_MS, START_EASE_MS, dampAngle, easedElapsed, easedSpeedFactor, turnFactor } from '../animation/locomotion';

interface Motion {
  from: Vector3;
  to: Vector3;
  points: Vector3[];
  stepLengths: number[];
  segment: number;
  durationMs: number;
  startedAt: number;
  moving: boolean;
  /** Actual world units/second on the currently interpolated segment (lower while easing in from rest). */
  speed: number;
  yaw: number;
  initialized: boolean;
  authoritative: Tile;
  region: RegionId;
  /** How long the body has waited at its destination with the gait held (the arrival grace); 0 while travelling. */
  holdMs: number;
  /** This route set off from a standstill, so its first START_EASE_MS ease in. */
  fromRest: boolean;
  /** performance.now() of the previous frame (-1 before the first). */
  lastFrameAt: number;
}
const stepLength = (a: Vector3, b: Vector3) => Math.max(Math.abs(b.x-a.x), Math.abs(b.z-a.z));

/** Advance confirmed travel to this instant, including between animation frames. */
function advanceMotion(m: Motion, g: { position: Vector3 }, now: number): void {
  if (m.moving) {
    const elapsed=now-m.startedAt;
    // From rest the body eases in, and is exactly on schedule from START_EASE_MS on.
    const ease=m.fromRest ? Math.min(START_EASE_MS, m.durationMs) : 0;
    const alpha=Math.min(1,Math.max(0,easedElapsed(elapsed,ease)/m.durationMs));
    const totalSteps=m.stepLengths.reduce((sum,value)=>sum+value,0);
    let progress=alpha*totalSteps, segment=0;
    while (segment < m.stepLengths.length-1 && progress >= m.stepLengths[segment]) { progress-=m.stepLengths[segment]; segment++; }
    m.segment=segment;
    const from=m.points[segment], to=m.points[segment+1], length=m.stepLengths[segment];
    g.position.lerpVectors(from,to,Math.min(1,progress/length));
    m.yaw=Math.atan2(to.x-from.x,to.z-from.z);
    m.speed=from.distanceTo(to)/(length*m.durationMs/totalSteps/1000)*easedSpeedFactor(elapsed,ease);
    m.holdMs=0;
    if (alpha>=1) {
      g.position.copy(m.to);
      // Keep "moving" and the last travel direction through this hold, so a
      // late next step continues the run; the position still stops exactly
      // at the confirmed destination, and holdMs lets the animation stop the
      // stride with it instead of running in place.
      m.holdMs=Math.max(0,elapsed-m.durationMs);
      if (elapsed >= m.durationMs+MOVEMENT_ANIMATION_GRACE_MS) {
        m.moving=false; m.speed=0; m.holdMs=0;
      }
    }
  }
}

/**
 * Interpolate confirmed server travel along valid tile edges, including turns
 * within a tick. Never predict movement through obstacles. The same movement
 * budget drives short-step duration and the diagonal/teleport distinction.
 */
export function useTileMotion(tileX: number, tileZ: number, facing: number, groupRef: React.MutableRefObject<any>, region: RegionId = 'bramblewild', frontierBlocked?: Set<string>, frontierBlocksAt?: (from: Location) => Set<string>, diagnoseSelf = false): React.MutableRefObject<Motion> {
  // Shared and stable while no node moves: tree cooldowns do not re-render avatars.
  const blocked = useWorldBlocked();
  const motion = useRef<Motion>({
    from: new Vector3(), to: new Vector3(), points: [], stepLengths: [], segment: 0,
    durationMs: 0, startedAt: 0, moving: false, speed: 0,
    yaw: facingToYaw(facing as Facing), initialized: false, authoritative: homePoint({x:tileX,z:tileZ}, region), region,
    holdMs: 0, fromRest: false, lastFrameAt: -1,
  });
  useEffect(() => {
    const m = motion.current, g = groupRef.current;
    const tile = homePoint({ x: tileX, z: tileZ }, region);
    const destination = new Vector3(...tileToWorld(tile));
    const previous = m.authoritative;
    const previousRegion = m.region;
    const diagnose = (kind: string, data: Record<string, string | number>) => {
      if (!diagnoseSelf) return;
      const from = previousRegion === 'settlement' ? homeLocation(previous) : previous;
      recordDiagnostic(kind, { tick: tickClock.tick, fromRegion: previousRegion, toRegion: region,
        fromX: from.x, fromZ: from.z, toX: tileX, toZ: tileZ, ...data });
    };
    m.authoritative = tile; m.region = region;
    const snap = (reason: string, routeLength = -1) => {
      diagnose('movement-snap', { reason, routeLength });
      m.from.copy(destination); m.to.copy(destination); m.points=[]; m.stepLengths=[];
      m.segment=0; m.moving=false; m.speed=0; m.holdMs=0; m.initialized=true;
      if (g) g.position.copy(destination);
    };
    if (!m.initialized || !g) { snap('startup'); return; }
    // Peaceful district travel can cover three steps. Confirm the full route
    // before animating, including walls between otherwise walkable floor tiles.
    const maximum = 3;
    if (previousRegion !== region && !(isHomeRegion(previousRegion) && isHomeRegion(region))) { snap('region-change'); return; }
    if (chebyshev(previous, tile) > maximum) { snap('jump-limit'); return; }
    // Gate access depends on the actor at the start of this confirmed move.
    // Using the new position would incorrectly unlock a gate just entered.
    const fromLocation = { ...(previousRegion === 'settlement' ? homeLocation(previous) : previous), region: previousRegion };
    const frontierObstacle = buildingBlocker(frontierBlocksAt?.(fromLocation) ?? frontierBlocked ?? new Set());
    const homeObstacle = Object.assign((p: Location) => p.region === 'bramblewild' ? blocked.has(tileKey(p)) : frontierObstacle(p), {
      crosses: (a: Location, b: Location) => a.region === 'settlement' && b.region === 'settlement' && frontierObstacle.crosses(a, b),
    });
    const route = region === 'bramblewild' && previousRegion === 'bramblewild' ? bfsPath(previous, goalIsTile(tile), blocked) : isHomeRegion(region) ? homePath(previous, tile, homeObstacle) : regionalPath(region, previous, tile, frontierObstacle);
    if (!route) { snap('route-invalid'); return; }
    if (route.length > maximum) { snap('route-too-long', route.length); return; }
    // A packet can arrive between RAF callbacks. Advance the previous route
    // first so elapsed travel is not added to the queue again on every tick.
    const now = performance.now();
    advanceMotion(m, g, now);
    // Finish any unrendered corner of the previous update before following
    // this update. Early network delivery must not make us cut across a tree.
    const remaining = m.moving ? m.points.slice(m.segment + 1) : [];
    const points = [g.position.clone(), ...remaining, ...route.map(t => new Vector3(...tileToWorld(t)))];
    m.points = points.filter((p, i) => i === 0 || p.distanceTo(points[i-1]) > 0.001);
    m.stepLengths = m.points.slice(1).map((p, i) => stepLength(m.points[i], p));
    const steps = m.stepLengths.reduce((sum, value) => sum + value, 0);
    m.from.copy(g.position); m.to.copy(destination); m.segment=0;
    m.durationMs = steps * tickClock.period / Math.max(MOVEMENT_STEPS_PER_TICK, route.length);
    // Continuing travel (or resuming within the arrival grace) keeps full speed.
    m.fromRest = !m.moving;
    m.startedAt = now; m.moving = steps > 0.01; m.holdMs = 0;
    if (m.moving) {
      diagnose('movement-interpolate', { routeLength: route.length, durationMs: Math.round(m.durationMs) });
      const next=m.points[1];
      m.yaw=Math.atan2(next.x-m.from.x,next.z-m.from.z);
      m.speed=m.from.distanceTo(next)/(m.stepLengths[0]*tickClock.period/MOVEMENT_STEPS_PER_TICK/1000);
    } else m.speed=0;
  }, [tileX, tileZ, region]);

  useFrame(() => {
    const m=motion.current, g=groupRef.current;
    if (!g) return;
    const now=performance.now();
    const dt=m.lastFrameAt<0 ? 1/60 : Math.min(0.1, Math.max(0, (now-m.lastFrameAt)/1000));
    m.lastFrameAt=now;
    advanceMotion(m, g, now);
    const targetYaw=m.moving?m.yaw:facingToYaw(facing as Facing);
    // Same feel as the old 0.2 per frame at 60fps, at any frame rate.
    g.rotation.y=dampAngle(g.rotation.y,targetYaw,turnFactor(dt));
  });
  return motion;
}
