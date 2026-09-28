# Cloudflare + SpacetimeDB beta

- Website and HTTP agent API: Cloudflare Worker `berigame-beta`, custom domain `beta.berigame.com`.
- Game simulation and persistent player state: SpacetimeDB Maincloud, database `berigame-beta`.
- Invite hashes, session credentials, limits and action receipts: one SQLite Durable Object.
- No container disk, VM, or local computer is required after deployment.

The Cloudflare gateway uses the same `frontend/agent-api/game.ts` adapter and API
contract as the local Node service. SpacetimeDB remains authoritative for movement,
combat, inventory, permit expiry and revocation. The existing `alpha` Pages project
has its own deployment configuration.

## Publish updates

Use Node 22+ and Wrangler 4.36+. Install the repository dependencies as described
in the main README. The current SDK lockfile uses SpacetimeDB 2.10.1.

```sh
npm run beta:types
./spacetimedb/node_modules/.bin/tsc -p frontend/cloudflare/tsconfig.json
npm run beta:deploy
```

`beta:deploy` builds the website with Maincloud settings and browser admission
enabled, then deploys the Worker, static assets, bindings and custom domain. Worker
secrets are retained on updates. The two secrets are `GATEWAY_CREDENTIAL` (the
JSON credential of the limited gateway identity) and `ADMIN_TOKEN` (operator API).
Neither belongs in frontend build variables or Git.

Database changes are a separate publish, using the beta owner's CLI identity:

```sh
spacetime --config-path .spacetime-data/deploy-beta/cli.toml publish \
  --server maincloud --module-path spacetimedb --delete-data=never \
  --yes=remote,skip-login berigame-beta
```

The deployment computer may use `.spacetime-data/tools/spacetimedb-cli` if
`spacetime` is not on PATH. Never use `--delete-data` to resolve a schema conflict.
Use a data-preserving migration and regenerate frontend bindings when required.

### Breaking schema publishes (the punch/stick quick-slot release)

A schema change that only adds or removes reducers, or adds a table, publishes
with the command above and keeps everyone connected. The quick-slot combat release
is not like that. It replaced rock-paper-scissors stances with punch/stick combat
and changed two tables:

- `player` gained a `weapon` column, appended at the end with default `''`.
- The `combat_event` event table was reshaped. The four stance and state columns
  are gone, and `item_id` was added.

SpacetimeDB auto-migrates both changes and keeps all rows. It still classifies
them as breaking for connected clients. Publish them with `break-clients` added
to `--yes`. Keep `--delete-data=never`, and **never delete data**:

```sh
spacetime --version   # the flag below needs a CLI that supports break-clients (2.10.1 does)
spacetime --config-path .spacetime-data/deploy-beta/cli.toml publish \
  --server maincloud --module-path spacetimedb --delete-data=never \
  --yes=remote,skip-login,break-clients berigame-beta
npm run beta:deploy   # immediately afterwards
```

- **Everyone is disconnected.** The publish disconnects every browser and every
  agent session. The Worker drops its API sessions once their upstream socket
  fails, so agents must redeem new invites.
- **Deploy the Worker and static bundle right after.** Old bundles decode rows
  by column position. Until `beta:deploy` finishes, the Worker and any cached
  page read the new `player` and `combat_event` rows misaligned. Publish when
  few people are playing.
- **Players must reload the page** after the deploy to pick up the new bindings.
- **Agent clients change too.** The agent API moves to version 1.1.0, and
  `/actions/stance` returns 404. Agents use `/actions/wield` and
  `/actions/unwield` instead.
- **The retired columns stay on purpose.** `player.stance`, `fight_state`,
  `last_exchange_tick` and `out_of_range_ticks` remain in the table. Removing or
  reordering `player` columns would need a manual migration. The module writes
  0 to them and nothing reads them. Do not "clean them up" with `--delete-data`.

### First deployment credentials

The initial deployment stores credentials with mode 0600 beneath the ignored
`.spacetime-data/deploy-beta/` directory. Keep a private backup of this directory.
`cli.toml` owns the Maincloud database; `gateway.json` can provision and revoke
bounded guest permits; `cloudflare-secrets.json` holds the two Worker secrets.
The gateway identity must match `access_policy.gateway`, and `require_admission`
must be `true`. The public discovery endpoint reports `ready: false` otherwise.

To upload the prepared Worker secrets:

```sh
wrangler secret bulk .spacetime-data/deploy-beta/cloudflare-secrets.json \
  --config frontend/cloudflare/wrangler.jsonc
```

## Give someone an invite

```sh
npm run beta:invite                  # API agent: gathering and movement
npm run beta:invite -- --combat      # API agent: also combat
npm run beta:invite -- --human       # Browser player
npm run beta:invite -- --human --combat --chat
npm run beta:revoke -- SESSION_ID
```

Share `https://beta.berigame.com/agent` with agents, plus their invite privately.
People open `https://beta.berigame.com/` and enter a **player** invite. The two
invite kinds are not interchangeable. Browser credentials are kept in that
browser; agent API callers never receive their underlying SpacetimeDB token.
HTTP agents should send `User-Agent: BeriGame-Agent/1.0`. The zone's browser
integrity check rejects the default Python urllib user agent with HTTP 403/1010;
the descriptive agent header is accepted. Normal browser requests work unchanged.

Invites expire after 24 hours and can be redeemed once. Every visit lasts at most
one hour. API sessions close after ten idle minutes. Browser visits use the same
bounded gateway permits enforced in SpacetimeDB; refreshing preserves the current
character for the remaining visit. A new invite creates a new guest character.

## Abuse and persistence limits

- Combat and chat default off and are also enforced in the database.
- At most 16 API sessions and 16 browser visits, four total per IP address.
- At most 100 new visits and 50,000 non-admin API requests per UTC day.
- At most 256 unredeemed invites and 1,024 action receipts per API session.
- SpacetimeDB also caps the world at 10,000 lifetime guest permits/characters.
- Edge rate limiting, durable global/IP/session budgets, 4 KiB bodies, strict
  action schemas and same-origin browser requests.
- Limits count denied/invalid authenticated requests as well as successful ones.
- Invite consumption and slot reservation commit together. Receipts persist
  across restarts. An action left with an uncertain result closes the session
  instead of being issued again. A lost join response requires a new invite.
- Expired session credentials and receipts are removed by a Durable Object alarm.
  Database permits expire independently if the gateway is unavailable.
- One coordinator limits the number of active Durable Objects. Its upstream
  sockets close when no API session needs them. Logs do not include credentials,
  request bodies or player chat; request observability is disabled.

These controls limit game access and API work. They do not guarantee protection
against every denial of service or provider quota exhaustion. Maincloud's public
endpoint remains reachable; admission is enforced by its reducers and connection
hook. Cloudflare account quotas are shared with other projects. On free tiers,
quota exhaustion can make the beta unavailable. Do not enable paid overages or
upgrade a plan without choosing a budget.

## Runtime compatibility

The SDK's binary codecs use runtime code generation. Cloudflare permits this
during Worker startup, so `cloudflare/codecs.ts` prepares the checked-in game
schema and SDK protocol codecs before serving requests. Wrangler aliases the
SDK to one source instance so its caches are shared. No caller input is compiled.
The socket adapter uses Cloudflare's `fetch` WebSocket upgrade with authorization
in a header. Review these two adapters when upgrading SpacetimeDB.

Cloudflare Containers are not used because their filesystems are ephemeral.
Maincloud stores game state independently from Worker restarts and redeployments.

Sources: [Maincloud deployment](https://spacetimedb.com/docs/how-to/deploy/maincloud/),
[Maincloud pricing](https://spacetimedb.com/pricing),
[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[Worker startup compatibility](https://developers.cloudflare.com/workers/configuration/compatibility-flags/).
