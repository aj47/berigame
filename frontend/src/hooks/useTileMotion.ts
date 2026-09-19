import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';
import { facingToYaw, tileToWorld, type Facing } from '@sim';
import { tickClock } from '../spacetime/tickClock';

interface Motion {
  from: Vector3;
  to: Vector3;
  startedAt: number;
  moving: boolean;
  yaw: number;
  initialized: boolean;
}

function dampAngle(current: number, target: number, factor: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * factor;
}

/**
 * Moves a group between server tiles. Each row update starts a lerp from
 * wherever the avatar currently is to the new tile, timed to the observed tick
 * period, so the avatar is always one tick behind the server and never snaps.
 */
export function useTileMotion(
  tileX: number,
  tileZ: number,
  facing: number,
  groupRef: React.MutableRefObject<any>
): React.MutableRefObject<Motion> {
  const motion = useRef<Motion>({
    from: new Vector3(),
    to: new Vector3(),
    startedAt: 0,
    moving: false,
    yaw: facingToYaw(facing as Facing),
    initialized: false,
  });

  useEffect(() => {
    const m = motion.current;
    const g = groupRef.current;
    const [wx, wy, wz] = tileToWorld({ x: tileX, z: tileZ });
    if (!m.initialized || !g) {
      m.from.set(wx, wy, wz);
      m.to.set(wx, wy, wz);
      m.initialized = true;
      m.moving = false;
      if (g) g.position.set(wx, wy, wz);
      return;
    }
    m.from.copy(g.position);
    m.to.set(wx, wy, wz);
    const dist = m.from.distanceTo(m.to);
    if (dist > 2.5) {
      // Respawn / teleport: don't slide across the map.
      m.from.copy(m.to);
      g.position.copy(m.to);
      m.moving = false;
      return;
    }
    m.startedAt = performance.now();
    m.moving = dist > 0.01;
    if (m.moving) m.yaw = Math.atan2(m.to.x - m.from.x, m.to.z - m.from.z);
  }, [tileX, tileZ]);

  useFrame(() => {
    const m = motion.current;
    const g = groupRef.current;
    if (!g) return;
    if (m.moving) {
      const alpha = Math.min(1, (performance.now() - m.startedAt) / tickClock.period);
      g.position.lerpVectors(m.from, m.to, alpha);
      if (alpha >= 1) m.moving = false;
    }
    const targetYaw = m.moving ? m.yaw : facingToYaw(facing as Facing);
    g.rotation.y = dampAngle(g.rotation.y, targetYaw, 0.2);
  });

  return motion;
}
