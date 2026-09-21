# Installed browser-engine check

Run against the actual local Vite game at `http://127.0.0.1:5173`, connected to the local `berigame-graphics-review` database. No browser downloads or application source changes were made for this audit.

## WebKit: passed

- Playwright 1.62.0, matching installed WebKit revision 2336, engine version 26.5.
- 390×844 CSS viewport, device scale factor 2, mobile/touch emulation.
- Model fetched successfully; real WebGL rendering reported 7,676 triangles / 41 draw calls in the initial scene.
- Three stances via touch, ground movement, tree 2 harvest, inventory selection/Move, and chat succeeded.
- A real intercepted WebSocket close showed the interrupted-connection overlay. Rejoin restored the same identity and carried inventory.
- Landscape 844×390 inventory actions remained inside the viewport.
- No JavaScript page errors or console errors. One expected `SpacetimeDB disconnected` warning from the deliberate disconnect test.

Screenshots confirm the character, icons, inventory and reconnect screen rendered. At initial shared spawn, two players' labels overlap; this is shared-position crowding, not a WebKit-specific failure. The landscape screenshot was taken during the camera transition; the reusable script now waits for that transition before capturing future runs.

## Firefox: engine compatibility blocked before navigation

Installed Firefox revision 1471 launches and reports version 134.0. It is incompatible with the installed modern drivers:

- Playwright 1.62.0: `Browser.setDefaultViewport` rejects the `isMobile` protocol field.
- Playwright 1.58.2: `Browser.setContrast` is unsupported.

Neither attempt reached the game. This is not a game failure or a Firefox gameplay pass. No compatible older driver was found in the bounded installed-package lookup; no package/browser was installed.

## Reuse

`frontend/scripts/cross-browser-check.mjs` accepts `PLAYWRIGHT_MODULE`, `GAME_URL`, `SHOT_DIR`, `ENGINES`, and optional `WEBKIT_EXECUTABLE` / `FIREFOX_EXECUTABLE`. It never installs browsers. Reserved test resources are tree 2 for WebKit and tree 6 for Firefox; coordinate concurrent tests before running.

The machine-readable results are in `cross-browser.json`. These are desktop engine tests with emulated phone input/layout, not physical-phone performance evidence.
