/**
 * Offline audition of the procedural sounds: renders a short tour (ambient
 * bed, footsteps, the three hits with their whooshes, harvest, find, craft,
 * eat, brambles, death, respawn, UI click) to a 16-bit mono WAV.
 *
 *   npx tsx src/audio/renderDemo.ts <out.wav>
 */
import { writeFileSync } from 'node:fs';
import { renderAmbient, renderSound, type SfxName } from './synth';

const SR = 22050;
const out = process.argv[2] ?? 'fx-audio-demo.wav';

const cues: [number, SfxName, number, number?][] = [];
let t = 0.6;
// Footsteps: a short run.
for (let i = 0; i < 8; i++) cues.push([t + i * 0.3, 'footstep', 0.8, i % 4]);
t += 3;
const blow = (hit: SfxName, lead: number) => { cues.push([t, 'whoosh', hit === 'punch' ? 0.5 : 0.8]); cues.push([t + lead, hit, 1]); t += 1.1; };
blow('punch', 0.12); blow('punch', 0.12); blow('stick', 0.23); blow('club', 0.23);
t += 0.3;
cues.push([t, 'pop', 0.9]); t += 0.55; cues.push([t, 'chime', 1]); t += 1.3;
cues.push([t, 'craft', 1]); t += 1.2;
cues.push([t, 'eat', 0.9]); t += 0.8;
cues.push([t, 'rustle', 0.9]); t += 0.9;
cues.push([t, 'thud', 1]); t += 1.1;
cues.push([t, 'respawn', 0.9]); t += 1.3;
for (let i = 0; i < 3; i++) cues.push([t + i * 0.25, 'click', 0.7]);
t += 1.5;

const length = Math.ceil(t * SR);
const mix = new Float32Array(length);
// Ambient bed at the default ambientVolume (0.6) under the default master (0.8).
const ocean = renderAmbient('ocean', SR), wind = renderAmbient('wind', SR);
for (let i = 0; i < length; i++) mix[i] += (ocean[i % ocean.length] * 0.9 + wind[i % wind.length] * 0.55) * 0.6;
for (const [at, name, volume, variant] of cues) {
  const s = renderSound(name, SR, variant ?? 0);
  const start = Math.floor(at * SR);
  for (let i = 0; i < s.length && start + i < length; i++) mix[start + i] += s[i] * volume;
}
const data = Buffer.alloc(44 + length * 2);
data.write('RIFF', 0); data.writeUInt32LE(36 + length * 2, 4); data.write('WAVE', 8);
data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
data.write('data', 36); data.writeUInt32LE(length * 2, 40);
for (let i = 0; i < length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix[i] * 0.8)) * 32767), 44 + i * 2);
writeFileSync(out, data);
console.log(`${out}: ${t.toFixed(1)}s, ${(data.length / 1024).toFixed(0)} KB`);
