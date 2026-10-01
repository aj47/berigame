# Adventure art v1

Thirteen original low-poly assets for the giant berry adventures: the gardener,
Moss, Pip, the Berry Giant, market, feast table, workshop, workshop construction
site, handcart, giant berry, strange seed, leaf cover and scent bait.

The two human NPCs extend the repository's original cropped adventurer rig.
Their hats, apron, beard and porter pack are skinned to that rig. Every other
mesh is authored by `build_assets.py`; no downloaded models or textures are used.
Each asset has an editable `.blend` source here and a runtime `.glb` in
`frontend/public/models/adventure/`. `manifest.json` records geometry and bytes.
The complete runtime set is about 2.1 MB, with at most 4,984 triangles per asset.

## Rebuild and review

Run from the repository root in a separate background Blender process:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python docs/art/adventure-v1/build_assets.py
npm run dev --prefix frontend -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/adventure-art-review.html` to inspect the cast, props,
all eight emotes, the three player hairstyles and fruit-carrying poses. This
review entry is not shipped in the production build. Screenshots alongside this
file record the browser review.

## Animation and integration

- Gardener and Moss retain the original 60 fps Idle/Walk actions. Moss also gets
  the same two-handed carry pose as players, preserving the walking cycle.
- Pip's named head, tail and legs support sniffing, a wag and a trot. The Giant
  breathes, looks around, rests and lumbers. These animations live in
  `AdventureModels.tsx`; they are not baked into the creature GLBs.
- NPC root movement interpolates server steps. Cargo follows the displayed
  carrier, so it stays in their arms between server updates.
- `animation/emotes.ts` synthesizes Wave, Cheer, Sit, Point, Dance, Laugh, Bow and
  Shrug from the existing player skeleton. All three hairstyles use these clips.
- The game puts weapons away during carrying. Armed poses resume when a weapon
  is equipped again. Normal emote and gameplay validation remains server-side.
- Materials and geometry stay in the shared asset cache; each actor owns its
  skeleton and animation mixer. Static props do not animate each frame.

Pose tests cover joint finiteness, foot clearance, recognisable gestures, moving
legs while carrying, and returning from a carry pose to an armed walking pose.
The social UI test covers all eight choices and keyboard priority over quick slots.

## Verified 2026-09-30

- 567 tests passed: 314 shared simulation, 238 frontend and 15 agent API.
- Shared, SpacetimeDB, agent API and Worker type checks passed; production build
  and `git diff --check` passed.
- Browser review covered all 13 models, all eight emotes, three player hairstyles,
  carry poses, and the live UI at desktop, 390×844 and 568×320.
- All 13 deployed GLBs matched the local files byte for byte. Each new emote was
  accepted by the live server. A fresh agent completed a four-berry delivery and
  its QA session was closed afterwards.
- Beta deployment: `c8cca47b-3795-43e4-9c5b-dbd8a493d9df` at
  `https://beta.berigame.com`. Final API check returned 200 and `ready: true`.
