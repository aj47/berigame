import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { DynamicDrawUsage, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, MeshBasicMaterial } from 'three';
import { BRAMBLE_MESSAGE, RECIPES } from '@sim';
import { audio, installAudio } from '../audio';
import { locateAvatar } from '../animation/avatarRegistry';
import { useInventoryRows, useMyIdentityHex, usePlayers } from '../spacetime/hooks';
import { useToastStore } from '../spacetime/stores/toastStore';
import { identityHex } from '../spacetime/identity';
import { DustPool } from './dustPool';
import { fxQueue } from './combatFx';
import { FxKind, type FxEntry } from './fxQueue';
import { harvesting } from './harvestProgress';
import { flashAt, fxDebug } from './hitFlash';
import { progressHooks } from '../spacetime/stores/progressStore';

const CAPACITY = 160;
/** Impact dust starts about chest-high on the defender, pushed away from the attacker. */
const IMPACT_Y = 1.05;

const OUTPUTS = new Set(RECIPES.flatMap((r) => (r.output ? [r.output.itemId] : [])));
const INPUTS = new Set(RECIPES.flatMap((r) => r.inputs.map((i) => i.itemId)));

/**
 * World effects that belong to no single object: the impact dust pool (one
 * InstancedMesh, one draw call), the audio listener, and sounds with no event
 * of their own (craft, bramble rustle). Mounted once inside the Canvas.
 */
const FxLayer = () => {
  const me = useMyIdentityHex();
  const meRef = useRef(me);
  meRef.current = me;
  const scene = useThree((s) => s.scene);
  const pool = useMemo(() => new DustPool(CAPACITY), []);
  const mesh = useMemo(() => {
    const m = new InstancedMesh(new IcosahedronGeometry(1, 0), new MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }), CAPACITY);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.instanceColor = new InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3).setUsage(DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    m.renderOrder = 5;
    m.raycast = () => {};
    return m;
  }, []);
  // R3F assigns dispose={null} onto primitives, so call the Three prototype
  // when manually releasing the instance buffers on reconnect or hot reload.
  useEffect(() => () => { mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose(); InstancedMesh.prototype.dispose.call(mesh); }, [mesh]);
  useEffect(installAudio, []);
  useEffect(() => {
    if (!(import.meta as any).env?.DEV) return;
    (window as any).__berigameFx = {
      debug: fxDebug,
      flashAt,
      harvesting,
      particles: () => pool.count,
      /** Avatars (identity hex) whose body currently shows a flash variant. */
      flashing: () => {
        const out: string[] = [];
        scene.traverse((o: any) => { if (o.userData.berigameAvatar) o.traverse((m: any) => { if (m.isSkinnedMesh && String(m.material?.name).endsWith('#flash')) out.push(o.userData.berigameAvatar.identity); }); });
        return out;
      },
    };
    return () => { delete (window as any).__berigameFx; };
  }, [pool, scene]);

  // Harvesting avatars (reach animation) from the player table.
  const players = usePlayers();
  useEffect(() => {
    harvesting.clear();
    for (const p of players) if (p.harvestEndTick > 0) harvesting.set(identityHex(p.identity), p.harvestEndTick);
  }, [players]);

  // Brambles: the client refuses the step with a toast; rustle the hedge.
  useEffect(() => useToastStore.subscribe((s, prev) => {
    if (s.message === BRAMBLE_MESSAGE && prev.message !== BRAMBLE_MESSAGE) audio.play('rustle', { volume: 0.9 });
  }), []);

  // Skill level-ups and new keepsakes: a fanfare (not positional: it is yours).
  useEffect(() => {
    progressHooks.onMilestone = () => audio.play('levelup');
    return () => { progressHooks.onMilestone = () => {}; };
  }, []);

  // Crafting: a recipe output appeared while its inputs were spent.
  const rows = useInventoryRows();
  const counts = useRef<{ out: number; inp: number } | null>(null);
  useEffect(() => {
    let out = 0, inp = 0;
    for (const r of rows) {
      if (OUTPUTS.has(r.itemId)) out += r.quantity;
      if (INPUTS.has(r.itemId)) inp += r.quantity;
    }
    const prev = counts.current;
    if (prev && out > prev.out && inp < prev.inp) audio.play('craft');
    counts.current = { out, inp };
  }, [rows]);

  const fire = useMemo(() => (e: FxEntry) => {
    if (e.kind !== FxKind.Impact) return;
    const target = locateAvatar(e.target);
    if (!target) return;
    const tx = target.x, tz = target.z;
    const source = e.source ? locateAvatar(e.source) : null;
    const dx = source ? tx - source.x : 0, dz = source ? tz - source.z : 1;
    const len = Math.hypot(dx, dz) || 1;
    // Where the blow lands: on the defender's surface facing the attacker.
    pool.burst(tx - (dx / len) * 0.3, IMPACT_Y, tz - (dz / len) * 0.3, dx, dz, e.weight);
    // And a puff at the feet: the defender's recoil scuffs the sand.
    pool.burst(tx, 0.08, tz, dx, dz, 0, false);
  }, [pool, scene]);

  useFrame((_, delta) => {
    const now = performance.now();
    const hex = meRef.current;
    const self = hex ? locateAvatar(hex) : null;
    if (self) audio.setListener(self.x, self.z);
    fxQueue.drain(now, fire);
    pool.step(Math.min(delta, 0.05) / fxDebug.timeScale);
    const n = pool.write(mesh.instanceMatrix.array as Float32Array, mesh.instanceColor!.array as Float32Array);
    if (n > 0 || mesh.count > 0) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    }
  });

  return <primitive object={mesh} dispose={null} />;
};

export default FxLayer;
