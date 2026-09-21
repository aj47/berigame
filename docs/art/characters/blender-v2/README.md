# Starter adventurer, V2

Original low-poly Blender character, integrated into BeriGame as `frontend/public/models/starter-adventurer.glb`.

- 1,970 triangles, one opaque material and embedded 64×64 palette atlas.
- 26 bones, maximum two skin influences per vertex.
- 461,952-byte GLB; reusable shared geometry/materials, separate skeleton per player.
- Twelve clips: Idle, Walk, Run, Stop, Turn, Strike, Grab, GrabReady, Guard, Hit, Stagger, Defeat.
- The game uses Walk, three combat actions, distinct GrabReady and Guard resting poses, hit reactions and defeat. Stop/Turn/Run are available for later animation refinement.
- Shared body shape and abilities. Hair/outfit customization and equipment are future work.

V2 replaces V1's separate finger tubes with a connected palm/finger mass and two bend segments. Thumb placement is on the correct radial side; Strike fists close, Grab palms oppose, and Guard leaves the eyes visible. The robe has thigh clearance. Collar trim follows the shirt's triangles and skin weights.

Rebuild with an isolated Blender process:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python docs/art/characters/blender-v2/build_character.py
```

The build creates the editable `.blend`, exported `.glb`, palette, metrics, and standard pose previews. `hand-review/` contains front/side/rear critique evidence. Copy the GLB into the public model directory after review.

To inspect the exported asset with the game's installed Three.js version:

```sh
python3 docs/art/characters/blender-v2/serve_review.py --three frontend/node_modules/three --port 8767
```

Open `http://127.0.0.1:8767/viewer.html`. The viewer is an asset check; the playable game and integrated rendering checks provide separate evidence. Physical-phone performance remains unqualified.
