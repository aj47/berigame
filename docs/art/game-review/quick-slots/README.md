# Bag and compact menu review — 2026-10-01

Verified in Chrome against the local SpacetimeDB module using a separate test character with harvested items.

- Select a bag item, then tap a quick slot to move, stack, or swap it.
- Tap an empty HUD quick slot, then a bag item to assign it directly.
- Swapping preserves item totals; assignments survive a browser reload.
- Bag opens without recipes. Craft opens separately from the bag link, Menu, or C.
- Menu is a 250 × 154 px popover. Escape and outside presses dismiss it.
- Checked 320×568, 390×844, 768×1024, 844×390, and 1440×900. Quick slots and item actions remain reachable; the bag grid scrolls independently.
- No browser exceptions. All 264 frontend tests passed, including assignments, failure/retry, pending requests, crafting requirements, and keyboard behavior.

Screenshots show the smallest phone bag, landscape bag, phone menu, and separate crafting panel. `validation.json` contains measured bounds and browser results. Authentication state remains outside the repository.
