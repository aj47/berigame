# Playtest fixes — October 2, 2026

All findings in the three-agent playtest were addressed in the local preview at http://127.0.0.1:8789/play. The local SpacetimeDB module was updated with `--delete-data=never`. This report records validation before production deployment.

## Changes

- Arrival interactions survive camera drags, right presses and unrelated keys. New gameplay actions, retargets and Escape still cancel them.
- Gathering objectives count materials awarded. An Axe gives two Timber and advances the timber objective by two.
- Six shared timber pines provide a gathering route. New nodes appear in existing worlds without resetting claims or stumps. Resource shortcuts prefer available trees over occupied or regrowing ones.
- Harvestable pines have pale trunk markings, wood chips and a higher crown. Starter stone hatchets and crafted metal Axes have distinct models; hover text explains their one/two Timber yields.
- The expanded map has a wider desktop layout and responsive Bramblewild, Meadows and whole-island views, numbered landmarks and resource navigation. Route labels reflect carried keys.
- Secondary Meadow paths vary in width and wear, with grass returning at unused ends. Parcel positions and collision terrain remain unchanged.
- Build and recipe cards show held/required materials. Upkeep uses named dates and rounded time remaining, with missing coins explained before payment.
- Meadows Skills is now Disciplines. The UI and wiki explain its relationship to Skills & techniques and the one-time initial XP import.
- Wildlife, taming and supply-order quests precede the upkeep milestone. Saved completion IDs remain valid.
- First-stick guidance shows harvest progress; combat guidance recognizes an already-owned Stick. Help distinguishes original skills from discipline combat bonuses.
- HTTP and browser agents share gathering/activity, decoded destination and region-aware objective presentation. The older API guide, agent onboarding guide and wiki agree with the implemented rules.

## Verification

- Complete suite: **434 shared + 549 frontend + 21 agent tests = 1,004 passed**, one optional load test skipped.
- Frontend production build, server typecheck, agent typecheck and diff whitespace checks passed.
- Regression tests cover camera cancellation, axe quantities, concurrent gathering, saved-world compatibility, quest ordering, resource selection, district navigation, material counts, first-stick guidance, API/WebMCP state and path continuity.
- Live fresh-character checks confirmed first-stick progress at 1/4, 2/4 and 3/4; the fourth harvest awarded the Stick. Connected travel exposed region-local coordinates. Six timber trees were visible. Starter hatchet yielded one; Axe yielded two with matching quest progress.
- Reconnecting both a fresh character and the existing Land Critique character preserved progression. Land Critique retained plot 14, its four buildings, inventory, quests and 10 coins; Observe became its next quest.
- Browser checks at 1280 × 720 and 390 × 844 confirmed readable maps, material counts and discipline guidance. Rotating during an approach still opened the land panel on arrival. Final reload confirmed the browser agent's Meadows objective and absence of the stale original tutorial.

The broader frontend typecheck still reports nine existing SDK integration errors; the shared package typecheck reports two existing test-configuration errors. These are outside the playtest findings. Mobile checks covered layout in an emulated viewport, not physical touch hardware. Production persistence, sailing and combat were not retested.

The browser character remains idle beside its plot with panels closed, its original coins and ownership preserved, and one additional Timber from the visual gathering check. API test clients are disconnected; their earned local progression remains saved.

## Evidence

Local evidence is retained in the ignored `.spacetime-data/settlements-validation/playtest-20261002/` directory. It is not included in the repository or deployment:

- `fixes-api-smoke-results.json`: sanitized live API checks.
- `fixed-map-desktop.png`, `fixed-map-mobile.png`: responsive map checks.
- `fixed-arrival-popup.png`: land menu after camera rotation.
- `fixed-build-materials.png`: held/required material counts.
- `fixed-meadows-final.png`: final scene.
