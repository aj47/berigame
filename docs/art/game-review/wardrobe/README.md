# Wardrobe verification

Actual local game (`127.0.0.1:5173`, review database) exercised with installed Playwright browsers. Chrome 153.0.8010.48 and WebKit 26.5 each passed 13 checks in their JSON reports. Tests used fresh identities and moved the local actor three tiles away from the shared spawn so the edited model could be inspected without overlapping actors.

Verified in both engines:
- Unsaved Cropped/Forest appearance affects only the local actor; a second client's renderer retains the saved default.
- Cancel restores saved choices.
- Phone portrait at 390×844 and 360×740 keeps the full actor above the 38dvh editor sheet. Save/Cancel remain above the combat HUD, at least 44px tall. Four toolbar buttons clear the brand at 360px.
- Saving Topknot, Brown skin, Silver hair, Plum robe, and Slate wraps updates the second client's actual model appearance and survives a page reload.
- Landscape 844×390 keeps wardrobe actions visible; desktop 1440×900 shows the full panel.
- No page errors.

Screenshots include the live local model, unchanged observer, scrolled wardrobe, portrait/compact/landscape/desktop, and the observer after save. The local model's You label distinguishes it from the other actor.

Run from repo root:

```sh
PLAYWRIGHT_MODULE=/Users/ajjoobandi/.npm/_npx/44b85dff014d9ceb/node_modules/playwright SHOT_DIR=docs/art/game-review/wardrobe node frontend/scripts/appearance-check.mjs
ENGINE=webkit PLAYWRIGHT_MODULE=/Users/ajjoobandi/.npm/_npx/44b85dff014d9ceb/node_modules/playwright SHOT_DIR=docs/art/game-review/wardrobe node frontend/scripts/appearance-check.mjs
```

The final Chrome capture includes raised overhead indicators, crowded-name prioritization, and numeric identity lookup optimizations. The WebKit capture predates those label and performance refinements; its wardrobe interaction checks remain recorded from that earlier state.

These are actual desktop browser engines with emulated phone viewports and touch. They do not establish physical phone GPU performance. Firefox compatibility limits are recorded separately under `../cross-browser/`.

Final frontend unit suite: 40 tests pass across nine files (verified by the coordinating agent). Five wardrobe tests cover explicit-save-only semantics, Cancel/panel-switch cleanup, existing saved choices, failed save retry, and an in-flight save resolving after leaving the panel. Production build passes with the existing large-chunk and dependency eval warnings.
