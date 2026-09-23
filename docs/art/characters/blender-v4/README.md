# Starter adventurer V4: movement and readable exchanges

The body and cosmetics are unchanged from V3: 1,970 / 1,984 / 2,088 triangles, one material, 26 bones, 64x64 atlas. Non-hair vertex/normal/UV/skin data is exactly identical to V3. Animation data is identical across all three V4 hair variants.

Seventeen clips include faster Run/RunGrab/RunGuard locomotion, a reaching/closing/pulling Grab, compact Guard, Block, BlockCounter and a paired Grabbed reaction. The previous foot cycle moved the lifted foot backward; V4 reverses the fore/aft phase and opposes the arm swing. Three.js sampling of exported Foot.L shows forward travel during its raised phase and backward travel during stance. Exported stance travel is approximately 0.6404 units per 0.3333 seconds; runtime cadence uses speed / 1.92, capped at2.5 for diagonal travel. Stance-specific running retains readable hands while moving.

Combat presentation uses both committed event stances and the RPS winner. Strike interrupts a grab; Grab closes on the guard and pulls the opponent forward; Guard braces and ripostes against an incoming Strike. Defender victories use the same physical sequence with roles swapped. Reaction and damage-number timing follows contact; healing does not overwrite combat cues. Same-stance draws animate both actors without a damaging recoil. The authoritative rules and600ms combat/harvest clock are retained.

Build each variant with Blender in an isolated background process:

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python docs/art/characters/blender-v4/build_character.py -- --hair=tousled

Use --skip-renders for the other hair IDs. Run verify_variants.py to compare body/animation signatures. The browser viewer uses the game's Three.js0.149.0; web-validation.json records finite deformation, floor clearance and extent checks for all17 clips plus sampled exported foot positions. Paired screenshots show four stages of each winning exchange at cardinal melee spacing; actual game checks live under docs/art/game-review/motion-v4 and combat-v4. Desktop browser evidence does not qualify physical-phone performance.
