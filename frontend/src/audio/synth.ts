/**
 * Procedural sound effects as pure DSP: every sound is rendered once into a
 * Float32Array (no audio assets, no Web Audio needed). The engine copies them
 * into AudioBuffers after the first user gesture; renderDemo.ts writes the
 * same samples to a WAV so the sounds can be auditioned offline.
 */

export const SFX = [
  'footstep', 'punch', 'stick', 'club', 'whoosh', 'pop', 'chime', 'craft', 'eat', 'rustle', 'thud', 'respawn', 'click', 'levelup',
  // Bosses: telegraph start, volley fire, phase change / clear / defeat, swarm, Clatterhorn's flip.
  'warn', 'shard', 'shatter', 'skitter', 'crash',
] as const;
export type SfxName = (typeof SFX)[number];
export const AMBIENT = ['ocean', 'wind'] as const;
export type AmbientName = (typeof AMBIENT)[number];

/** Round-robin variants per sound, so repeats (footsteps above all) don't sound machine-gunned. */
export const VARIANTS: Record<SfxName, number> = {
  footstep: 4, punch: 2, stick: 2, club: 2, whoosh: 2, pop: 2, chime: 1, craft: 1, eat: 1, rustle: 2, thud: 1, respawn: 1, click: 1, levelup: 1,
  warn: 1, shard: 3, shatter: 1, skitter: 2, crash: 1,
};

/** Deterministic PRNG (mulberry32) so a sound renders identically every time. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Topology-preserving state-variable filter (one per voice; cutoff can move per sample). */
class Svf {
  private ic1 = 0; private ic2 = 0;
  low = 0; band = 0; high = 0;
  constructor(private readonly sr: number) {}
  run(x: number, cutoff: number, q = 0.707): void {
    const g = Math.tan(Math.PI * Math.min(Math.max(cutoff, 20), this.sr * 0.45) / this.sr);
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
    this.low = v2; this.band = v1; this.high = x - k * v1 - v2;
  }
}

const TAU = Math.PI * 2;
/** Attack-then-exponential-decay envelope. */
const env = (t: number, attack: number, decay: number) => (t < 0 ? 0 : t < attack ? t / attack : Math.exp(-(t - attack) / decay));

/** A pitch-swept sine: frequency glides exponentially from f0 to f1 over `glide` seconds. */
function sweep(out: Float32Array, sr: number, start: number, f0: number, f1: number, glide: number, attack: number, decay: number, amp: number): void {
  let phase = 0;
  for (let i = Math.floor(start * sr); i < out.length; i++) {
    const t = i / sr - start;
    // glide 0 (a fixed pitch) must never reach pow(1, -Infinity) when t rounds just below 0.
    const f = glide > 0 && t < glide ? f0 * Math.pow(f1 / f0, Math.max(0, t) / glide) : f1;
    phase += TAU * f / sr;
    out[i] += Math.sin(phase) * env(t, attack, decay) * amp;
  }
}

/** Filtered noise burst. `cutoff(t)` may sweep; mode picks the SVF output. */
function noise(out: Float32Array, sr: number, rand: () => number, start: number, cutoff: (t: number) => number, mode: 'low' | 'band' | 'high', q: number, attack: number, decay: number, amp: number): void {
  const f = new Svf(sr);
  for (let i = Math.floor(start * sr); i < out.length; i++) {
    const t = i / sr - start;
    f.run(rand() * 2 - 1, cutoff(t), q);
    out[i] += f[mode] * env(t, attack, decay) * amp;
  }
}

/** Modal "knock": a few damped partials, the core of wood and stone impacts. */
function knock(out: Float32Array, sr: number, start: number, partials: readonly [number, number, number][]): void {
  for (const [freq, decay, amp] of partials) sweep(out, sr, start, freq, freq, 0, 0.001, decay, amp);
}

function normalize(out: Float32Array, peak: number): Float32Array {
  let max = 0;
  for (let i = 0; i < out.length; i++) max = Math.max(max, Math.abs(out[i]));
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] *= peak / max;
  // 3ms fade-out so no sound ends on a click.
  const fade = Math.min(out.length, Math.floor(0.003 * 48000));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}

/** Duration in seconds of each sound. */
const LENGTH: Record<SfxName, number> = {
  footstep: 0.14, punch: 0.2, stick: 0.26, club: 0.4, whoosh: 0.3, pop: 0.14, chime: 0.9, craft: 0.85, eat: 0.36, rustle: 0.5, thud: 0.6, respawn: 1.0, click: 0.05, levelup: 1.3,
  warn: 0.4, shard: 0.12, shatter: 0.9, skitter: 0.5, crash: 0.5,
};
/** Peak level of each sound relative to full scale: the mix is set here, the engine only scales. */
const PEAK: Record<SfxName, number> = {
  footstep: 0.32, punch: 0.75, stick: 0.8, club: 0.95, whoosh: 0.4, pop: 0.55, chime: 0.5, craft: 0.6, eat: 0.5, rustle: 0.45, thud: 0.85, respawn: 0.5, click: 0.3, levelup: 0.55,
  warn: 0.45, shard: 0.35, shatter: 0.6, skitter: 0.4, crash: 0.9,
};

export function renderSound(name: SfxName, sr: number, variant = 0): Float32Array {
  const out = new Float32Array(Math.ceil(LENGTH[name] * sr));
  const rand = rng(0x9e3779b1 ^ (SFX.indexOf(name) * 7919 + variant * 104729));
  const v = 1 + (variant - (VARIANTS[name] - 1) / 2) * 0.06; // small pitch spread across variants
  switch (name) {
    case 'footstep': // soft sand/grass scuff: low noise plus a faint heel thump
      noise(out, sr, rand, 0, (t) => 900 * v - t * 3000, 'low', 0.8, 0.004, 0.035, 1);
      sweep(out, sr, 0, 120 * v, 70, 0.05, 0.002, 0.03, 0.5);
      break;
    case 'punch': // fist on body: dull thump and a short slap
      sweep(out, sr, 0, 140 * v, 55, 0.09, 0.001, 0.06, 1);
      noise(out, sr, rand, 0, () => 1800 * v, 'low', 0.7, 0.001, 0.015, 0.8);
      break;
    case 'stick': // wooden knock
      knock(out, sr, 0, [[420 * v, 0.05, 0.7], [980 * v, 0.03, 0.45], [1650 * v, 0.018, 0.3]]);
      noise(out, sr, rand, 0, () => 3000, 'band', 1.2, 0.001, 0.01, 0.6);
      sweep(out, sr, 0, 160, 70, 0.08, 0.001, 0.05, 0.5);
      break;
    case 'club': // stone on body: heavy thump, crunch and a low knock
      sweep(out, sr, 0, 110 * v, 42, 0.16, 0.001, 0.12, 1);
      knock(out, sr, 0, [[310 * v, 0.07, 0.5], [720 * v, 0.04, 0.35], [1330 * v, 0.02, 0.2]]);
      noise(out, sr, rand, 0, (t) => 2500 - t * 8000, 'low', 0.9, 0.001, 0.05, 0.9);
      break;
    case 'whoosh': { // swing: band-passed noise whose centre rises then falls
      const len = LENGTH.whoosh;
      const f = new Svf(sr);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr, x = t / len;
        f.run(rand() * 2 - 1, (350 + 1700 * Math.sin(Math.PI * x)) * v, 1.6);
        out[i] = f.band * Math.pow(Math.sin(Math.PI * Math.min(1, x * 1.15)), 2);
      }
      break;
    }
    case 'pop': // berry plucked: a quick upward blip
      sweep(out, sr, 0, 420 * v, 950 * v, 0.05, 0.002, 0.04, 1);
      noise(out, sr, rand, 0, () => 2500, 'band', 2, 0.001, 0.008, 0.4);
      break;
    case 'chime': // stick found: two bell notes (fifth up)
      for (const [start, base] of [[0, 880], [0.1, 1318.5]] as const) {
        knock(out, sr, start, [[base, 0.35, 0.6], [base * 2.76, 0.12, 0.18], [base * 5.4, 0.05, 0.08]]);
      }
      break;
    case 'craft': // three stone-on-wood clacks, then a small chime
      for (const [start, pitch] of [[0, 1], [0.13, 1.08], [0.26, 0.95]] as const) {
        knock(out, sr, start, [[520 * pitch, 0.04, 0.6], [1400 * pitch, 0.02, 0.35]]);
        noise(out, sr, rand, start, () => 3500, 'band', 1.5, 0.001, 0.008, 0.5);
      }
      knock(out, sr, 0.42, [[1046.5, 0.25, 0.4], [1568, 0.18, 0.25], [2093, 0.1, 0.12]]);
      break;
    case 'eat': // three crunchy bites
      for (const start of [0, 0.1, 0.21]) noise(out, sr, rand, start, () => 2400 + rand() * 600, 'band', 1.1, 0.002, 0.03, 0.9);
      break;
    case 'rustle': { // brambles: crackly high noise, randomly gated
      const f = new Svf(sr);
      let gate = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        if (rand() < 0.004) gate = 0.4 + rand() * 0.6;
        gate *= 0.9985;
        f.run(rand() * 2 - 1, 2600 * v, 0.6);
        out[i] = f.high * (0.25 + gate) * Math.sin(Math.PI * Math.min(1, t / LENGTH.rustle));
      }
      break;
    }
    case 'thud': // body hits the ground
      sweep(out, sr, 0, 75, 34, 0.3, 0.003, 0.2, 1);
      noise(out, sr, rand, 0, () => 400, 'low', 0.7, 0.003, 0.08, 0.8);
      break;
    case 'respawn': // soft rising arpeggio
      [523.25, 659.25, 784, 1046.5].forEach((f, i) => {
        sweep(out, sr, i * 0.09, f, f, 0, 0.02, 0.35, 0.5);
        sweep(out, sr, i * 0.09, f * 2.001, f * 2.001, 0, 0.02, 0.15, 0.12);
      });
      break;
    case 'levelup': // skill level-up: a bright rising arpeggio landing on a bell chord
      [523.25, 659.25, 784, 1046.5, 1318.5].forEach((f, i) => {
        sweep(out, sr, i * 0.07, f, f, 0, 0.005, 0.18, 0.45);
        sweep(out, sr, i * 0.07, f * 2.001, f * 2.001, 0, 0.005, 0.08, 0.1);
      });
      for (const f of [1046.5, 1318.5, 1568]) knock(out, sr, 0.375, [[f, 0.55, 0.35], [f * 2.76, 0.15, 0.08]]);
      break;
    case 'click':
      sweep(out, sr, 0, 1500, 1100, 0.02, 0.0005, 0.008, 1);
      break;
    case 'warn': // a hazard is telegraphed: a soft rising two-voice tone
      sweep(out, sr, 0, 440, 760, 0.34, 0.03, 0.22, 0.8);
      sweep(out, sr, 0, 660, 1140, 0.34, 0.03, 0.16, 0.25);
      break;
    case 'shard': // a volley fires: a short glassy tick
      knock(out, sr, 0, [[2350 * v, 0.03, 0.6], [3720 * v, 0.02, 0.35], [5450 * v, 0.012, 0.2]]);
      noise(out, sr, rand, 0, () => 6000, 'high', 0.9, 0.0005, 0.006, 0.35);
      break;
    case 'shatter': { // phase change, clear or defeat: a cascade of glass partials over a breaking crunch
      noise(out, sr, rand, 0, (t) => 5200 - t * 3000, 'high', 0.8, 0.001, 0.08, 0.7);
      for (let i = 0; i < 7; i++) {
        const f = 1700 + rand() * 2600;
        knock(out, sr, i * 0.045 + rand() * 0.02, [[f, 0.18, 0.5], [f * 2.32, 0.08, 0.2], [f * 3.9, 0.04, 0.1]]);
      }
      sweep(out, sr, 0, 180, 70, 0.2, 0.002, 0.12, 0.35);
      break;
    }
    case 'skitter': // a beetling swarm: dry chitinous clicks
      for (let i = 0; i < 16; i++) {
        const start = (i / 16) * 0.44 + rand() * 0.02;
        knock(out, sr, start, [[2800 * v + rand() * 900, 0.006, 0.6], [5200 * v, 0.003, 0.25]]);
        noise(out, sr, rand, start, () => 4200, 'band', 2.2, 0.0005, 0.004, 0.35);
      }
      break;
    case 'crash': // Clatterhorn flips onto its back: a heavy thump, a shell crunch and a hollow knock
      sweep(out, sr, 0, 95, 36, 0.22, 0.002, 0.18, 1);
      noise(out, sr, rand, 0, (t) => 1800 - t * 2500, 'low', 0.9, 0.002, 0.07, 0.8);
      knock(out, sr, 0.02, [[230, 0.09, 0.45], [520, 0.05, 0.3], [1150, 0.025, 0.15]]);
      break;
  }
  return normalize(out, PEAK[name]);
}

export const AMBIENT_SECONDS: Record<AmbientName, number> = { ocean: 8, wind: 11 };

/**
 * A seamless ambient loop. Ocean: brown-ish noise under a low-pass whose level
 * swells twice per loop (waves rolling in). Wind: band-passed noise with a slow
 * gusting centre. The tail is crossfaded into the head so the loop has no seam.
 */
export function renderAmbient(name: AmbientName, sr: number): Float32Array {
  const seconds = AMBIENT_SECONDS[name];
  const n = Math.floor(seconds * sr), xfade = Math.floor(0.6 * sr);
  const raw = new Float32Array(n + xfade);
  const rand = rng(name === 'ocean' ? 1234 : 5678);
  const f = new Svf(sr), g = new Svf(sr);
  let brown = 0;
  for (let i = 0; i < raw.length; i++) {
    const x = (i % n) / n; // loop phase, so the modulation is periodic
    const white = rand() * 2 - 1;
    if (name === 'ocean') {
      brown = brown * 0.985 + white * 0.15;
      const swell = Math.pow(0.5 - 0.5 * Math.cos(TAU * 2 * x), 1.6);
      f.run(brown, 300 + 900 * swell, 0.6);
      g.run(white, 1800 + 1500 * swell, 0.8); // foam hiss on each break
      raw[i] = f.low * (0.25 + 0.75 * swell) + g.band * 0.06 * swell * swell;
    } else {
      const gust = 0.5 + 0.3 * Math.sin(TAU * x) + 0.2 * Math.sin(TAU * 3 * x + 1);
      f.run(white, 500 + 700 * gust, 2.5);
      raw[i] = f.band * (0.3 + 0.7 * gust);
    }
  }
  const out = raw.subarray(0, n).slice();
  for (let i = 0; i < xfade; i++) {
    const w = i / xfade;
    out[i] = out[i] * w + raw[n + i] * (1 - w);
  }
  return normalize(out, name === 'ocean' ? 0.5 : 0.25);
}
