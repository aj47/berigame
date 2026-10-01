#!/usr/bin/env node
/**
 * Build the shipped adventurer GLBs (frontend/public/models) from the Blender
 * sources kept in docs/art/characters/blender-v4/<hair>/.
 *
 *   npm run models:optimize            # rebuild all four
 *   npm run models:optimize -- --check # fail if a shipped GLB is out of date
 *
 * Steps, deliberately NOT gltf-transform's default optimize():
 *   1. drop per-clip rest-pose channels (constant and equal to the node's rest
 *      TRS): the same rule as runtime animation/pruneClips.ts, done once here
 *      instead of on every load;
 *   2. resample: drop keys that linear interpolation reproduces (1e-5);
 *   3. dedup + prune (joints and leaf bones kept);
 *   4. quantize vertex attributes (KHR_mesh_quantization);
 *   5. meshopt-compress buffers (EXT_meshopt_compression; drei's useGLTF
 *      registers the decoder by default).
 * No simplify, weld or texture recompression: the low-poly silhouette, the
 * flat-shaded split normals and the 64x64 atlas are authored exactly.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const SOURCES = [
  ['tousled', 'starter-adventurer.glb'],
  ['cropped', 'starter-adventurer-cropped.glb'],
  ['topknot', 'starter-adventurer-topknot.glb'],
  ['bald', 'starter-adventurer-bald.glb'],
];
const EPS = 1e-5;

const rest = (node, path) => (path === 'translation' ? node.getTranslation() : path === 'rotation' ? node.getRotation() : node.getScale());
/** Constant for the whole clip and equal to the rest value (q and -q are the same rotation). */
function isRestChannel(channel) {
  const out = channel.getSampler().getOutput().getArray();
  const value = rest(channel.getTargetNode(), channel.getTargetPath());
  const n = value.length, quat = channel.getTargetPath() === 'rotation';
  let same = true, negated = quat;
  for (let i = 0; i < out.length && (same || negated); i += n) {
    for (let c = 0; c < n; c++) {
      if (Math.abs(out[i + c] - value[c]) > EPS) same = false;
      if (Math.abs(out[i + c] + value[c]) > EPS) negated = false;
    }
  }
  return same || negated;
}

export async function optimize(input) {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(input));
  let removed = 0, kept = 0;
  for (const animation of doc.getRoot().listAnimations()) {
    for (const channel of animation.listChannels()) {
      if (channel.getTargetNode() && isRestChannel(channel)) {
        const sampler = channel.getSampler();
        channel.dispose();
        sampler.dispose();
        removed++;
      } else kept++;
    }
  }
  await doc.transform(
    resample({ tolerance: EPS }),
    dedup(),
    prune({ keepLeaves: true, keepAttributes: true, keepExtras: true }),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  // Deterministic output: no generator stamp that changes with the tool version.
  doc.getRoot().getAsset().generator = 'berigame optimize-models.mjs';
  return { bytes: Buffer.from(await io.writeBinary(doc)), removed, kept };
}

const check = process.argv.includes('--check');
let stale = 0;
for (const [hair, name] of SOURCES) {
  const src = resolve(repo, 'docs/art/characters/blender-v4', hair, `starter-adventurer-v4-${hair}.glb`);
  const dst = resolve(repo, 'frontend/public/models', name);
  const source = readFileSync(src);
  const t0 = performance.now();
  const { bytes, removed, kept } = await optimize(source);
  const ms = performance.now() - t0;
  const same = existsSync(dst) && createHash('sha256').update(readFileSync(dst)).digest('hex') === createHash('sha256').update(bytes).digest('hex');
  if (check) {
    if (!same) { stale++; console.error(`stale: ${name} (run npm run models:optimize)`); }
  } else writeFileSync(dst, bytes);
  console.log(JSON.stringify({ name, source: source.length, shipped: bytes.length, removedChannels: removed, keptChannels: kept, ms: Math.round(ms) }));
}
if (stale) process.exit(1);
