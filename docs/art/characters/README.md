# Starter adventurer concept v1

Current implementation: [Blender V2 base and integration](blender-v2/README.md), plus [V3 cosmetic hair variants](blender-v3/README.md) and the in-game Style panel. The sections below record the earlier concept pass; live-game evidence is tracked in [playable graphics progress](../../PLAYABLE_GRAPHICS_PROGRESS.md).

Concept images, not Blender meshes, animation clips, or measured performance results.

## Agreed direction

- Classic fantasy, island starting area, room for later regions and fashionscape.
- One shared compact athletic body shape and rig. Mechanically equal characters initially.
- Minimal face; customizable hair and clothing; basic robes for beginners.
- Grounded movement; mastery through positioning and reading opponents.
- Hands initially; weapons, ranged attacks, and area attacks later.
- Preserve the current camera. Controls should work across touch, controller, and mouse without large platform advantages.

## Proposed visual implementation

Muted blue split-hem robe, cream collar/cuffs/wraps, brown belt and boots, charcoal trousers. Short polygonal brown hair and medium tan skin are a sample appearance, not restrictions on future customization. Keep legs visible and sleeves clear of the hands. No cape, simulated cloth, or hair physics in the first model.

## Files and review

- `starter-adventurer-turnaround-v1.png`: front, side, back modeling reference.
- `starter-adventurer-combat-poses-v1.png`: Strike, Grab, Guard from left to right, with corresponding silhouette studies below.
- `starter-adventurer-combat-small-v1.png`: 192x128 sheet; individual characters approximately 60 pixels tall. Downsampled with ImageMagick Lanczos for visual review.
- `generation-prompts.md`: exact built-in imagegen prompts and reference roles.

The static small preview retains the main pose differences: single extended punch, double open-handed reach, compact raised guard. Fine finger details disappear at this size; the animation must communicate through arm separation and torso shape. Generated silhouette rows are illustrative, not pixel-exact masks of the colored row.

The camera controller was inspected; it supports orbit/zoom and follows the player. The concept uses an approximate elevated view, not a captured projection from the running game. The colored pose study is relatively shallow; test the eventual rig from higher and rear viewing angles as well. No in-game readability, animation timing, geometry cost, draw-call count, or smartphone performance has been validated.

## Blender handoff

Build one base mesh and shared skeleton before expanding the wardrobe. Use a small atlas and few materials, large clothing shapes, and simple skinning. Simplify the concept's hair facets, fingers, and wrap details as needed. Model robe panels with enough clearance for running and lunging; avoid relying on cloth simulation.

First animation pass: idle, run, stop, turn, strike, grab, guard, hit, stagger, defeat. These sheets show action key poses, not anticipation/recovery timings or persistent stance-idle poses. Those distinctions must be established against the existing combat logic before integration. Preserve equivalent gameplay timing across cosmetics.

Validate silhouette at actual game camera distances, from front/side/rear, and with multiple characters on a phone before declaring the model production-ready. No source integration or commits were performed for this concept pass.
