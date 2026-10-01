# Bramblewild map

The square island is replaced with a continuous, curved coastline, sheltered coves, Starfall Pool, a winding brook, two wooden crossings, a rounded woodland boundary and rocky south-east headlands. Old Brook Mill has an animated waterwheel; Northwatch Beacon, Driftwood Harbour and Tumbledown Ruins give the routes recognisable destinations. Forest trunks and building footprints participate in server pathfinding. Existing berry, garden, expedition and raid locations remain usable.

`shared/sim/terrain.ts` is the source for land, water, bridges, trails, scenery footprints and ten named destinations. The minimap and agent API use the same map as the server. Clicking a destination on the expanded map starts walking; existing stick and stone-club progression still applies.

The 3D ground clips triangles against the continuous coastline. Ground, trails and beaches share one vertex-coloured mesh; the ocean shader samples a small coastal-distance texture. Forests, palms and ground cover are instanced. Models are procedural Three.js geometry, with no extra downloadable model files. The review page `/map-review.html` is Vite-only and excluded from the production bundle.

The server reconciles old saved positions onto nearby unblocked dry ground, preserving health, inventory, progression, drops, expiry times and expedition state. Tide-rock ids and cooldowns are preserved when their coordinates move. No database reset or schema change is required.

Validation covers complete land connectivity, every resource and novice destination, gardens, both crossings with the other bridge closed, equipment gates, pathfinding corner rules, agent-map parity and idempotent saved-state migration. Full shared, frontend and HTTP suites and type checks are also run. Preview screenshots document the visual result; the live beta is checked after deploy.

## Verified deployment — 2026-09-30

- Final Cloudflare version: `d122aea5-4036-476e-b2ea-8738efcedaec` at https://beta.berigame.com.
- 573 tests passed: 320 shared/server, 238 frontend, 15 HTTP. Four type checks and the production build passed. The final map-modal layering change also passed the 16 relevant UI/keyboard checks.
- Live agent walked across Millbridge to the west bank and Starfall Pool, harvested four berries, earned its first stick, and reached the beacon, harbour and ruins. A second check verified the final downstream crossing at `(17,22)`. Both temporary API sessions were revoked.
- Before and immediately after terrain deployment: 24 existing player records, 29 inventory rows, 8 garden plots. All saved player positions were on dry, unobstructed ground after migration. Subsequent smoke characters add their own rows.
- Desktop and 390×844 phone map reviewed. Millbridge was moved clear of the original berry tree/garden, the raid countdown reduced to fit the atlas, and the map modal moved above the emote HUD.
