# Giant berry adventures

This beta adds an activity that can start immediately, five paths of techniques, and the progression fixes from the September playtests.

## Play

Open **Adventure**, walk to the gardener camp at **22,18**, and plant a strange seed. Choose the market or the Giant's feast. The seed grows at **34,17** in 18 seconds (6 with Seed sense). Up to four expeditions can run concurrently; join from camp or beside a berry.

Until a player's first successful delivery, Pip and the Giant wait 30 extra seconds before pursuing. This gives newcomers time to read the controls and reach their first berry. Subsequent expeditions use the normal timing.

Carry the ripe fruit with both hands and move one tile per tick. Put it down to use tools. Pass to a nearby teammate, roll toward a destination, hide it under leaves, or split off two portions of mash. Splitting costs one delivery reward unless Berry basket is equipped.

- **Pip** takes bites from grounded, uncovered cargo. A greenberry bribe distracts him; Favourite snack extends the truce.
- **Moss** carries toward the destination for one reward berry, charged once per adventure. He drops the cargo near the pursuing Giant. Porter pact removes the fee and makes him follow the player who hired him; Quiet cart speeds him up.
- The **Berry Giant** follows the cargo's scent. Place greenberry bait away from the route; Scent decoy substitutes driftwood and lasts longer. It only eats cargo, never player health or inventory. Four or more present participants make it move faster. The Boulders raid is a separate encounter and retains its schedule.
- Deliver at the **market (35,37)** or **feast clearing (12,36)**. Helping participants get the surviving reward and permanent XP. Feeding also builds personal Giant trust. A six-minute deadline bounds each attempt.

Disconnected carriers put the berry down at their last position. A deserted expedition has a one-minute return window, then frees its slot. Leaving the last-member expedition ends it. Leaving and rejoining does not repeat contribution XP or cache rewards. Existing PvP and death-drop rules elsewhere on the island remain unchanged.

## Progression

Growing, Building, Exploring, Fighting and Befriending each have three techniques. Unlocks require both a path level and a concrete accomplishment. Equip at most three, freely changed near camp outside combat with hands free. Techniques change adventure actions; they do not add PvP damage or maximum HP.

The Skills panel and agent state list every effect and prerequisite. Gathering, crafting, exploration, dummy resets, completed friendly duels, NPC help and gifts train their corresponding paths. Existing gathering XP seeds the new paths on the first recorded adventure progress update.

Foraging level 2 awards the first stick, even on a bad random roll. Four normal berry harvests earn that level. Every later eligible berry harvest has a 25% chance of a spare. Sticks gifted or traded before level 2 still work. Overflow rewards appear on the ground instead of disappearing.

## Shared progress and social play

The workshop needs **20 driftwood + 10 obsidian** contributed at camp. Once complete, every newly planted expedition berry gains one reward. Work and the count of completed adventures persist across visits.

Garden sharing publishes a read-only snapshot that updates when the owner plants or harvests. Owners can hide it again; other players cannot change the plants. Gift receipts identify the recipient and contents. Bag and trade screens warn about giving away a last route key. Material descriptions explain their uses. The tutorial offers another berry if its first one was planted or gifted, and leads to camp after obsidian.

Friendly duels require a nearby recipient's acceptance outside the safe ring, followed by a three-second countdown. They use separate 30-point practice health, alternate weapon swings in melee range, and preserve ordinary HP and bags. Either player can surrender; separation, safety, disconnect or timeout ends the duel. Regular attacks cannot target active duel participants.

## Agent continuity

Hosted `/api/agent/v1/sessions` responses include a secret `renewToken`. Save it securely. To return, POST `{}` to `/api/agent/v1/renewals` with that token as the bearer. Store the newly rotated renewal and session tokens. Return tokens have a sliding 30-day lifetime; hourly visits, idle limits, capacity and operator revocation remain enforced. DELETE `/session` ends the visit without erasing the character's ability to return.

The new HTTP actions are `expedition`, `technique`, `project`, `duel` and `garden_share`. Browser WebMCP exposes equivalent controls. Read state after accepted actions. Game rejection messages explain proximity, missing materials, equipment, stage and cooldown requirements.

## Validation

- `npm test`: shared pure rules and actual reducers against in-memory storage, React UI tests and HTTP/renewal tests.
- `npm run beta:build`; module, Agent API and Worker TypeScript checks.
- `frontend/scripts/adventure-smoke.ts`: fresh-character fourth-harvest guarantee, real cargo interruption and recovery, one-time completion, reconnect, consensual duel countdown/surrender and garden sharing against an isolated SpacetimeDB world.
- Browser checks cover a completed solo delivery, skill cards and phone-width layout.

The additive database tables preserve existing characters and garden rows. Publish with `--delete-data=never`, then deploy the matching Worker/assets immediately because generated bindings change.

The September 30 beta verification passed 564 automated tests, the production build and TypeScript checks. Live API verification covered public admission, specific game rejection messages, ending a visit, returning to the same named character and rotating the return token. Browser checks confirmed the deployed controls at desktop and 390px phone widths. Two independent Luna API playtests completed: one delivered two goldberries and equipped Read tracks; the other lost cargo after hiring Moss. Both found the first pursuit rushed, prompting the first-delivery grace period above. Newcomer/veteran pursuit timing has a reducer regression test. Model optimization validation could not run because the local @gltf-transform/core dependency is absent; no model assets were changed.
