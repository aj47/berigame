# Starter adventurer V4: movement and readable exchanges

The body and cosmetics are unchanged from V3: 1,970 / 1,984 / 2,088 triangles, one material, 26 bones, 64x64 atlas. Non-hair vertex/normal/UV/skin data is exactly identical to V3. Animation data is identical across all three V4 hair variants.

Seventeen clips include faster Run/RunGrab/RunGuard locomotion, a reaching/closing/pulling Grab, compact Guard, Block, BlockCounter and a paired Grabbed reaction. The previous foot cycle moved the lifted foot backward; V4 reverses the fore/aft phase and opposes the arm swing. Three.js sampling of exported Foot.L shows forward travel during its raised phase and backward travel during stance. Exported stance travel is approximately 0.6404 units per 0.3333 seconds; runtime cadence uses speed / 1.92, capped at2.5 for diagonal travel. Stance-specific running retains readable hands while moving.

Combat presentation uses both committed event stances and the RPS winner. Strike interrupts a grab; Grab closes on the guard and pulls the opponent forward; Guard braces and ripostes against an incoming Strike. Defender victories use the same physical sequence with roles swapped. Reaction and damage-number timing follows contact; healing does not overwrite combat cues. Same-stance draws animate both actors without a damaging recoil. The authoritative rules and600ms combat/harvest clock are retained.

Build each variant with Blender in an isolated background process:

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python docs/art/characters/blender-v4/build_character.py -- --hair=tousled

Use --skip-renders for the other hair IDs. Run verify_variants.py to compare body/animation signatures. The browser viewer uses the game's Three.js0.149.0; web-validation.json records finite deformation, floor clearance and extent checks for all17 clips plus sampled exported foot positions. Paired screenshots show four stages of each winning exchange at cardinal melee spacing; actual game checks live under docs/art/game-review/motion-v4 and combat-v4. Desktop browser evidence does not qualify physical-phone performance.

## V5 rebuild (model batch 2)

This is the same script with these additions:

- **Stick socket.** A `Prop.R` socket bone brings the rig to 27 joints. The stick is skinned into the body mesh. The GLB gives PropR a rest scale of 0, so the stick is hidden. The game scales PropR to 1 while `player.weapon` is `stick`.
- **New baked clips:**
  - `StickSwing`: 0.617 s, impact at 0.300 s. It is a whole-body chop: wind-up, lead-foot step, hips-to-chest-to-wrist uncoil, follow-through.
  - `StickIdle`, `StickRun` and `HitHeavy`.
- **Re-authored clips:**
  - `Run`: a 0.6 s cycle. The feet stay planted at 3.3 units/s, and there is an airborne phase.
  - `Strike`: wind-up, snap, hold, then overshoot.
  - `Hit`: peaks at 55 ms and steps back.
  - `Defeat`: an accelerating fall with a bounce.
- **Faces and hair:**
  - Eyes are 1.5x larger, with catchlights and hair-coloured brows.
  - The tousled fringe locks sit above the brows.
  - Cropped and topknot get a broken hairline and sideburns.
  - The topknot is bigger.
- **Palette.** Trouser cells 12-14 are lighter; the same change is in `frontend/src/appearance/palette.ts`. Cells 24-27 hold the stick colours.
- **Keys.** Keys are baked at 60 fps. Attacks, hits and Defeat get a key every frame; other clips get one every other frame. Only rotations are keyed, plus the Hips location.

The preview PNGs in the variant folders are still the V4 renders, because this build used `--skip-renders`. The review media is in `docs/art/game-review/model-batch2/`.

Linux build (no Blender install; bpy comes from PyPI):

    uv venv --python /usr/bin/python3.13 venv-bpy && uv pip install --python venv-bpy bpy==5.2.1
    venv-bpy/bin/python docs/art/characters/blender-v4/build_character.py --hair=tousled --skip-renders [--out=DIR] [--fps=60]
    python3 docs/art/characters/blender-v4/verify_variants.py   # --joints=27; animation compared within 1e-4

Copy `tousled/starter-adventurer-v4-tousled.glb` to `frontend/public/models/starter-adventurer.glb`, and the cropped and topknot GLBs to `starter-adventurer-{cropped,topknot}.glb`.

## Animation batch 3

- **New clips:** `StickStop` (the armed Stop), `HitBack` (a hit from behind: the body pitches forward, the chest arches, the lead foot steps forward and the arms fling back) and `GetUp` (1.1 s from the Defeat end pose back to standing, played on respawn).
- **Knees:** the thigh and upper shin are now one continuous trouser tube with three knee edge loops, weighted Thigh/Shin 85/15, 50/50 and 15/85. This removes the knee shards in Defeat. It adds 40 triangles: 2,171 / 2,186 / 2,290.
- **Previews:** the preview PNGs are refreshed. They are rendered at 60 fps frame numbers, and the stale V4 renders were removed.
- **Shipped GLBs:** copy them with `cd frontend && npm run models:optimize`, not by hand. The script prunes rest channels, resamples, dedups, prunes, quantizes and applies meshopt. It writes `frontend/public/models/*.glb`, and `--check` fails when those files are stale.

Smooth-face pass: the skull, neck side and bare-forearm skin quads are shaded smooth (poly.use_smooth) and the skull uses one skin cell (7); ears, eyes, brows, hair, clothing, hands and stick stay flat. Review media: docs/art/game-review/smooth-face/.

Smooth-body pass: every face except the stick is now shaded smooth (skin, robe, sleeves, trousers, boots, hands, ears, hair), with `mesh.set_sharp_from_angle(62 deg)` keeping creases above 62 degrees hard. The 8-sided limb tubes (45 deg) and 12-sided skull stay round; boot soles/tops, belt and buckle, cuff/collar lips, palm ends and hair-lock ridges stay crisp, and open borders (robe hem, sleeve and trouser ends) are naturally hard. The stick stays flat. Triangles (2,171 / 2,186 / 2,290), 27 bones, 1 material, palette cells and animations are unchanged; shipped GLBs shrink about 11 KB each (fewer normal splits). Review media: docs/art/game-review/smooth-body/.
