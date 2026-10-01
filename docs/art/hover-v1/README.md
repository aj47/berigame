# World hover previews

Deployed to https://beta.berigame.com on 2026-09-30.
Worker version: `90ca04d0-8f64-4b41-a555-ecb772be428f`.
Client asset: `index-48b46cf4.js`. No database publish or migration.

Mouse hover identifies the target, explains the click, displays current availability,
and draws a ring at its feet. Garden plots resolve separately. Ground previews use
the same movement rules to show reachable destinations and explain water, obstacles
and missing keys. Target selection shares the mouse click-assist sampling; hovering
does not invoke handlers. Opening an adventure through click assist consumes the click.

Validation:

- Frontend regression suite: 248 tests passed, including 10 hover and targeting tests
  (`npm test --prefix frontend -- --run --no-file-parallelism`). A preceding parallel
  run hit a timing-sensitive animation benchmark failure; the serial run passed it.
- Beta production build and `git diff --check` passed.
- Live browser: blueberry preview and matching action menu, separate garden plots
  including the Foraging 5 lock, gardener adventure panel, training dummy, walking
  and water previews, pointer cursor, clearing over HUD controls and open menus/map.
- No browser console errors. Public site/API returned 200; API ready; anonymous
  private-state request returned 401.
- Mouse-only preview; touch dispatch is unavailable in the in-app browser, so touch
  behavior was not manually verified.

`berry-hover.png` and `garden-hover.png` are screenshots from the deployed beta.
