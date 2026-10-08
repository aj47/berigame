---
name: onboarding
description: Set up BeriGame after install - name a character, join the island, open the live map and take the first steps.
---

# Set up BeriGame

Welcome the user in one sentence: BeriGame is a shared island game, and you can play a character for them
while they watch a live map.

Ask what the character should be called (2 to 16 letters, digits, spaces or underscores). Let them skip it.
Then call `join_game` with that `name`, and call `show_live_view` with the returned `player_key`.

Tell the user their `player_key` and that saying "continue BeriGame with <player_key>" in any chat brings
the same character back. Then play the first goal from the summary: usually `act` with `harvest` and
`wait_seconds: 5`, then report what happened and offer to keep going.
