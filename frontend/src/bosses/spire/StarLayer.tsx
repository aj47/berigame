import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, CylinderGeometry, Group, Mesh, MeshBasicMaterial, OctahedronGeometry, RingGeometry } from 'three';
import { TILE_ORIGIN, type Tile } from '@sim';
import { useTick } from '../../spacetime/hooks';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';
import { audio } from '../../audio';
import { useBossStore } from '../bossStore';
import { starView } from './starModel';

/**
 * Stars on the floor (FINAL_SPEC 7.5): the live wave's uncaught stars (gold, with a vertical light beam),
 * the next wave's faint preview in the last 2 ticks, blinking while a wave ends, and a burst plus a
 * chime when a star is caught (a starMask diff, so teammates' catches show too). A fixed pool of
 * meshes updated in useFrame; at most 12 stars exist at once.
 */
export type StarLayerProps = Record<string, never>;

const POOL = 12, BURSTS = 6;
const starGeo = new OctahedronGeometry(0.3, 0).scale(1, 1.25, 1);
const beamGeo = new CylinderGeometry(0.07, 0.16, 5, 6, 1, true).translate(0, 2.5, 0);
const burstGeo = new RingGeometry(0.3, 0.42, 20).rotateX(-Math.PI / 2);

interface Slot { group: Group; star: Mesh; beam: Mesh; starMat: MeshBasicMaterial; beamMat: MeshBasicMaterial }
interface Burst { mesh: Mesh; mat: MeshBasicMaterial; at: number }

export default function StarLayer(_props: StarLayerProps) {
  const tick = useTick();
  const run = useBossStore((s) => s.myRun);
  const fight = useBossStore((s) => s.fight);
  const reduced = useSettingsStore((s) => s.reduceMotion);
  const view = useMemo(() => starView(run, fight, tick), [run, fight, tick]);

  const art = useMemo(() => {
    const slots: Slot[] = Array.from({ length: POOL }, () => {
      const starMat = new MeshBasicMaterial({ color: '#ffd36e', toneMapped: false, transparent: true });
      const beamMat = new MeshBasicMaterial({ color: '#ffe9a8', toneMapped: false, transparent: true, opacity: 0.22, depthWrite: false, blending: AdditiveBlending });
      const star = new Mesh(starGeo, starMat), beam = new Mesh(beamGeo, beamMat), group = new Group();
      star.position.y = 0.6;
      star.raycast = () => {}; beam.raycast = () => {};
      group.add(star, beam);
      group.visible = false;
      return { group, star, beam, starMat, beamMat };
    });
    const bursts: Burst[] = Array.from({ length: BURSTS }, () => {
      const mat = new MeshBasicMaterial({ color: '#ffe08a', toneMapped: false, transparent: true, depthWrite: false });
      const mesh = new Mesh(burstGeo, mat);
      mesh.raycast = () => {};
      mesh.visible = false;
      return { mesh, mat, at: -Infinity };
    });
    return { slots, bursts, next: 0 };
  }, []);
  useEffect(() => () => { for (const s of art.slots) { s.starMat.dispose(); s.beamMat.dispose(); } for (const b of art.bursts) b.mat.dispose(); }, [art]);

  // Catches: a star of the same wave that disappeared from the live set.
  const prev = useRef<{ wave: number; live: Map<number, Tile> }>({ wave: -1, live: new Map() });
  useEffect(() => {
    const before = prev.current;
    const now = new Map(view.live.map((s) => [s.j, s.tile] as const));
    if (before.wave === view.wave) {
      for (const [j, tile] of before.live) {
        if (now.has(j)) continue;
        const b = art.bursts[art.next++ % BURSTS];
        b.mesh.position.set(tile.x - TILE_ORIGIN, 0.08, tile.z - TILE_ORIGIN);
        b.at = performance.now();
        audio.play('chime', { x: tile.x - TILE_ORIGIN, z: tile.z - TILE_ORIGIN, volume: 0.8 });
      }
    }
    prev.current = { wave: view.wave, live: now };
  }, [view, art]);

  const viewRef = useRef(view);
  viewRef.current = view;
  useFrame(({ clock }) => {
    const v = viewRef.current, t = clock.elapsedTime;
    let i = 0;
    const place = (tile: Tile, faint: boolean) => {
      const s = art.slots[i++];
      s.group.visible = true;
      s.group.position.set(tile.x - TILE_ORIGIN, 0, tile.z - TILE_ORIGIN);
      const blink = !faint && v.ending ? (reduced ? 0.5 : Math.sin(t * 18) > 0 ? 1 : 0.25) : 1;
      s.starMat.opacity = faint ? 0.28 : blink;
      s.beamMat.opacity = faint ? 0.06 : 0.22 * blink;
      s.star.rotation.y = reduced ? 0 : t * 1.6;
      s.star.position.y = reduced ? 0.6 : 0.6 + Math.sin(t * 2.4 + tile.x) * 0.06;
    };
    for (const s of v.live) if (i < POOL) place(s.tile, false);
    for (const tile of v.preview) if (i < POOL) place(tile, true);
    for (; i < POOL; i++) art.slots[i].group.visible = false;
    const now = performance.now();
    for (const b of art.bursts) {
      const k = (now - b.at) / 600;
      b.mesh.visible = k >= 0 && k < 1;
      if (!b.mesh.visible) continue;
      b.mesh.scale.setScalar(reduced ? 1.4 : 1 + k * 2.2);
      b.mat.opacity = 1 - k;
    }
  });

  return <>
    {art.slots.map((s) => <primitive key={s.group.uuid} object={s.group} />)}
    {art.bursts.map((b) => <primitive key={b.mesh.uuid} object={b.mesh} />)}
  </>;
}
