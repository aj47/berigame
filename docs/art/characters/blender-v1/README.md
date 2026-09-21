# Starter adventurer — Blender prototype v1

Original low-poly mesh and rig built from the approved BeriGame concept. This is a reviewable asset prototype, not a deployed character or a smartphone performance qualification.

## Open

- `starter-adventurer-v1.blend`: editable Blender 5.2.1 file, with mesh, rig, packed palette, actions and a presentation stage.
- `starter-adventurer-v1.glb`: character-only glTF binary; no camera, lights or ground.
- `animation-review.mp4`: browser playback of all 11 exported clips. The review viewer repeats even one-shot clips for inspection.
- `model-contact-sheet.png`: native renders of Idle, Strike, Grab and Guard, left to right.
- `viewer.html`: orbit/zoom, clip selection, wireframe and 1/16/32/64-character review controls. Requires local HTTP serving.

## Measured asset budget

| Property | Actual |
| --- | ---: |
| Triangles | 2,102 |
| Authoring vertices | 1,184 |
| Exported vertices after flat-normal/UV splits | 4,174 |
| Character mesh / glTF primitive | 1 / 1 |
| Character materials | 1 |
| Palette texture | 64 × 64 PNG, embedded |
| Skeleton bones | 24 |
| Maximum nonzero skin influences per vertex | 2 |
| GLB size | 436,300 bytes |

No cloth/hair simulation, runtime IK, subdivision, morph targets, or transparent materials. Fingers share a curl bone per hand; thumbs have their own bone. Robe panels have two bones. Authoring geometry uses disconnected, overlapping garment/body pieces within one mesh; it is not a watertight sculpt or a finished modular wardrobe.

## Animation library

| Clip | Duration | Intended use |
| --- | ---: | --- |
| Idle | 2.0 s | Loop |
| Run | 0.8 s | In-place loop |
| Walk | 1.2 s | In-place loop; shares gait with Run at a slower cadence |
| Stop | 0.5 s | Recovery prototype |
| Turn | 0.6 s | 90-degree pivot; rotates root, does not translate |
| Strike | 0.9 s | Single punch and return |
| Grab | 0.9 s | Two-handed reach and return |
| Guard | 1.0 s | Held defensive loop |
| Hit | 0.5 s | Recoil |
| Stagger | 0.8 s | Longer recoil prototype |
| Defeat | 1.2 s | Kneeling/slumped finish; clamp on completion |

These are first-pass motion clips. Stop, Turn and recoil need contextual blending in the eventual game integration. Strike/Grab key poses are deliberately different, but anticipation, impact markers, cancel windows and recovery have not been tied to authoritative combat ticks. Walk/Run speed must be matched to actual movement. Cosmetics must not change those timings.

Blender convention: Z up, -Y forward. Export: Y up, +Z forward. Overall character height is approximately 2.15 units. Validate scale and facing against the game before replacing its current avatar. The current game expects `Idle`, `Walk`, and `RightHook`; this asset uses `Strike`, so it is not a drop-in replacement without an explicit mapping.

## Verification performed

- Generated `.blend`, exported `.glb`, then loaded that GLB independently with Three.js GLTFLoader in desktop headless Chrome.
- All 11 clips were found at their intended durations, with one material, one primitive and 24 skin joints.
- Sampled 13 times in each clip and evaluated deformed vertices: all positions finite, no sampled geometry below the floor, and no exploding bounds. Lowest sampled vertex was about 0.0147 units above zero.
- Visually reviewed native renders and exported browser poses, including the corrected turn and kneeling defeat. Recorded a motion preview.
- Ran 32 independently animated copies: 67,266 triangles including the ground, 33 draw calls. A short isolated desktop sample reported roughly 60 fps. This is **not** a controlled benchmark, sustained thermal test, phone result, or complete-game test.
- Reviewer uses an already installed Three.js 0.183.2; the game declares 0.149.0. Actual game-runtime compatibility remains to be tested.

`metrics.json`, `web-validation.json` and their logs record the measurements. Fine finger detail intentionally disappears at distance. Robe/limb intersections, rear-angle readability, skinning polish and animation blends still require in-game review before production acceptance.

## Reproduce / review

Run the build in an isolated process, never in an unsaved user scene:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python build_character.py
python3 serve_review.py --three /path/to/existing/node_modules/three --port 8766
# Open http://127.0.0.1:8766/viewer.html
node verify_web.mjs /path/to/existing/node_modules/playwright/index.mjs
```

`build_character.py` writes only into this asset directory. It overwrites its own generated v1 outputs when rerun. No game source was changed, no current avatar was replaced, and no commit was created.
