import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';
import { MOVEMENT_STEPS_PER_TICK, KNOCKBACK_TILES, bfsPath, blockedSetFromTiles, chebyshev, facingToYaw, goalIsTile, tileToWorld, type Facing, type Tile } from '@sim';
import { tickClock } from '../spacetime/tickClock';
import { useTrees } from '../spacetime/hooks';

interface Motion {
  from: Vector3;
  to: Vector3;
  points: Vector3[];
  stepLengths: number[];
  segment: number;
  durationMs: number;
  startedAt: number;
  moving: boolean;
  /** Actual world units/second on the currently interpolated segment. */
  speed: number;
  yaw: number;
  initialized: boolean;
  authoritative: Tile;
}
function dampAngle(current: number, target: number, factor: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * factor;
}
const stepLength = (a: Vector3, b: Vector3) => Math.max(Math.abs(b.x-a.x), Math.abs(b.z-a.z));
// Absorb a small packet/frame gap without flashing an idle Guard pose mid-run.
const MOVEMENT_ANIMATION_GRACE_MS = 120;

/**
 * Interpolate confirmed server travel along valid tile edges, including turns
 * within a tick. Never predict movement through obstacles. The same movement
 * budget drives short-step duration and the diagonal/teleport distinction.
 */
export function useTileMotion(tileX: number, tileZ: number, facing: number, groupRef: React.MutableRefObject<any>): React.MutableRefObject<Motion> {
  const trees = useTrees();
  const blocked = useMemo(() => blockedSetFromTiles(trees), [trees]);
  const motion = useRef<Motion>({
    from: new Vector3(), to: new Vector3(), points: [], stepLengths: [], segment: 0,
    durationMs: 0, startedAt: 0, moving: false, speed: 0,
    yaw: facingToYaw(facing as Facing), initialized: false, authoritative: {x:tileX,z:tileZ},
  });
  useEffect(() => {
    const m = motion.current, g = groupRef.current;
    const tile = { x: tileX, z: tileZ };
    const destination = new Vector3(...tileToWorld(tile));
    const previous = m.authoritative;
    m.authoritative = tile;
    const snap = () => {
      m.from.copy(destination); m.to.copy(destination); m.points=[]; m.stepLengths=[];
      m.segment=0; m.moving=false; m.speed=0; m.initialized=true;
      if (g) g.position.copy(destination);
    };
    if (!m.initialized || !g) { snap(); return; }
    // A legal two-step diagonal is 2.83 world units, not a teleport. Allow the
    // existing one-tile combat knockback in the same authoritative update too.
    const maximum = MOVEMENT_STEPS_PER_TICK + KNOCKBACK_TILES;
    if (chebyshev(previous, tile) > maximum) { snap(); return; }
    const route = bfsPath(previous, goalIsTile(tile), blocked);
    if (!route || route.length > maximum) { snap(); return; }
    // Finish any unrendered corner of the previous update before following
    // this update. Early network delivery must not make us cut across a tree.
    const remaining = m.moving ? m.points.slice(m.segment + 1) : [];
    const points = [g.position.clone(), ...remaining, ...route.map(t => new Vector3(...tileToWorld(t)))];
    m.points = points.filter((p, i) => i === 0 || p.distanceTo(points[i-1]) > 0.001);
    m.stepLengths = m.points.slice(1).map((p, i) => stepLength(m.points[i], p));
    const steps = m.stepLengths.reduce((sum, value) => sum + value, 0);
    m.from.copy(g.position); m.to.copy(destination); m.segment=0;
    m.durationMs = steps * tickClock.period / MOVEMENT_STEPS_PER_TICK;
    m.startedAt = performance.now(); m.moving = steps > 0.01;
    if (m.moving) {
      const next=m.points[1];
      m.yaw=Math.atan2(next.x-m.from.x,next.z-m.from.z);
      m.speed=m.from.distanceTo(next)/(m.stepLengths[0]*tickClock.period/MOVEMENT_STEPS_PER_TICK/1000);
    } else m.speed=0;
  }, [tileX, tileZ]);

  useFrame(() => {
    const m=motion.current, g=groupRef.current;
    if (!g) return;
    if (m.moving) {
      const alpha=Math.min(1,Math.max(0,(performance.now()-m.startedAt)/m.durationMs));
      const totalSteps=m.stepLengths.reduce((sum,value)=>sum+value,0);
      let progress=alpha*totalSteps, segment=0;
      while (segment < m.stepLengths.length-1 && progress >= m.stepLengths[segment]) { progress-=m.stepLengths[segment]; segment++; }
      m.segment=segment;
      const from=m.points[segment], to=m.points[segment+1], length=m.stepLengths[segment];
      g.position.lerpVectors(from,to,Math.min(1,progress/length));
      m.yaw=Math.atan2(to.x-from.x,to.z-from.z);
      m.speed=from.distanceTo(to)/(length*m.durationMs/totalSteps/1000);
      if (alpha>=1) {
        g.position.copy(m.to);
        // Preserve the last travel direction and cadence during this hold.
        // The position still stops exactly at the confirmed destination.
        if (performance.now()-m.startedAt >= m.durationMs+MOVEMENT_ANIMATION_GRACE_MS) {
          m.moving=false; m.speed=0;
        }
      }
    }
    const targetYaw=m.moving?m.yaw:facingToYaw(facing as Facing);
    g.rotation.y=dampAngle(g.rotation.y,targetYaw,0.2);
  });
  return motion;
}
