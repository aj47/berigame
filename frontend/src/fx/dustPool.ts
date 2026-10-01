/**
 * A fixed pool of short-lived dust/impact particles, simulated in flat typed
 * arrays and written straight into an InstancedMesh's matrix and colour
 * buffers. No three.js dependency here, so tests drive it directly; nothing
 * allocates after construction. When the pool is full, new particles replace
 * the oldest.
 */
export const GRAVITY = -9;
const DRAG = 2.2;

export class DustPool {
  readonly px: Float32Array; readonly py: Float32Array; readonly pz: Float32Array;
  readonly vx: Float32Array; readonly vy: Float32Array; readonly vz: Float32Array;
  readonly age: Float32Array; readonly life: Float32Array; readonly size: Float32Array;
  readonly r: Float32Array; readonly g: Float32Array; readonly b: Float32Array;
  /** Next slot to (re)use: a ring, so a full pool recycles its oldest particle. */
  private cursor = 0;
  /** Live particles written by the last write(). */
  count = 0;

  constructor(readonly capacity = 128, private readonly random: () => number = Math.random) {
    const f = () => new Float32Array(capacity);
    this.px = f(); this.py = f(); this.pz = f(); this.vx = f(); this.vy = f(); this.vz = f();
    this.age = f(); this.life = f(); this.size = f(); this.r = f(); this.g = f(); this.b = f();
  }

  alive(i: number): boolean { return this.age[i] < this.life[i]; }

  /**
   * A burst at (x, y, z), thrown mostly along (dx, dz) (away from the attacker)
   * and up. `weight` 0..2 scales count, speed and size. `hit` mixes in a few
   * warm sparks among the sand-coloured dust.
   */
  burst(x: number, y: number, z: number, dx: number, dz: number, weight: number, hit = true): void {
    const rand = this.random;
    const n = 7 + weight * 4;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const speed = (1.6 + rand() * 2.2) * (1 + weight * 0.25);
      const a = (rand() - 0.5) * 2.4; // spread around the push direction
      const ca = Math.cos(a), sa = Math.sin(a);
      this.px[i] = x; this.py[i] = y; this.pz[i] = z;
      this.vx[i] = (ux * ca - uz * sa) * speed * 0.8 + (rand() - 0.5) * 0.6;
      this.vz[i] = (uz * ca + ux * sa) * speed * 0.8 + (rand() - 0.5) * 0.6;
      this.vy[i] = 0.8 + rand() * 2.2;
      this.age[i] = 0;
      this.life[i] = 0.32 + rand() * 0.3;
      this.size[i] = (0.07 + rand() * 0.07) * (1 + weight * 0.2);
      const spark = hit && k % 4 === 0;
      const shade = 0.85 + rand() * 0.15;
      this.r[i] = spark ? 1 : 0.93 * shade;
      this.g[i] = spark ? 0.86 : 0.84 * shade;
      this.b[i] = spark ? 0.55 : 0.66 * shade;
    }
  }

  /** Advance `dt` seconds. */
  step(dt: number): void {
    const drag = Math.exp(-DRAG * dt);
    for (let i = 0; i < this.capacity; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      this.vx[i] *= drag; this.vz[i] *= drag;
      this.vy[i] += GRAVITY * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < 0.03) { this.py[i] = 0.03; this.vy[i] *= -0.3; }
    }
  }

  /**
   * Pack live particles into the first `count` instances: a uniform-scale
   * translation matrix (column-major, 16 floats each) and an RGB colour.
   * Returns the count, to set as the InstancedMesh's draw count.
   */
  write(matrices: Float32Array, colors: Float32Array | null): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.age[i] >= this.life[i]) continue;
      const t = this.age[i] / this.life[i];
      const s = this.size[i] * (t < 0.15 ? 0.5 + t / 0.3 : 1 - (t - 0.15) / 0.85 * 0.9);
      const o = n * 16;
      matrices[o] = s; matrices[o + 1] = 0; matrices[o + 2] = 0; matrices[o + 3] = 0;
      matrices[o + 4] = 0; matrices[o + 5] = s; matrices[o + 6] = 0; matrices[o + 7] = 0;
      matrices[o + 8] = 0; matrices[o + 9] = 0; matrices[o + 10] = s; matrices[o + 11] = 0;
      matrices[o + 12] = this.px[i]; matrices[o + 13] = this.py[i]; matrices[o + 14] = this.pz[i]; matrices[o + 15] = 1;
      if (colors) { colors[n * 3] = this.r[i]; colors[n * 3 + 1] = this.g[i]; colors[n * 3 + 2] = this.b[i]; }
      n++;
    }
    this.count = n;
    return n;
  }
}
