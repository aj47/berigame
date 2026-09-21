# Playable graphics overhaul

Goal: a complete, polished, playable BeriGame with the new character, graphics and images; independently critique and iterate, starting with the visibly incorrect hands. Preserve classic fantasy beginner robes, mechanically equal characters, grounded movement, opponent-reading skill, and cross-platform usability. No commits or public deployment without further instruction.

## Acceptance checklist (outcomes recorded below)

- Connected, plausible hands and wrists in open/closed combat poses; independent review of exported gameplay views and transitions.
- Repaired model and new stance/item images integrated in actual gameplay, with matching loading state and animation mapping.
- Cohesive world, berry-type differentiation, readable combat effects, health/target/harvest/death state.
- Responsive UI and touch/keyboard alternatives for every gameplay action; no HUD/panel overlap at desktop, portrait phone and landscape sizes.
- Working movement, combat RPS/cooldowns, harvesting/interruption, eating, inventory/drop/pickup, death/respawn, chat and reconnect persistence on a real local authoritative server.
- Fix attack cooldown bypass, stance input-limit omission, inventory overflow duplication and destructive local startup fallback identified by independent audits.
- Recoverable loading/disconnection errors; a discoverable first-play path with meaningful combat experience.
- Relevant unit/server/browser tests; adversarial re-review of actual rendered evidence, not metrics alone.
- Integrated rendering/resource stability and actual smartphone verification. Desktop emulation is not proof of phone performance or input parity.

## Initial evidence

Branch `docs/asset-prompts-2d-ui`, starting commit `ab8306158c743c4a2fc7a0648b5f4197615638b7`. Existing character and icon deliverables are untracked. No game source modifications before this goal phase. V1 character has 2,102 triangles, one atlas/material, 24 bones; exported geometry loads, but hand anatomy and joined-arm appearance fail visual review.

The prior asset turn made progress (authored/exported/validated prototype); it did not establish integrated playability or final visual quality. This goal remains active while the requirements above lack authoritative evidence.

## Implemented and verified locally

- V2 adventurer integrated at `/models/starter-adventurer.glb`: 1,970 triangles, one material/64×64 atlas, 26 bones, 12 animations. Connected hands, correct thumb side, closed Strike fist, opposing Grab palms, distinct GrabReady, lowered Guard hands, fitted collar and robe clearance.
- All seven generated stance/berry PNGs used by the UI/world. The original off-white anchor, keyed raw assets, transparent 128px finals and contact sheet remain in `docs/art/` and the public asset folders.
- New low-poly berry trees, grass/sand/stone island materials, paths, low-cost instanced ground details, blob shadows, shared movement marker, and nearby canopy fading.
- Player names, a clear `You` marker and opponent target treatment. Character animation events, damage/healing feedback, defeat and respawn are visible in the live game.
- Touch-accessible Bag/Chat/Help, explicit item selection/actions, Stop, RPS reminders, nearest available berry-tree shortcut, combat target/recovery cue, responsive camera and Reset view.
- Current-state loading readiness; disconnected state cannot be hidden by a stale timeout. Failed model loads retain an actionable Rejoin screen. Chat keeps rejected messages in the input.
- Attack cooldown bypass, missing stance rate limit, overflow duplication and cancel-before-eating recovery bypass fixed. Local startup no longer retries a failed publish by deleting data.

## Verification

- 55 shared tests passed, including real reducer/storage regression cases and seven appearance validation/ownership/rate-limit cases. Shared and SpacetimeDB TypeScript checks passed.
- 51 frontend tests passed: inventory interactions, typing-safe controls, target timing, nearest-tree selection, connection readiness/recovery, scoped sign-ins, wardrobe preview/save/cancel, nameplate collision priorities, SDK identity encoding, world-delivery liveness and blocked-input behavior. Together with the shared suite, 106 tests pass.
- Production frontend build passed. Existing bundle-size/vendor-eval warnings remain; no build errors.
- Authoritative SDK smoke and two-browser UI checks passed movement, repeated attack cooldown, RPS combat, Stop, harvest, actual berry consumption/healing, drop/pickup, chat, token reconnect, exact death-carried loot, respawn and other-client loot recovery. Browser consoles were clean.
- Reviewed desktop, 390×844 and 360×740 portrait, 844×390 landscape. Fixed landscape inventory clipping, world labels above UI panels, phone chat wrapping, identity ambiguity and starting-resource discoverability.
- Blocking the GLB request produced the explicit graphics-failure message and a working Rejoin control instead of a blank application.
- Runtime screenshots and rendering report: `docs/art/game-review/`. Desktop phone emulation is not a physical-device benchmark.

## Local review runtime

The live frontend at `http://127.0.0.1:5173` uses the separate local database `berigame-graphics-review` on `127.0.0.1:3000`. The original `berigame` database was preserved. Local runtime data, signing keys, owner credentials and downloaded CLI are ignored under `.spacetime-data/`; they must not be committed or shared.

The review database can be updated without deletion using the isolated local CLI configuration:

```sh
.spacetime-data/tools/spacetimedb-cli --config-path .spacetime-data/graphics-review-cli.toml publish berigame-graphics-review --server http://127.0.0.1:3000 --delete-data=never --yes --module-path spacetimedb
```

Start the client against that database with `VITE_SPACETIME_DB=berigame-graphics-review npm run dev -- --host 127.0.0.1 --port 5173` from `frontend/`. The review runtime is local; no public deployment or commit was made.

## Remaining qualification and product scope

- Actual smartphone hardware, sustained thermals/battery, shipped Safari behavior and real network latency still require device qualification. Desktop WebKit gameplay checks passed; no physical phone was connected for this run. No claim of “perfect” or equivalent performance on all devices is justified by desktop emulation.
- Hair, skin, robe and wrap colors are now customizable. Additional garment shapes, gear progression, weapons, ranged/AoE and deeper movement mechanics remain future product work; the current game has mechanically equal characters and the authoritative RPS/harvest/inventory loop.
- The low-poly silhouette intentionally simplifies fingers and clothing. Further polish should be judged at the actual gameplay camera, not by adding geometry solely for close-up renders.

## Final integrated rendering and touch evidence

The immutable-source crowd run measured 32 online players on Apple M1 Pro: 59.0 FPS moving desktop and 58.5 FPS moving in 390px phone emulation; both p95 frame intervals were 16.8ms, with isolated intervals near 50ms. Renderer DPR was capped at 1.5 for the emulated high-DPR phone. Twenty-four actual movement clicks held geometry at 129 and textures at 33 after warming the scene. All 31 fixture connections were verified offline afterward. The report retains source/model hashes, raw ranges, outliers and limitations.

Touch checks passed all three stance selections, tap-to-move, live Gather, item selection and movement, readable chat wrapping, and visible landscape inventory actions, with no page errors. Screenshots and `mobile-validation.json` are in `docs/art/game-review/`. Exported GLB validation in the game's Three.js 0.149.0 passed all twelve animations with finite deformation, floor clearance and expected bounds.

Contact sheets: `docs/art/game-review/contact-sheet.png`, `docs/art/characters/blender-v2/stance-contact-sheet.png`, and the original seven-icon `docs/art/contact-sheet.png`.

Final screenshot critique found no blocking UI/visual defect. Two minor issues were corrected afterward: chat bubbles now anchor above their world point, and the landscape inventory helper sentence is shorter. These presentation-only edits follow the recorded crowd benchmark; its captured source hash is retained. The failed-model recovery test also verified that Rejoin succeeds after restoring the asset request.


## Customization and lifecycle follow-through

The Style panel now supports three hair meshes, six skin tones, four hair colors, five robe colors and three wrap colors. Unsaved previews affect only the local character; Cancel restores the saved look. Save persists through an additive, server-owned appearance table and broadcasts the same appearance to other clients. Catalog indices are persisted and must remain append-only. The reducer validates every field, enforces the input limit and does not alter combat statistics, timing or collision.

The three meshes contain 1,970 / 1,984 / 2,088 triangles, with one material each. They share exactly the same non-hair geometry, skeleton and twelve animation samples; see `docs/art/characters/blender-v3/variant-verification.json`. Colors use a reference-counted palette cache, and switching hair disposes private skeleton textures. The body scale and collider stay fixed across styles.

Chrome 153 and WebKit 26.5 each passed thirteen wardrobe checks, including actual-render preview isolation, remote-client saved appearance, all five persisted values after reload, 360px toolbar clearance, portrait actor visibility above the sheet and landscape action access. Screenshots and machine-readable reports are in `docs/art/game-review/wardrobe/`.

A separate WebKit gameplay pass verified touch stances, movement, harvest, inventory, chat and disconnect/rejoin persistence. A Firefox attempt stopped before navigation because installed browser and available automation driver protocols were incompatible; Firefox has not been qualified. See `docs/art/game-review/cross-browser/`.

Twelve lifecycle checks passed, including native Enter activation on focused buttons, same-identity tabs, chat focus, socket loss, legacy sign-in migration and explicit invalid-sign-in recovery with a retained backup. Credentials are scoped by server and world. Generic connection errors never automatically delete them. Evidence: `docs/art/game-review/lifecycle-validation.json`.


## Final readability and asset recovery

Overlapping names now prioritize You, then the current target, then other players with stable identity ordering. One batched check at 10 Hz hides colliding lower-priority labels without per-frame React state or interleaved layout reads/writes. Health, name, stance and chat anchors were raised 0.15 world units to clear the tallest hairstyle. Same-spawn, targeted-player and topknot evidence is in `docs/art/game-review/nameplates/`.

Five model-failure checks passed after the avatar refactor: a blocked optional hairstyle falls back to the starter mesh with a notice; Cancel restores the selected appearance and stance controls still work; a blocked required base model shows graphics failure with Rejoin; restoring the request and rejoining recovers the actual world. Expected request/React errors are recorded separately from unexpected errors (none). Evidence: `docs/art/game-review/model-failures/`.

The appearance resource run returned material, texture and palette-user counts exactly to baseline after 24 authoritative style changes and 24 preview/cancel cycles. A varied 32-player crowd also released its resources after all 30 created fixtures disconnected; the pre-existing player was left alone. This run measured 58 FPS desktop movement and 57.7 FPS in a 390px phone viewport on Apple M1 Pro. At 4× CPU throttle the development build measured 40.5 FPS moving, with a 233ms worst frame; it is not evidence of smooth phone gameplay. Source/model hashes and exact qualification limits are retained in `docs/art/game-review/appearance-render-validation.json`. The nameplate readability fix follows this frozen-source baseline; subsequent profiling is recorded separately.


## Measured CPU bottleneck and bounded fix

A 12-second diagnostic capture found 229 persisted player rows, of which 197 were offline. Repeated SDK identity-to-hex formatting consumed 27.4% of sampled time; local-player searches and appearance matching repeated this work for each visible avatar. The fix compares the SDK public numeric identity for matching, skips offline actors before constructing their render keys, and uses a WeakMap cache for the SDK's exact presentation encoding. Weak keys avoid retaining discarded identity objects, and cached values are invalidated if the public numeric identity changes. Gameplay rules and subscription visibility are unchanged.

Forty frontend tests pass, including full-u256 encoding/byte-order and changed-identity behavior. The production build succeeds with the previously documented vendor/bundle warnings. The diagnostic report and raw Chrome profile are in `docs/art/game-review/cpu-investigation/`; post-fix performance evidence is recorded separately from the original benchmark.


The post-fix development benchmark (`docs/art/game-review/appearance-optimized-render-validation.json`) preserved the 32-player varied-cosmetic workload: desktop and phone-viewport movement measured 60 FPS. Under 4× CPU throttle, moving performance improved from 40.5 to 55.5 FPS; p95 frame time improved from 50 to 16.8ms, and the worst frame from 233.3 to 100ms. Some residual hitches remain. The repeated appearance/crowd resource checks passed, source hashes stayed fixed during the measurement, and all 30 fixtures disconnected. These numbers describe this Mac and workload, not a promise for every phone.


## Production qualification

The optimized production bundle was exercised separately from Vite development mode, at `127.0.0.1:4175`, against the same local review database. The database held 291 persisted player rows, with 32 online for the measurement. At 390×844 with DPR3 (renderer cap1.5), moving performance was 60 FPS at normal CPU speed and 55.9 FPS at 4× CPU throttle. The throttled p95 was 16.8ms; p99 and maximum were 100ms. Residual movement hitches remain under throttling. Development debug globals were verified absent. Source and built-bundle hashes remained unchanged; no browser or fixture errors occurred.

Thirty temporary SDK connections, including the observer, and the test browser were closed. The isolated production preview was stopped; the primary review client on 5173 and local server on 3000 remain running. The authoritative count verified 29 fixture identities offline before the observer's final disconnect. Evidence and reproduction: `docs/art/game-review/production-render-validation.json`, `frontend/scripts/production-render-check.ts`.

This validates a local production browser workload on the Apple M1 Pro GPU. It does not qualify physical smartphones, sustained battery/thermal behavior, or internet latency. Those hardware/network acceptance items are not implied by “low poly” or by the desktop results. A subsequent completion audit also identified locally testable gesture and silent-stall coverage gaps; their outcomes follow below.

Final character/style contact sheet: `docs/art/game-review/character-style-contact-sheet.png`. Top row shows exported Blender previews; bottom row shows actual Chrome gameplay after the final identity/nameplate fixes. The final Chrome wardrobe run passed all thirteen checks with zero page errors.


## Completion audit: gestures and device availability

The earlier tap-based mobile checks did not cover camera gestures. A focused real-Chrome pass now verifies one-finger orbit, symmetric and anchored two-finger pinch, gesture cancellation, tap-to-move after those gestures and Reset view, mouse drag and wheel zoom. All eight checks passed with no unintended walking or page errors. Evidence and screenshot: `docs/art/game-review/gestures/`; reproduction: `frontend/scripts/gesture-check.mjs`. These are CDP touch gestures on a desktop browser, not hardware qualification.

Fresh read-only device checks found no ADB devices, no devices in `xcrun devicectl list devices`, and no named iPhone/iPad/Android/Pixel/Samsung USB device. Actual phone testing requires a connected device or user-supplied device results. No device installation, pairing, public deployment or commit was performed.


## Connection delivery and compact-screen fixes

A browser audit found that a transport could appear connected while world updates had stopped. A connection-wide watchdog now marks visible-world delivery stale after six seconds without an advancing tick; browser offline events warn immediately. Reducer wrappers reject inputs while offline, stale, disconnected or awaiting initial game data. The interruption screen offers Rejoin and explains that the authoritative world keeps running. An online event or reopened transport alone cannot clear a stale warning; fresh world delivery is required. Hidden/resume policy has a two-second grace period, with no per-tick React store writes while healthy.

The live browser run passed thirteen application assertions: offline and silent-stall warnings, no reducer frames from blocked keyboard inputs, fresh-tick recovery, working new inputs, preserved identity and inventory, and Rejoin. The raw harness ended with a timed-out native-close diagnostic on Playwright's routed WebSocket proxy; its proxy state/events could not establish native socket closure. The SDK disconnect callback, a second socket, advancing ticks and retained character state were observed. CDP's freeze request also failed to suspend foreground headless timers, so this is not proof of actual operating-system freezing. See `docs/art/game-review/network-lifecycle-fixed/assessment.json` alongside the preserved raw report. These limitations are not recorded as application passes. The final harness diagnostic adjustment has not been rerun.

Compact-layout checks exposed and fixed clipped Bag actions at 320×568, wardrobe boots behind the sheet, unusable panels at 568×320, a tablet portrait camera/layout mismatch, and incorrect camera zoom after rotating with Style open then cancelling. The tested 320, 390, 568, 640, 768 and 1024px layouts retain 44px action targets. Their measured bounds, screenshots and orientation regression evidence are in `docs/art/game-review/edge-viewports/`. The hidden ground-click marker also now exits before calculating its initially infinite age/scale.

After these changes, the root shared/frontend test run passed 55 + 51 = 106 tests. The explicit review-database production build passed with the previously documented dependency eval and bundle-size warnings. `git diff --check` passed; Git HEAD remained `ab8306158c743c4a2fc7a0648b5f4197615638b7`. No commits or public deployment were made.


The final production recheck after liveness and compact-layout changes used 32 online players and measured 59.8 FPS normally and 56.1 FPS at 4× CPU throttle on Apple M1 Pro, at 390×844 with DPR3 (renderer cap1.5). Both p95 intervals were 16.8ms; throttled p99 and maximum were 100ms, so occasional hitches remain. Source and bundle hashes stayed fixed, development globals were absent, no browser/fixture errors occurred, and all harness connections/browser were closed (29 crowd identities verified offline before observer disconnect). The temporary preview was stopped; the main review server/client remain available. Evidence: `docs/art/game-review/production-final-render-validation.json`. Preserve the earlier production report as its separate baseline. Neither result establishes physical-phone performance or real background suspension.


## V4 movement and exchange corrections

User playtesting found travel and gait too slow, unclear Grab/Guard attacks, backward foot motion, and periodic Guard flashes while moving. Movement now advances two individually validated grid steps per600ms tick instead of one (3.33 cardinal units/s), preserving the combat, harvest, eating and respawn clocks. Intermediate collision and interaction checks prevent corner cutting and overshoot. Client interpolation follows legal intermediate tiles and retains travel pose/yaw for120ms across small packet gaps.

The lifted foot previously traveled backward; the corrected cycle advances it forward and moves the planted foot backward. Cadence matches the exported stance-foot travel (~1.92 units/s at native playback), with separate Run, RunGrab and RunGuard clips that keep the hand silhouette readable. Seventeen clips now cover compact blocking, block-and-counter, a reaching/closing/pulling grab and its victim reaction. Body geometry remains exactly V3, with1,970/1,984/2,088 triangles across hairstyles, one material and26bones.

Combat visuals now use both authoritative event stance snapshots and the winner. Guard no longer replays its idle loop while dealing damage; Counter no longer overwrites the losing attack before it is visible. Both participants animate, then the victim reacts at contact. Damage numbers wait for that contact, and unrelated healing does not overwrite an exchange. Passive defenders face the incoming exchange. Same-stance clashes animate both actors without damaging recoil. RPS outcomes, cooldowns and damage values are unchanged.

Root verification passed63shared and64frontend tests (127total), the production build, and diff whitespace checks. The module was updated in the existing isolated review database with --delete-data=never. Export checks verified finite deformation/floor clearance for all17clips and exact shared body/animation data across hairstyles. The actual browser movement audit recorded1,844initial RAF samples with no idle flashes during central travel, followed by407samples at final calibrated cadence:338moving samples across all3stances, no backward-facing frames, no idle-while-moving frames and correct Stop→Guard behavior. Evidence and final video: docs/art/game-review/motion-v4/. Paired asset review and build sources: docs/art/characters/blender-v4/.


The V4 live combat harness passed36assertions across all9stance pairs: actual authoritative kind/stance snapshots, both opening clips, and all6damaging loser reactions. The diagonal Grab-vs-Guard case showed visible hand/upper-body contact in the reviewed camera, without an obvious air gap; this is a visual check, not a claim of exact geometric contact from every angle. Source hashes stayed fixed and browser errors were zero. Two fixture connections and the browser closed; fixture offline state was verified. Screenshots, video and RAF evidence are in docs/art/game-review/combat-v4/; reproduction is frontend/scripts/combat-animation-check.ts.

The private Tailscale build was refreshed at https://ajs-macbook-pro.tail67358c.ts.net:10443/ against the same preserved review database. HTTPS delivery matches the exact V4 hashes for all3hairstyles and the new production JS bundle. Existing Tailscale routes remain unchanged, with no Funnel or public deployment. No commits were made. Reload the page to replace an already-open old bundle.


The final V4 production crowd check (32online,390×844,DPR3 capped1.5) measured60FPS normally and55.1FPS at4×CPU throttle on Apple M1 Pro. Normal p95/max16.8ms; throttled p95 remained16.8ms with p99/max116.6/116.8ms, so throttled hitches remain. No browser/fixture errors occurred, source/bundle hashes stayed fixed, and all test connections/browser were closed. The temporary production preview and isolated asset viewer were stopped; main local game, database and private Tailscale static server remain running. Evidence: docs/art/game-review/production-motion-v4-render-validation.json. This remains desktop-host performance evidence.


## Quieter combat feedback

Removed floating CLASH, COUNTER and DEFEATED word labels. Clashes use a short pale-blue spark; counters keep only the damage amount in blue italic type; defeat is communicated by the existing animation. Harvest feedback is shortened to+1. The persistent HUD fight-state word becomes a colored shape (neutral circle, advantage diamond, disadvantage downward triangle), with accessible names retained. Overhead stance/state colors remain in place, and contact timing is preserved.

All64frontend tests passed, and production builds passed with the existing vendor/bundle warnings. The private Tailscale build was refreshed and its current JS/CSS verified over HTTPS. Browser visual presentation evidence is in docs/art/game-review/quiet-combat/; the probe uses synthetic FX on a fresh test character and is not a new authoritative-combat qualification. No server rules, commits or public deployment changed.
