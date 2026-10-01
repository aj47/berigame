import { Quaternion, Vector3, type Material, type MeshStandardMaterial, type Object3D } from 'three';
import { audio } from '../audio';
import { flashMaterial, flashStage } from './hitFlash';
import { harvesting } from './harvestProgress';

/** World units per footstep (one foot plant: half a Run cycle). */
export const STRIDE = 1.15;
/** One pluck-and-pull every this many seconds while harvesting. */
export const PLUCK_PERIOD_S = 0.95;

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);

interface Reach { bone: Object3D; applied: Quaternion; }

/**
 * Per-avatar presentation that rides on top of the animator, driven from
 * AdventurerModel's frame: the hit flash (material swap to a shared
 * per-palette variant), footsteps, the respawn chime and a light procedural
 * "reach and pluck" while harvesting (the GLB's Grab clip is not in the
 * director's clip set). Everything is preallocated; update() allocates nothing.
 */
export class AvatarFx {
  private readonly bodies: { material: Material | Material[] }[] = [];
  private palette: MeshStandardMaterial | null = null;
  private stage: 0 | 1 | 2 = 0;
  private walked = 0;
  private wasDead: boolean | null = null;
  private reachWeight = 0;
  private readonly reaches: Reach[] = [];
  private readonly scratch = new Quaternion();
  private readonly parentWorld = new Quaternion();
  private readonly modelWorld = new Quaternion();
  private readonly current = new Vector3();
  private readonly desired = new Vector3();

  constructor(private readonly model: Object3D, private readonly identity: string, private readonly isSelf: boolean) {
    model.traverse((o: any) => { if (o.isSkinnedMesh) this.bodies.push(o); });
    for (const name of ['UpperArmR', 'ForearmR', 'Chest']) {
      const bone = model.getObjectByName(name);
      if (bone) this.reaches.push({ bone, applied: new Quaternion() });
    }
  }

  /** The body's current palette material (set whenever the palette changes). */
  setPalette(material: MeshStandardMaterial): void {
    this.palette = material;
    this.stage = 0;
  }

  /** Undo last frame's reach offsets before the mixer writes this frame's pose. */
  beforeAnimate(): void {
    for (const r of this.reaches) {
      if (r.applied.w === 1) continue;
      r.bone.quaternion.premultiply(this.scratch.copy(r.applied).invert());
      r.applied.identity();
    }
  }

  afterAnimate(now: number, dt: number, x: number, z: number, moving: boolean, speed: number, dead: boolean, idle: boolean): void {
    // ---- hit flash
    if (this.palette) {
      const stage = flashStage(this.identity, now);
      if (stage !== this.stage) {
        this.stage = stage;
        const material = flashMaterial(this.palette, stage);
        for (const body of this.bodies) body.material = material;
      }
    }
    // ---- footsteps: one per stride of ground actually covered
    if (moving && !dead && speed > 0.2) {
      this.walked += speed * dt;
      if (this.walked >= STRIDE) {
        this.walked -= STRIDE;
        audio.play('footstep', { volume: this.isSelf ? 0.75 : 0.6, x, z, detune: 0.07 });
      }
    } else {
      // The first plant of the next run comes quickly.
      this.walked = STRIDE * 0.55;
    }
    // ---- respawn
    if (this.wasDead === true && !dead) audio.play('respawn', { volume: this.isSelf ? 0.9 : 0.6, x, z });
    this.wasDead = dead;
    // ---- harvest reach
    const reaching = idle && !moving && !dead && harvesting.has(this.identity);
    this.reachWeight = Math.min(1, Math.max(0, this.reachWeight + (reaching ? dt * 4 : -dt * 6)));
    const w = this.reachWeight;
    if (w > 0 && this.reaches.length === 3) {
      const phase = (now / 1000 / PLUCK_PERIOD_S) % 1;
      // Reach in, close the hand (hold), pull back quickly.
      const p = phase < 0.55 ? Math.sin((phase / 0.55) * Math.PI * 0.5) : Math.cos(((phase - 0.55) / 0.45) * Math.PI * 0.5);
      const [upper, fore, chest] = this.reaches;
      // Lean into the bush (Chest rests aligned with the model axes: +X tips it forward).
      chest.applied.setFromAxisAngle(X, (0.1 + 0.08 * p) * w);
      chest.bone.quaternion.premultiply(chest.applied);
      // Aim the arm bones (which point along their local +Y) in model space: the model faces +Z, its right hand is at -X.
      this.model.getWorldQuaternion(this.modelWorld);
      upper.bone.parent!.updateWorldMatrix(true, false);
      upper.bone.parent!.getWorldQuaternion(this.parentWorld);
      this.aim(upper, -0.12, -0.35 + 0.75 * p, 1, w);
      // The forearm's parent is the (now re-aimed) upper arm.
      this.parentWorld.multiply(upper.bone.quaternion);
      this.aim(fore, -0.1, 0.2 + 0.9 * (1 - p), 1 - 0.6 * (1 - p), w);
    }
  }

  /** Turn `r.bone` (in its parent's frame, parentWorld) so its +Y points along model-space (x, y, z), by weight w. */
  private aim(r: Reach, x: number, y: number, z: number, w: number): void {
    const desired = this.desired.set(x, y, z).normalize().applyQuaternion(this.modelWorld).applyQuaternion(this.scratch.copy(this.parentWorld).invert());
    const current = this.current.copy(Y).applyQuaternion(r.bone.quaternion);
    r.applied.setFromUnitVectors(current, desired);
    r.applied.copy(this.scratch.identity().slerp(r.applied, w));
    r.bone.quaternion.premultiply(r.applied);
  }
}
