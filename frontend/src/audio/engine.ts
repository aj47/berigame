import { AMBIENT, SFX, VARIANTS, renderAmbient, renderSound, type AmbientName, type SfxName } from './synth';
import { DEFAULT_AMBIENT_VOLUME } from './defaults';

/**
 * A small Web Audio engine: pre-rendered procedural buffers (synth.ts), three
 * buses (master -> sfx / ambient), distance attenuation from a listener point
 * on the ground, a voice cap and per-sound throttles.
 *
 * Nothing exists until unlock() runs from a user gesture (autoplay policy):
 * before that, play() is a cheap no-op. play() allocates only the two Web
 * Audio nodes a one-shot needs; the per-frame path (setListener) allocates
 * nothing.
 */

export interface Volumes { masterVolume: number; sfxVolume: number; ambientVolume: number; muted: boolean; }
export interface PlayOptions {
  /** Level before attenuation, 0..1+. */
  volume?: number;
  /** Start this long from now (e.g. a blow's impact time). */
  delayMs?: number;
  /** Ground position of the source; omitted = non-positional (UI, own actions). */
  x?: number;
  z?: number;
  /** Playback-rate jitter (+-), for variety. */
  detune?: number;
}

/** Full level within REF_DISTANCE of the listener, silent beyond MAX_DISTANCE. */
export const REF_DISTANCE = 4;
export const MAX_DISTANCE = 28;
export const MAX_VOICES = 24;
/** A sound is not restarted sooner than this after itself (ms), e.g. a crowd's footsteps. */
export const MIN_INTERVAL_MS: Partial<Record<SfxName, number>> = { footstep: 35, click: 30, rustle: 250, whoosh: 30 };
const SILENT = 0.004;

/** Full level near the listener, inverse-distance beyond, silent at MAX_DISTANCE. */
export function attenuation(distance: number): number {
  if (distance <= REF_DISTANCE) return 1;
  if (distance >= MAX_DISTANCE) return 0;
  // Inverse distance (gentle, like a real point source), faded to 0 over the last 25%.
  const edge = Math.min(1, (MAX_DISTANCE - distance) / (MAX_DISTANCE * 0.25));
  return (REF_DISTANCE / distance) * edge;
}

export function busLevels(v: Volumes): { master: number; sfx: number; ambient: number } {
  const clamp = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
  return { master: v.muted ? 0 : clamp(v.masterVolume), sfx: clamp(v.sfxVolume), ambient: clamp(v.ambientVolume) };
}

type ContextFactory = () => AudioContext;

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambientBus: GainNode | null = null;
  private readonly buffers = new Map<SfxName, AudioBuffer[]>();
  private readonly roundRobin = new Map<SfxName, number>();
  private readonly lastPlayed = new Map<SfxName, number>();
  private ambientStarted = false;
  /** Voices started and not yet ended. */
  active = 0;
  /** One-shots scheduled since unlock (diagnostics). */
  plays = 0;
  listenerX = 0;
  listenerZ = 0;
  private volumes: Volumes = { masterVolume: 0.8, sfxVolume: 1, ambientVolume: DEFAULT_AMBIENT_VOLUME, muted: false };
  private readonly onEnded = () => { this.active = Math.max(0, this.active - 1); };

  constructor(private readonly factory: ContextFactory, private readonly clock: () => number = () => performance.now()) {}

  get unlocked(): boolean { return this.ctx !== null && this.ctx.state === 'running'; }

  /** Create (first call) and resume the context. Call from a user gesture handler. */
  unlock(): void {
    if (!this.ctx) {
      let ctx: AudioContext;
      try { ctx = this.factory(); } catch { return; } // no Web Audio: stay silent
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.sfxBus = ctx.createGain();
      this.ambientBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.ambientBus.connect(this.master);
      this.master.connect(ctx.destination);
      this.applyVolumes(true);
      const sr = ctx.sampleRate;
      for (const name of SFX) {
        const list: AudioBuffer[] = [];
        for (let v = 0; v < VARIANTS[name]; v++) list.push(this.toBuffer(renderSound(name, sr, v)));
        this.buffers.set(name, list);
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    this.startAmbient();
  }

  private toBuffer(samples: Float32Array): AudioBuffer {
    const buffer = this.ctx!.createBuffer(1, samples.length, this.ctx!.sampleRate);
    buffer.getChannelData(0).set(samples);
    return buffer;
  }

  private startAmbient(): void {
    if (this.ambientStarted || !this.ctx) return;
    this.ambientStarted = true;
    const ctx = this.ctx;
    for (const name of AMBIENT as readonly AmbientName[]) {
      const source = ctx.createBufferSource();
      source.buffer = this.toBuffer(renderAmbient(name, ctx.sampleRate));
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = name === 'ocean' ? 0.9 : 0.55;
      source.connect(gain); gain.connect(this.ambientBus!);
      source.start(ctx.currentTime + (name === 'wind' ? 0.7 : 0));
    }
  }

  setVolumes(v: Volumes): void {
    this.volumes = { masterVolume: v.masterVolume, sfxVolume: v.sfxVolume, ambientVolume: v.ambientVolume, muted: v.muted };
    this.applyVolumes(false);
  }

  private applyVolumes(immediate: boolean): void {
    if (!this.ctx) return;
    const levels = busLevels(this.volumes);
    const t = this.ctx.currentTime;
    for (const [node, value] of [[this.master!, levels.master], [this.sfxBus!, levels.sfx], [this.ambientBus!, levels.ambient]] as const) {
      if (immediate) node.gain.value = value;
      else node.gain.setTargetAtTime(value, t, 0.03); // ramp: no zipper noise on a slider
    }
  }

  /** Where the camera looks (the local player), in ground coordinates. Called every frame: allocates nothing. */
  setListener(x: number, z: number): void { this.listenerX = x; this.listenerZ = z; }

  /** The level a sound would play at, after distance, or 0 if it would be dropped as inaudible. */
  levelFor(volume: number, x?: number, z?: number): number {
    let level = volume;
    if (x !== undefined && z !== undefined) level *= attenuation(Math.hypot(x - this.listenerX, z - this.listenerZ));
    return level < SILENT ? 0 : level;
  }

  /** Schedule a one-shot. Returns whether it was scheduled (false: locked, muted, inaudible, throttled or voice cap). */
  play(name: SfxName, options: PlayOptions = {}): boolean {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.volumes.muted) return false;
    const level = this.levelFor(options.volume ?? 1, options.x, options.z);
    if (level === 0) return false;
    const delayMs = Math.max(0, options.delayMs ?? 0);
    const due = this.clock() + delayMs;
    const min = MIN_INTERVAL_MS[name];
    if (min !== undefined) {
      const last = this.lastPlayed.get(name);
      if (last !== undefined && Math.abs(due - last) < min) return false;
    }
    if (this.active >= MAX_VOICES) return false;
    const variants = this.buffers.get(name);
    if (!variants || variants.length === 0) return false;
    const index = (this.roundRobin.get(name) ?? 0) % variants.length;
    this.roundRobin.set(name, index + 1);
    this.lastPlayed.set(name, due);

    const source = ctx.createBufferSource();
    source.buffer = variants[index];
    const detune = options.detune ?? 0;
    if (detune) source.playbackRate.value = 1 + (Math.random() * 2 - 1) * detune;
    const gain = ctx.createGain();
    gain.gain.value = level;
    source.connect(gain); gain.connect(this.sfxBus!);
    source.onended = this.onEnded;
    this.active++;
    this.plays++;
    source.start(ctx.currentTime + delayMs / 1000);
    return true;
  }
}
