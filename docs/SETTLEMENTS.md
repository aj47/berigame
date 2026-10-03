# Settlements and sailing

The expansion is implemented behind the world owner's `configure_expansion` flag. It defaults to disabled. Publishing the module and client preserves that setting; enabling the expansion is a separate owner action.

The public beta enabled Meadows on October 2, 2026, after the matching module and client were deployed. New worlds still default to disabled.

## Play loop

1. Carry a sturdy stick through the grove hedge, then follow the east road past Driftwood Harbour at **46,29** into the Meadows. **Map → Meadows town** or **Adventure → Make a home in the Meadows → Walk to Meadows town** queues the same walk.
2. Meet the steward at **31,64**, gather six timber, and craft a hammer. Hand in the three quests for 50 coins.
3. Walk to an available parcel and claim it for a 20-coin deed and 30 coins of prepaid upkeep. The server saves your progress automatically; no save or recovery export is required to own land.
4. Build a shelter, complete supply orders, choose two disciplines, and befriend a companion.
5. Walk west back to Driftwood Harbour at **46,29**, craft a hull and sail, and assemble a skiff.
6. Board, take the helm, and sail to Reedwake or Cinder Shoal. Dock before disembarking. Islands offer different resources, wildlife and plots.

The Meadows uses the same Adventure/Meadows, Bag, Chat and Menu controls as Bramblewild. Only one activity panel opens at a time. The town workshop, market and return trail sit around a central clearing. Six marked timber pines form a route along the town lane, with other materials nearby; resource locations stay outside reserved plots. Click resources to walk over and gather, and homestead signs to approach and inspect a parcel. Unclaimed expansion land is wooded, while claimed parcels clear their decorative vegetation. Existing plot IDs, coordinates and buildings are preserved.

The journal contains 18 ordered quests. Completion events accumulate before hand-in. NPC orders award 10 coins each, up to 60 coins per UTC day per character.

Gathering takes three seconds, with items and XP awarded only when the server completes the action. Timber trees fall when chopping finishes, leave a stump, and regrow after 12 seconds. Starter characters can cut timber before crafting an axe; the crafted axe doubles timber yield. Moving, taking damage, disconnecting or choosing another action cancels gathering without granting items. One player can gather a resource at a time. Plants use a reach-and-pluck animation, stone and ore use a tool swing, and timber uses a hatchet chop. The Cultivation gathering perk reduces eligible plant gathering to 2.4 seconds.

## One connected home island

Bramblewild and the Meadows share one scene, camera, ocean and island map. The harbour road crosses from Bramblewild **63,25** to Meadows **0,64**, two neighboring ground tiles. Clicking either district queues a continuous walk, including from one side of the boundary to the other. The expanded map includes town and your owned homestead as walking destinations.

Saved parcels, buildings and local coordinates remain unchanged. `homeMap.ts` places Meadows local coordinates at **+64 x, −39 z** relative to Bramblewild. The authoritative path spans both districts, rechecking buildings, door permissions, original terrain blockers and progression gates. `enter` and `return` now queue walking; `walk` accepts `id: "bramblewild" | "settlement"` and destination-local `x,z`. Normal movement and stop cancel a queued cross-district route. Journeys cannot carry an active expedition or duel across the boundary. Reedwake and Cinder remain islands reached by sailing.

## Rules

| System | Behavior |
| --- | --- |
| Land | 48 shared parcels: 24 Meadows, 12 Reedwake, 12 Cinder. One owned parcel or outgoing challenge per character. |
| Expansion | Buildable area grows from 8×8 to 12×12 to 16×16. Upgrades cost 100/250 coins, materials, and adjustment of prepaid tax. |
| Upkeep | 30/60/100 coins weekly by tier. Up to 28 days prepaid. Three days of grace before vulnerability. Paying arrears cancels a challenge and refunds its deposit. |
| Capture | One week's tax as deposit; 24 hours' notice; a ten-minute window; challenger must continuously hold the marker for two minutes. Registered defenders interrupt the hold. Failure refunds half and starts a 24-hour cooldown. |
| Transfer | Buildings and ordinary plot storage transfer. Wallets, personal six-slot town vaults, boats and companions remain with their owners. |
| Permissions | Separate build, storage and upkeep permissions; up to eight helpers. Permissions are frozen during a challenge. Attackers require an explicit invitation and defenders must be owner/build helpers. |
| Construction | 18 piece types, three placement layers, one storey, 128 pieces per parcel. Move for free; dismantle for 75% of each input, rounded down. Occupancy, bounds, layers and escape routes are validated by the server. |
| Disciplines | Might, Cultivation, Building, Beastcraft and Exploration earn XP independently. Two active disciplines; first choice free, later changes cost 20 coins with a 24-hour cooldown, in town outside conflict. Existing progression migrates once and subsequent Bramblewild XP also contributes. |
| Equipment | 25 new item types and 16 inventory recipes, alongside the 18 construction recipes. Damage tops out at ten per strike, versus the existing club's eight; maximum health is 36, versus the base 30. |
| Tools | Axe doubles timber yield. A pick enables the level-ten Might mining perk. A watering can shortens newly planted carrots from two hours to 90 minutes. |
| Creatures | Four tameable species and hostile Bristlebacks. Observe before feeding; one active companion and three additional pets after building a stable. Advanced utilities require active Beastcraft. |
| Companion utilities | Burrowbun finds seed; Reedhorn carries six slots; Glowmoth reports resources; Shellback guards carried expedition cargo for 12 seconds. Defeated companions rest for a minute. |
| Defeat | Frontier combat drops the backpack and active pack contents in a public bag for five minutes, and respawns the character at that island's town after five ticks. Defeat aboard a boat removes that passenger and uses the last port's region. Coins, property and the town vault survive. |
| Boats | One owned skiff, four crew, twelve cargo slots. Separate boarding, helm and cargo permissions. Bounded sea, direct steering, three ports. After five minutes with no connected crew, the boat and passengers return to the last port. |

No naval combat, sinking, wind simulation, guild ownership, terrain editing, multiple storeys or destructible sieges are included.

## Code and persistence

- `shared/sim/frontier`: catalogs, region pathfinding, transactional game rules, public snapshots.
- `spacetimedb/src/lib/frontier.ts`: persistent repository, legacy progression migration, authorized private projections and scheduled simulation.
- `spacetimedb/src/reducers/frontier.ts`: player commands, owner controls and gateway recovery attestation.
- `frontend/src/frontier`: scene, journal and control panels, placement previews, recovery download/import.
- `frontend/src/spacetime/frontierSubscription.ts`: district-specific building, crop and drop subscriptions; Meadows geometry stays subscribed throughout the connected home island. The smaller land/boat/creature directory remains shared.
- HTTP agents use `frontier` with a JSON `command`; WebMCP uses `inspect_settlements` and `settlement_action`. Both reach the same authoritative reducer. Coin trades use confirmations bound to both item and coin offers.

Player region defaults to `bramblewild`, so existing coordinates remain valid. Public objects and private wallet/container/ledger records are stored separately. `frontier_view` exposes only authorized projections. Permission revocation and ownership changes update those projections in the same transaction.

### Command examples

```json
{"action":"walk","id":"settlement","x":31,"z":64}
{"action":"walk","id":"bramblewild","x":46,"z":29}
{"action":"move","x":11,"z":8}
{"action":"claim","id":"settlement-1"}
{"action":"build","id":"settlement-1","item":"wall","x":13,"z":9,"rotation":0}
{"action":"tax","id":"settlement-1","quantity":1}
{"action":"container","id":"piece-123","target":"deposit","item":"timber","quantity":5}
{"action":"specialize","disciplines":[2,3]}
{"action":"board","id":"skiff-123"}
{"action":"pilot"}
{"action":"sail","x":100,"z":15}
{"action":"dock","id":"reedwake"}
```

Use IDs returned by state; the piece/boat numbers above are examples. Rotation is 0–3. Land permission bits are build=1, storage=2, upkeep=4. Boat permission bits are board=1, helm=2, cargo=4. `quantity` means weeks for tax and item count for storage. `join_contest` takes target `attack` or `defend`; `invite_contest` takes the invited character ID in `target`.

## Server persistence, account recovery and operation

The central SpacetimeDB server stores character progress, coins, inventory, land and buildings automatically. Reconnecting with the same character credential restores access to that server state. Players do not need to save their game or download a backup before buying land or starting an eligible land challenge.

Recovery export is optional and protects access to the character if its browser credential is lost. It is an access key, not a copy of the game world or character progress. Server backups remain an operator responsibility.

The hosted gateway exports a separate `bgk_` recovery key after checking the character credential. It stores a digest of that key and an AES-256-GCM encrypted credential. Restoring rotates the key and creates a renewal token; the ordinary admission path still enforces expiry, capacity and revocation. Backup keys expire after 180 days. Exporting another backup invalidates the previous one.

Configure a stable `RECOVERY_ENCRYPTION_KEY` secret before enabling the feature. Without it, the gateway credential is the encryption key fallback. Changing whichever key encrypted existing records makes those backups unreadable; preserve that secret or deliberately migrate the encrypted records before rotation. Recovery files grant access to the character and should be kept privately.

Publish schema changes with `--delete-data=never`, regenerate bindings, and deploy the matching client/gateway before enabling. Take the normal database backup before a release. Owner reducer arguments:

```text
configure_expansion true false   # enable
configure_expansion true true    # pause upkeep/capture deadlines
configure_expansion false true  # disable safely; preserve property
```

Disabling returns characters to camp, docks boats and clears their crew. It freezes upkeep; resuming shifts deadlines by the paused duration and resets capture holds. Use this flag for rollback instead of downgrading the schema or deleting tables. Calling configure also backfills projection indexes from an earlier expansion build.

## Verification

Run `npm test`, `npm run test:frontier-load`, the module and Worker TypeScript checks, `npm run agent:typecheck --prefix frontend`, and `npm run beta:build`.

Additional checks are intentionally restricted to isolated local databases:

- `frontend/scripts/frontier-smoke.ts`: fresh-character gathering → hammer → three rewards → paid claim without recovery export → floor/wall; private-view isolation and reconnect persistence.
- `frontend/scripts/frontier-gateway-setup.ts` and `frontier-recovery-smoke.ts`: local Worker configuration and recovery export, restore, replay rejection, bounded renewal and admin revocation. Credentials stay under ignored `.spacetime-data` files.
- `shared/sim/__tests__/frontier-server.test.ts`: projection revocation, ownership transfer, safe disable/resume, coin trades, and 32 active characters / 48 full parcels / eight moving boats.

Desktop and 390-pixel browser checks passed with no runtime errors or horizontal overflow. The isolated database-adapter load test measured **58–296 ms p95** across runs after the A* change (previously 488.3 ms). Run the load check separately from browser/render tests to avoid CPU contention. It measures local reducer logic and serialization, not hosted database latency.

Before a public release, still measure the full populated world on the target mobile device against the 30 FPS target and run the hosted load check against the 300 ms server p95 target. These hardware/hosting results have not been claimed from the local tests.
