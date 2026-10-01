# BeriGame — Little island. Giant adventures.

An original 40-second cinematic trailer, built from BeriGame’s own character and adventure assets. The film uses a separately staged Bramblewild-inspired set; it is a cinematic interpretation, not a recording of live gameplay.

## Deliverables

- `berigame-cinematic-trailer-1080p.mp4`: finished 1920×1080, 24 fps trailer with titles and stereo music/sound effects.
- `berigame-cinematic-trailer-textless-1080p.mp4`: clean version with music and effects, without title overlays.
- `berigame-cinematic.blend`: editable scene, cameras, lighting, cast and baked animation.
- `build_trailer.py`, `environment.py`, `render_frames.py`: reproducible scene, original set and resumable render.
- `titles/`: editable title generator, transparent overlays and timing manifest.
- `audio/`: original score, music/SFX stems, thirteen instrument stems, composition source and measured audio QA.
- `finish_trailer.py`: reproducible MP4 finishing and encoded-frame QA.

## Story

| Seconds | Scene |
|---|---|
| 0–4 | A small berry grows into a big possibility. |
| 4–8 | A cinematic view of the island. |
| 8–13 | A colorful little party carries their precious cargo. |
| 13–17 | Pip notices a snack. |
| 17–22 | A very large, very gentle friend appears. |
| 22–27 | The team crosses the brook. |
| 27–33 | Everyone gathers for a feast. |
| 33–40 | Cast reveal and BeriGame title. |

## Production

Original characters: three current player hairstyles with different appearance palettes, Pip, Moss, the gardener and the Berry Giant. Original game props: giant berry, strange seed, feast, market and workshop. Source models remain unchanged. The environment and camera choreography are authored for this trailer. No external music recordings, stock footage, or downloaded artwork are used.

The 40-second instrumental score “Small Friends, Great Big World” is newly composed and rendered using the built-in macOS orchestral sampler. Sound effects are synthesized. Details and loudness measurements are in `audio/README.md` and `audio/qa.json`.

## Rebuild

From repository root, using Blender 5.2.1, Python with Pillow, and FFmpeg:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python docs/trailer/berigame-cinematic-v1/build_trailer.py -- --mode=build --width=1920
/Applications/Blender.app/Contents/MacOS/Blender --background docs/trailer/berigame-cinematic-v1/berigame-cinematic.blend --python docs/trailer/berigame-cinematic-v1/render_frames.py -- --samples=32
python3 docs/trailer/berigame-cinematic-v1/finish_trailer.py
```

Walking animation uses a planted-foot gait matched to the actual travel speed, with continuous toe-off and landing curves.

The frame renderer resumes by skipping existing PNGs. Use a new `--out` directory when rendering changed animation, or pass `--resume=no` only for frames deliberately being replaced. `finish_trailer.py --check-only` validates sources without exporting. Exports are not published or deployed.

## Encoded verification

The master is 40.000 seconds, 1920×1080, 24 fps (960 frames), H.264 with 48 kHz stereo AAC. The full master decodes without errors. Encoded music measures −16.05 LUFS with a −1.24 dBTP true peak. The encoded contact sheet and exact last frame were visually checked. The opening 17 seconds also passed independent temporal checks, and the planted-foot animation was numerically checked in both walking scenes. `trailer-delivery.json` records the exported file hashes.

The complete 40-second export passed independent temporal QA: zero duplicate adjacent frames, no uniform frames after the intentional opening fade, and all seven camera cuts at 4/8/13/17/22/27/33 seconds. The latter half and exact final frame were visually inspected.
