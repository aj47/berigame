# Compact phone and tablet layout verification

Actual Chrome 153 touch/viewport checks, using a freshly harvested berry to inspect selected-item actions. Screenshots and `report.json` contain measured DOM action bounds and projected actor head/feet. All test contexts were closed.

Confirmed and repaired:
- At 320×568, Bag actions were partly clipped by the panel. Inventory now keeps the inspector fixed while its slot grid shrinks and scrolls.
- At 320×568, the wardrobe covered the boots. Its compact bottom offset now matches the shorter combat HUD.
- At 568×320, Bag was only 75px tall and Style offered a 6px choices viewport; actions and preview were clipped. A landscape-only layout for 540–700px width and up to 500px height uses two columns, with a matching wardrobe camera offset. It also covers 640×360 without overlapping the left panel and right HUD.
- Tablet portrait now follows the side-panel layout instead of receiving the phone bottom-sheet camera offset.
- Opening Style in landscape, rotating to portrait, then Cancel restored the old landscape zoom. The saved restore distance now follows the responsive baseline on resize only; the draft stays intact and Cancel does not save.

Final measured bounds (CSS pixels):

| Viewport | Bag action top–bottom | Style action top–bottom | Actor preview clearance |
|---|---|---|---|
| 320×568 | 337.5–381.5 | 365–409 | Feet y193.7, sheet top220.2 |
| 390×844 | 484.1–528.1 | 601–645 | Feet y287.8, sheet top351.3 |
| 768×1024 | 549.7–593.7 | 582.9–626.9 | Full body beside panel beginning x414 |
| 1024×768 | 467.8–511.8 | 510–554 | Full body beside panel beginning x670 |
| 568×320 | 229–273 | 240–284 | Head y103.6, feet y169.6, HUD begins y205 |
| 640×360 | 264–308 | 280–324 | Head y116.5, feet y190.8, HUD begins y245 |

All listed actions retain their full 44px height. The compact landscape panel and HUD have a 12px horizontal gap. Toolbar, stance/Stop, Bag actions, Style choices, Save/Cancel and full-body previews were inspected; wardrobe color selection and Cancel were operated at each size. No unexpected page errors were recorded. These checks use desktop Chrome with touch emulation and do not establish physical-phone GPU performance.

`compact-landscape/` holds the two additional orientation reports and screenshots. `orientation-report.json` records the open-editor rotation regression check. Frontend unit suite passes 40 tests across nine files; production build passes with existing dependency eval and bundle-size warnings.
