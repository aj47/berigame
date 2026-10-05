# Cloudflare + SpacetimeDB beta

- Website and HTTP agent API: Cloudflare Worker `berigame-beta`, custom domain `beta.berigame.com`.
- Game simulation and persistent player state: self-hosted SpacetimeDB 2.10.1 on the
  exe.dev VM `berigame-db` (`wss://berigame-db.exe.xyz`), database `berigame-beta`.
  Maincloud hosted it until October 5, 2026; the move started a fresh world.
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

`beta:deploy` builds the website with the game server settings and browser admission
enabled, then deploys the Worker, static assets, bindings and custom domain. Worker
secrets are retained on updates. The secrets are `GATEWAY_CREDENTIAL` (the
JSON credential of the limited gateway identity), `ADMIN_TOKEN` (operator API),
and `RECOVERY_ENCRYPTION_KEY` (stable encryption key for character recovery).
Neither belongs in frontend build variables or Git.

Database changes are a separate publish, made on the VM as the owner identity
(`c2006088…a4ad`, the VM's own `spacetime` CLI login). nginx exposes only
`/v1/identity` and the `berigame-beta` subscribe endpoint, so publishing never
goes over the public URL. The VM has no Node, so build locally and copy the bundle:

```sh
.spacetime-data/tools/spacetimedb-cli build --module-path spacetimedb   # or `spacetime build` in spacetimedb/
scp -i ~/.ssh/exe_dev_techfren spacetimedb/dist/bundle.js berigame-db.exe.xyz:/tmp/berigame-bundle.js
ssh -i ~/.ssh/exe_dev_techfren berigame-db.exe.xyz \
  'spacetime publish --server http://127.0.0.1:3000 --js-path /tmp/berigame-bundle.js \
     --delete-data=never --yes berigame-beta'
```

Never use `--delete-data` to resolve a schema conflict.
Use a data-preserving migration and regenerate frontend bindings when required.
The sections below were written for Maincloud; apply the same flags to the VM
publish above (for example `--yes=break-clients` for a breaking release).

### Self-hosted server (exe.dev VM `berigame-db`)

- SpacetimeDB 2.10.1 runs as the `spacetimedb` systemd service on
  `127.0.0.1:3000`, data in `/var/lib/spacetimedb`, nightly backups in
  `/var/backups/spacetimedb/` (7 kept).
- nginx on port 80 (`/etc/nginx/sites-available/spacetimedb`) proxies only
  `^/v1/(identity|identity/websocket-token|database/berigame-beta/subscribe)$`
  (browsers POST `websocket-token` before subscribing)
  with WebSocket upgrade and per-client rate limits; every other `/v1/` path is
  404. exe.dev terminates TLS and forwards to port 80
  (`ssh exe.dev share port berigame-db 80`, `share set-public berigame-db`).
- Limits live in `/etc/nginx/conf.d/stdb-rate.conf`, sized for about 250 players. The exe.dev
  proxy connects from `127.0.0.1` and appends the client address as the last
  `X-Forwarded-For` entry, so `set_real_ip_from 127.0.0.1` with
  `real_ip_recursive off` yields the real, unspoofable client address. Without
  it every player shares one address and the per-client cap becomes a world cap
  (on October 5, 2026 that froze the beta at 20 sockets). Per client: 5 req/s
  (burst 10) and 20 sockets. Cloudflare egress (`/etc/nginx/cloudflare-ips.conf`,
  from cloudflare.com/ips), where the Worker holds one socket per agent session,
  gets 100 req/s (burst 300) and 300 sockets per address, enough for 250 agent
  sessions. The whole server is
  capped at 400 sockets; game admission still stops at 256 players and 64 agent
  sessions. nginx runs `worker_connections 4096` and `worker_rlimit_nofile 16384`,
  and SpacetimeDB has `LimitNOFILE=65536` (`spacetimedb.service.d/limits.conf`).
- `systemctl reload nginx` reports success even when nginx rejects the new
  config at runtime (for example, a zone reused with a different key); check
  `/var/log/nginx/error.log` and the worker start times after every reload.
- Unlike Maincloud, the server issues its own identities, so Maincloud-era
  characters and recovery files do not carry over.
- The Worker gateway identity lives in `.spacetime-data/deploy-exe/gateway.json`
  and is the `GATEWAY_CREDENTIAL` secret. It was configured with
  `configure_access "<gateway identity>" true`, and the expansion with
  `configure_expansion true false`.
- Owner commands (`spacetime call|sql|logs --server http://127.0.0.1:3000 berigame-beta …`)
  run over SSH on the VM.

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
`cli.toml` owned the former Maincloud database (the VM's CLI owns the current one); `gateway.json` can provision and revoke
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

Admission still goes through the gateway: database admission, hourly permits,
revocation and returning-browser renewal remain enforced. LANs share a generous
new-character creation budget, with no per-IP player cap. The database is not opened
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
  at 10,000. Renewal is limited per character (burst 3, replenishing once per
  30 seconds), independently of the network's new-character creation budget.
  A saved permit or browser visit record does not occupy an online world slot.
- *Agents* receive a renewal token too. Ending a session suspends its visit while
  keeping the character renewable; operator revocation permanently ends access.
  Agent and browser renewal endpoints reject tokens for the other player kind.
- *Multiple tabs* serialize renewal through a Web Lock and re-read storage; other
  tabs adopt the result through `storage` events. Up to four tabs may connect as
  one character.
- *Lost storage* creates a new guest unless the player saved the character to an
  account (below) or exported a character recovery file from the settlements menu;
  see [Settlements](SETTLEMENTS.md).
- *Privacy.* Guests give no names, emails or other personal data. The renewal
  record holds the token digest, SpacetimeDB identity, sessionId, invite scopes
  and expiry. Browser session rows no longer store the browser's SpacetimeDB
  token, only its identity.

**Publishing.** The module change adds one reducer (`renew_grant`) and no table
or column, so the normal data-preserving publish above applies (no
`break-clients`). Publish the module first, then `npm run beta:deploy`; the
Worker adds its `renewals` table itself. Browsers admitted before the deploy have
no renewal token and behave as before until their next invite.

## Player accounts

Guests can save their character to an account from **Settings → Account** and log
in on any browser from the title screen. Logins: Discord, Google, email (a link
plus a 6-digit code) and passkeys. An account unlocks exactly one character and
never changes its SpacetimeDB identity: it stores the same sealed credential as a
recovery key. Accounts live in the gateway Durable Object (`accounts`,
`account_logins`, `account_sessions`, `account_pending`); SpacetimeDB is unchanged.

**Flow.** Saving sends the visit renewal token as proof plus the character token,
which the Worker verifies against the world before sealing it with
`RECOVERY_ENCRYPTION_KEY`. Logging in returns an account token (`bgu_…`, 180 days,
extended on use). `POST /api/play/v1/account/play` with that token returns the
character token and a fresh renewal token, replacing any other browser's renewal;
a browser that holds an account token silently takes it back at its next renewal.
Discord and Google return through `/api/play/v1/account/oauth/{provider}/callback`
to `/play#account`; the OAuth state is bound to an HttpOnly `__Host-` cookie, and
the account token is only handed to that browser by `POST …/oauth/finish`.

**Rules.** Only saving a character creates an account, so a login with no saved
character is refused. A login belongs to one account; an account has at most 10
logins and cannot remove its last one. Revoking a character (`beta:revoke`) also
detaches it from its account.

**Limits and privacy.** Login emails: 3 per address and 5 per network, then one
every 10 minutes each, and 200 per hour in total; 5 code attempts per email. Account requests are
limited per network, saving and playing per character and account. Emails are
stored only as a digest plus a masked label (`p•••@example.com`); Discord
keeps the user id and display name, Google the subject id and masked email,
passkeys the credential id, public key and counter. Session tokens, codes and
OAuth state are stored as digests or sealed.

**Setup.** The beta configuration is live as of Oct 5, 2026. The Worker reports
Discord, Google, email and passkeys enabled at
`GET /api/play/v1/account/providers`. Cloudflare Email Sending is enabled for
`berigame.com`; the OAuth clients and callback URLs are configured. Real email
delivery and complete browser sign-in flows have not yet been verified. For a
fresh environment, configure the methods below. A method appears only once
configured; passkeys need nothing.

- *Email:* onboard `berigame.com` in Cloudflare Email Service. The `EMAIL`
  `send_email` binding and `EMAIL_FROM` (`login@berigame.com`) are in
  `wrangler.jsonc`.
- *Discord:* create an application at discord.com/developers, add the redirect
  `https://beta.berigame.com/api/play/v1/account/oauth/discord/callback`, then
  `wrangler secret put DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.
- *Google:* create an OAuth web client in Google Cloud with the redirect
  `https://beta.berigame.com/api/play/v1/account/oauth/google/callback`, then
  `wrangler secret put GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Use `--config frontend/cloudflare/wrangler.jsonc` with each `wrangler secret put`.

## Abuse and persistence limits

- Public sessions allow combat and chat; optional invites retain their chosen scopes. Permissions are enforced in the database.
- At most **256 online characters per world**, counted in SpacetimeDB on connection.
  Multiple tabs share one character slot (at most four connections per character).
  The last disconnect frees the slot immediately; unexpired offline permits do
  not reserve slots. Online characters can renew even when the world is full.
- At most **250 agent API connections**, including pending connections, so a
  whole world can be agents. The gateway admits 2,560 requests/second (burst
  4,096) across all sessions and 512 in flight. Browser
  visit records have a 10,000-row storage bound, separate from online capacity.
- **No per-IP player cap and no daily join/request shutdown.** Daily totals remain
  counters only. New-character creation allows a burst of 256 per network and
  replenishes at 4/second; the shared creation budget replenishes at 8/second.
  Joining players, renewing players and ordinary requests have separate budgets.
- Renewals allow a shared burst of 512, replenishing at 32/second, plus the
  per-character limit above. Ordinary API traffic allows a burst of 1,024 and
  replenishes at 256/second. Individual agent read/action limits still apply.
- At most 128 requests in flight, of which at most 32 may create new characters,
  leaving room for returning players during a join burst. `Retry-After` tells
  waiting players when to try again; browser retries add a small random delay.
- Edge limits allow 1,200 requests/minute per credential digest, or per network
  for anonymous traffic. Credential-shaped requests still require server-side
  authentication. An IP address is never evidence of character ownership.
- At most 256 unredeemed invites and 1,024 action receipts per API session.
- SpacetimeDB also caps the world at 10,000 lifetime guest permits/characters.
- Edge rate limiting, durable request/creation/character budgets, 4 KiB bodies, strict
  action schemas and same-origin browser requests.
- Limits count denied/invalid authenticated requests as well as successful ones.
- Invite consumption and slot reservation commit together. Receipts persist
  across restarts. An action left with an uncertain result closes the session
  instead of being issued again. A lost join response requires a new invite.
- Expired session credentials and receipts are removed by a Durable Object alarm.
  Database permits expire independently if the gateway is unavailable.
- One coordinator limits the number of active Durable Objects. Its upstream
  sockets close when no API session needs them. Expiry cleanup runs at most once
  every 30 seconds instead of scanning every table on every API call. Logs do not include credentials,
  request bodies or player chat; request observability is disabled.

### Capacity verification and rollout

The 256-player setting is an admission safety bound, **not a production load-test
result**. Tests exercise 256 browser joins behind one address, 64 local and hosted
agent sessions, pending-slot races, renewal during join saturation, direct world
connection limits, and slot release after the last tab disconnects.

`frontend/scripts/admission-smoke.ts` also verifies these checks with real SDK
connections against a disposable loopback database. On 2026-10-02 it connected
256 characters, rejected a 257th, renewed a connected character at capacity,
reused a disconnected character's slot, and observed 10 more world ticks. This
used minimal world/player subscriptions, not full browser clients or production
infrastructure. A full gameplay load test is still needed.

To repeat, start an isolated SpacetimeDB on `127.0.0.1:45991`, publish this module
to a new `berigame-admission-check` database with an isolated CLI configuration,
and write that disposable owner's token to an owner JSON file. Then run:

```sh
BERIGAME_ADMISSION_CHECK_URI=ws://127.0.0.1:45991 \
BERIGAME_ADMISSION_CHECK_DB=berigame-admission-check \
BERIGAME_ADMISSION_CHECK_OWNER=/path/to/disposable-owner.json \
BERIGAME_ADMISSION_CHECK_OUTPUT=/path/to/result.json \
frontend/node_modules/.bin/tsx frontend/scripts/admission-smoke.ts
```

Stop that isolated server afterwards. The script refuses production addresses.

The current deployment still uses one world database and one admission coordinator.
Larger MMO populations need multiple worlds or regions with separate coordinators,
plus measurements of tick latency, subscription fan-out, client frame time and
reconnect bursts. See [Cloudflare's scaling guidance](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
for the coordinator boundary. Do not raise the constant as a substitute for those measurements.

This change does not add or reorder database columns. Publish the module with
`--delete-data=never`, then the Worker and browser bundle together. Check the
working tree first: an ordinary deploy includes all other local changes. The
public `/api/agent/v1` status response reports configured capacity so a rollout
can be verified without joining as a player.

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


### Settlements schema and recovery

The settlements release appends `player.region` (default `bramblewild`) and
`trade.a_coins` / `trade.b_coins` (default `0`). It adds the Frontier tables and
reducers. Existing player data is preserved. Save a private database export,
then publish with `--delete-data=never --yes=remote,skip-login,break-clients` and
immediately deploy the matching beta Worker and client. Existing players reload.

Set a stable `RECOVERY_ENCRYPTION_KEY` before the first recovery export. Preserve
it on later deployments: rotating the key without migrating existing recovery
records makes those files unusable. The Worker adds its recovery SQL table and
index without resetting its Durable Object. Never use the local-only
`frontier-gateway-setup.ts` against production.

The expansion remains disabled until the owner calls `configure_expansion`.
Publishing alone does not enable it. Follow the checks and rollout controls in
[Settlements](SETTLEMENTS.md) before activating it.

The public beta was enabled on October 2, 2026 with `configure_expansion true false`
after deploying the connected Meadows module and client. The owner config was
read back as `enabled: true`, `pausedAt: 0`. Existing data was preserved with
`--delete-data=never`; all 40 tables were privately exported before deployment.
