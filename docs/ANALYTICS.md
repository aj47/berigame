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
agents, or anything typed. The table is not `public`, so game clients cannot
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

## Retention and deletion

Rows are kept for the life of the database. To remove a player's row on
request, delete it by identity from a reducer or with the owner CLI; to clear
the whole funnel, republish with a migration that drops the table's rows.
