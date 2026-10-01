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

### Breaking schema publishes (M2 "The Coast": `tree.kind`)

M2 appends one column: `tree.kind u8` with default `0` (0 berry tree,
1 driftwood pile, 2 tide rock). SpacetimeDB auto-migrates it and keeps every
row, but classifies it as breaking for connected clients, exactly like the
`player.weapon` release above. Same procedure, same rules:

```sh
spacetime --config-path .spacetime-data/deploy-beta/cli.toml publish \
  --server maincloud --module-path spacetimedb --delete-data=never \
  --yes=remote,skip-login,break-clients berigame-beta
npm run beta:deploy   # immediately afterwards (new bindings: tree.kind, the craft reducer)
```

- **Nodes seed themselves.** Existing trees migrate to `kind = 0`. The eight
  Coast nodes (ids 101-108) are inserted by the next `tick` (and by `init` on a
  fresh database). Only missing ids are inserted, so re-publishing never
  duplicates or resets them. No version column, no manual step.
- **Old bundles misread `tree` rows** until `beta:deploy` finishes. Publish when
  few people are playing; players reload afterwards.
- **Agent API 1.2.0** adds `/actions/craft`, `harvest {nodeId | kind}`,
  `state.nodes` and `state.recipes`. `state.trees` stays for one release as an
  alias listing only the berry trees.
- Rehearsed locally: publish the previous module and connect a player, then
  publish this one with `--delete-data=never --yes=break-clients`; player,
  inventory and tree rows survive and the eight nodes appear on the next tick.

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

## Open beta admission

Players click **Enter the island** at `https://beta.berigame.com/`; no code is needed.
HTTP agents POST `{}` to `/api/agent/v1/sessions` with `Content-Type: application/json`
and no Authorization header. Subsequent API calls still require the returned session
bearer token. New public sessions allow combat and chat. Existing sessions and renewal
records retain their original permissions.

Admission still goes through the gateway: database admission, per-IP join limits,
16 sessions per player kind, four per IP, 100 new visits per day, hourly permits,
revocation and returning-browser renewal remain enforced. The database is not opened
to unpermitted direct connections. No database migration is needed for this change.

`VITE_OPEN_BETA=true` selects the open-beta browser and agent onboarding text;
`VITE_INVITE_REQUIRED=true` continues to enable the gateway admission/renewal component.
Both are set by `beta:build`. The hosted Worker accepts public joins for both player kinds.

## Optional scoped invites (legacy compatibility)

```sh
npm run beta:invite                  # API agent: gathering and movement
npm run beta:invite -- --combat      # API agent: also combat
npm run beta:invite -- --human       # Browser player
npm run beta:invite -- --human --combat --chat
npm run beta:revoke -- SESSION_ID
```

Share `https://beta.berigame.com/agent` with agents, plus their invite privately.
The current browser UI uses public admission; older clients may still redeem a **player** invite. The two
invite kinds are not interchangeable. Browser credentials are kept in that
browser; agent API callers never receive their underlying SpacetimeDB token.
HTTP agents should send `User-Agent: BeriGame-Agent/1.0`. The zone's browser
integrity check rejects the default Python urllib user agent with HTTP 403/1010;
the descriptive agent header is accepted. Normal browser requests work unchanged.

Invites expire after 24 hours and can be redeemed once. Every permit lasts at most
one hour. API sessions close after ten idle minutes. Browser visits use the same
bounded gateway permits enforced in SpacetimeDB. A browser that redeemed a player
invite keeps its character (identity, name, appearance, HP and inventory unless
dropped on death) across reloads and hourly renewals for 30 days after its last
visit; see "Returning players" below. A new public admission, new invite, or cleared browser storage creates a new guest character.

## Returning players (persistent identity, F1)

**Flow.** Joining publicly or redeeming a player invite (`POST /api/play/v1/sessions`) returns the
SpacetimeDB token of a fresh guest identity plus a renewal token `bgr_…`. The
browser keeps both in localStorage under keys scoped to the server and database.
Five minutes before the one-hour permit ends (or on load, if it already ended) a
tab calls `POST /api/play/v1/renewals` with `Authorization: Bearer bgr_…`. The
Worker looks the token up, calls the gateway-only `renew_grant` reducer to extend
that identity's permit by the invite's lifetime (one hour), rotates the renewal
token and returns the new one with the new expiry. The browser reconnects with the
same SpacetimeDB token, so the character row is found and reused: no new player
row, and the first-spawn newcomer grace is not applied again. Combat and chat
scopes stay those of the original invite. The admin `sessionId` stays the same
across renewals, so `npm run beta:revoke -- SESSION_ID` works at any time.

**Threat model.**
- *Forgery.* Renewal tokens carry 256 random bits. The Durable Object stores only
  their SHA-256 digest. They never name an identity: the digest maps to exactly
  one identity server-side, so a caller cannot point a token at another character.
- *Theft/transfer.* The token is a bearer secret in the same localStorage as the
  SpacetimeDB token, which already controls the character; it adds no new
  exposure beyond XSS or device access. Each use rotates it. The previous token is
  answered with 409 for two minutes (a racing tab), and any later replay deletes
  the renewal record, ending renewal for both copies. A stolen token is useful for
  at most one hour per renewal and dies when the owner next renews.
- *Revocation.* `beta:revoke` (by sessionId) revokes the permit in SpacetimeDB and
  deletes the renewal record, even between visits. `renew_grant` refuses revoked
  permits (`expires_at_micros = 0`), permits the gateway did not issue and
  owner-issued permits, so a revoked character cannot come back through a replay
  or a stale Worker. Changing the gateway invalidates every renewal.
- *Expiry.* Renewal records expire 30 days after the last renewal, and are capped
  at 10,000. Renewals count against the 16 browser visits and 4-per-IP limits and
  the per-IP join rate limit, but not the 100 new visits per day.
- *Agents* keep their own flow. `bgr_` tokens are rejected by agent endpoints,
  agent sessions get no renewal token, and closing an agent session still revokes
  its permit immediately.
- *Multiple tabs* serialize renewal through a Web Lock and re-read storage; other
  tabs adopt the result through `storage` events. Up to four tabs may connect as
  one character.
- *Lost storage* just means a new guest on the next invite. There is no account
  recovery by design.
- *Privacy.* No names, emails or other personal data are collected. The renewal
  record holds the token digest, SpacetimeDB identity, sessionId, invite scopes
  and expiry. Browser session rows no longer store the browser's SpacetimeDB
  token, only its identity.

**Publishing.** The module change adds one reducer (`renew_grant`) and no table
or column, so the normal data-preserving publish above applies (no
`break-clients`). Publish the module first, then `npm run beta:deploy`; the
Worker adds its `renewals` table itself. Browsers admitted before the deploy have
no renewal token and behave as before until their next invite.

## Abuse and persistence limits

- Public sessions allow combat and chat; optional invites retain their chosen scopes. Permissions are enforced in the database.
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

### Character creator (appearance defaults)

The expanded creator appends nine `u8` choices (default `0`) and `setup_complete`
(default `false`) to `appearance`. Existing indices and the five-argument
`set_appearance` reducer remain compatible; that reducer preserves the new
fields. `save_character` validates and saves the name and full appearance in one
transaction. Previously named players keep their character; unfinished
`Player-*` newcomers open setup on arrival.

Publish with `--delete-data=never --yes=remote,skip-login,break-clients`, then
immediately deploy the Worker and frontend. This disconnects existing clients;
reload to load the new bindings. A local rehearsal from the previous main
module preserved the player's name, HP, position and all five existing choices,
with defaults applied to the appended fields.
