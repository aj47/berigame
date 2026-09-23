# Starter adventurer cosmetic hair variants

Three complete GLBs preserve the V2 character and add genuinely different hair geometry. Load one selected avatar, rather than loading all three onto the same body.

| Hair ID | Shape | Triangles |
| --- | --- | ---: |
| `tousled` | Original asymmetric fringe and angular locks | 1,970 |
| `cropped` | Snug short cut following the actual head facets | 1,984 |
| `topknot` | Snug cut with a compact tied knot on the rear crown | 2,088 |

Each variant is under `<hair-id>/starter-adventurer-v3-<hair-id>.glb`, with a matching `.blend`, palette PNG, metrics, full-character pose renders and four close-up hair views. They all use one material, one 64x64 palette atlas, 26 bones and the same 12 named animation clips. Hair uses only the existing Head bone; there is no simulation.

`variant-verification.json` records exported GLB hashes and proves exact equality of all non-hair vertex positions, normals, UVs, joint indices and skin weights, plus every animation sample. Run `python3 docs/art/characters/blender-v3/verify_variants.py` from the repository root to reproduce the comparison. Use one fixed avatar scale and collision shape for all variants; never scale a topknot character down based on its taller cosmetic bounds.

## Recolor contract

`customization-manifest.json` includes exact atlas cell rectangles and both Blender and glTF UV centers. PNG pixel coordinates start at the top left. The manifest catalogs are aligned with `shared/sim/appearance.ts`; serialized choices are numeric catalog indices, not local preset names.

- Robe: cells 0, 1, 2; reference cell 0.
- Wraps, sleeve cuffs and collar trim: cells 3, 4, 5; reference cell 3.
- Skin: cells 6, 7, 8, 22; reference cell 7.
- Hair: cells 16, 17, 18; reference cell 17.
- Preserve eyes (19), boots, belt and trousers.

Recolor each family using original-cell RGB ratios against its reference color and the selected catalog base. Cache the resulting texture/material by appearance tuple. Never mutate the shared GLTF-loader texture in place. Retain the original map's sampling/wrapping settings; glTF canvas replacement textures need `flipY=false` and sRGB color space.

## Rebuild

Run Blender in an isolated background process, for each hair ID:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python docs/art/characters/blender-v3/build_character.py -- --hair=cropped
```

To regenerate hair close-ups, open that variant's blend in background mode with `--python docs/art/characters/blender-v3/render_hair_review.py`.

## Review boundary

The first cropped prototype exposed scalp strips and a helmet-like front overhang. The final cut is clipped from the actual convex head facets and offset slightly outward, removing those defects. The knot overlaps the crown rather than hovering above it. Default-palette front, side, back and overhead renders are the asset evidence. The variants are now copied to `frontend/public/models/` and integrated with the Style panel. Runtime recolors, preview isolation and persistence passed Chrome and WebKit checks in `docs/art/game-review/wardrobe/`; actual phone performance still requires hardware qualification. Cosmetic hair and colors do not alter mechanics.
