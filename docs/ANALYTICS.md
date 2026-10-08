# Anonymous gameplay analytics

BeriGame records a small, anonymous funnel on the server so we can see where
new players stop: do they find a berry, a stick, cross the hedge, reach the
Coast, craft? Nothing is sent to a third party and nothing runs in the browser.

## What is stored

One row per player identity in the **private** table `play_stats`
(`spacetimedb/src/tables.ts`, written by `spacetimedb/src/lib/stats.ts`).

| Column | Meaning |
| --- | --- |
| `identity` | The SpacetimeDB identity (random, issued per browser token). Not linked to a name, email or IP. |
| `first_join_at` | First connection of this character. |
| `last_seen_at` | Last connect or disconnect. |
| `session_started_at` | Start of the current session (null while offline). |
| `sessions` | Number of sessions (a second tab of an online player does not count). |
| `total_play_micros` | Sum of finished session lengths, in microseconds. |
| `first_berry_at` | First berry received (harvest). |
| `first_stick_at` | First stick received. |
| `reached_hedge_at` | First step onto the bramble hedge ring. |
| `reached_coast_at` | First step onto the Coast (also sets `reached_hedge_at` if it was skipped). |
| `first_craft_at` | First successful craft. |
| `deaths` | Number of deaths. |
| `last_step` | Furthest funnel step reached: `join` → `berry` → `stick` → `hedge` → `coast` → `craft`. For players who stopped returning this is their quit point. |

Not stored: player names, chat, positions over time, IP addresses, user
agents, or anything typed. (`daily_activity`, below, adds per-day counters
under the same rules.) The table is not `public`, so game clients cannot
subscribe to it or query it; only the database owner can read it.

Recording is best-effort: every write is wrapped so an analytics failure can
never make a game reducer fail. Players who joined before this table existed
get a row on their next connection (their `first_join_at` is then that
connection, not their real first join).

## Reading the funnel (admin only)

Private tables are readable only by the identity that published the module,
so run this with the `spacetime` CLI logged in as that owner:

```sh
node scripts/analytics-funnel.mjs --server maincloud --db berigame
node scripts/analytics-funnel.mjs --server http://127.0.0.1:3000 --since-days 7
node scripts/analytics-funnel.mjs --json            # machine-readable
node scripts/analytics-funnel.mjs --file dump.json # a saved `spacetime sql --format json` result
```

`SPACETIME_CLI` overrides the CLI path. The script runs
`spacetime sql <db> "SELECT * FROM play_stats" --format json` and prints:

- **Funnel**: players who reached each step, as a share of all players and of
  the previous step, and the median minutes from first join to that step.
- **Furthest step**: how many players stopped at each step (quit points).
- **Deaths** and **sessions** (median finished play time per player).

Anonymous or non-owner identities get `no such table: play_stats` (it is
private), which is the expected access control.

Ad-hoc queries also work, for example:

```sh
spacetime sql berigame "SELECT last_step, deaths FROM play_stats"
```

## Daily activity and the admin panel

`daily_activity` (private, `spacetimedb/src/lib/activity.ts`) holds one row per
character per UTC day it was online or acted, keyed `<day>:<identity>`:

| Column | Meaning |
| --- | --- |
| `day`, `identity`, `agent` | UTC day number, the character, and whether its permit was an agent permit. |
| `sessions` | New sessions started that day (same rule as `play_stats`). |
| `play_seconds` | Online time, sampled by the tick once a minute, so long sessions split across days. |
| `harvests`, `gathered` | Finished Grove/Coast harvests and the items they paid. |
| `crafts`, `trades`, `deposits`, `chats` | Successful crafts, completed trades (both sides), vault deposits, chat messages (count only). |
| `kills`, `deaths` | Blows that dropped another player, and deaths. |
| `actions` | JSON map of other actions: region actions by name (`gather`, `build`, `quest`, ...), `vault-withdraw`, `clatterhorn`, `giant`, `spire-run`, `garden-plant`, `garden-harvest`, `expedition-<action>`, `duel`. |

Like `play_stats`, every write is best-effort and never fails a reducer. History
starts when the table was published: earlier days in the panel show new players
(from `play_stats.first_join_at`) and coins (from the coin ledger) only.

The owner panel lives at `https://beta.berigame.com/admin`. It asks for the beta
Worker's `ADMIN_TOKEN` and calls `POST /api/admin/stats` and
`POST /api/admin/player`, which relay the module procedures `admin_snapshot` and
`admin_player` over the gateway's control connection. Those procedures refuse
every identity except the world owner and the configured gateway. The panel shows:

- **Overview**: online now, DAU/WAU/MAU, new players, hours played, who is online.
- **Players**: every character with join/last-seen, sessions, play time, coins,
  vault and carried value, XP, kills and deaths; a drawer per character with
  milestones, daily activity, bag, vault, claims, coin ledger and recent chat
  (the public `chat_message` table keeps only the latest rows).
- **Activity**: daily totals per counter, region actions, the funnel and D1/D3/D7
  retention by join day.
- **Economy**: coin supply over time and sources/sinks (rebuilt from the
  `frontier_private` coin ledger), wallet distribution and Gini, a ledger-vs-wallet
  balance check, items in bags, vaults, storage and on the ground, claims and energy.
- **Gateway**: API sessions, joins and requests per day, invites and sign-in
  accounts from the Worker's Durable Object.

The owner CLI can read the table directly too:

```sh
# DAU for one UTC day (days since 1970-01-01; GROUP BY is not supported)
spacetime sql --server http://127.0.0.1:3000 berigame-beta \
  "SELECT COUNT(*) AS dau FROM daily_activity WHERE day = 20733"
spacetime call --server http://127.0.0.1:3000 berigame-beta admin_snapshot 30
```

## Retention and deletion

Rows are kept for the life of the database (`daily_activity` too). To remove a player's rows on
request, delete it by identity from a reducer or with the owner CLI; to clear
the whole funnel, republish with a migration that drops the table's rows.
