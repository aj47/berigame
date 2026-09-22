# Agent API

The agent API is a Node service that keeps a SpacetimeDB SDK connection for each
player session. It calls the same authoritative reducers as the browser game.
It uses the dependencies already installed in `frontend/`; there is no separate
framework or database service to install. Node 22 or later is required.

`/agent` is the shareable onboarding page. It does not connect a player to the
world. `/agent.md` is the static, machine-readable guide, and
`/api/agent/v1/openapi.json` describes the HTTP contract. WebMCP remains available
in the regular game view on browsers that support it.

## World admission

API limits alone would be bypassable through direct SpacetimeDB clients. The
gateway therefore **refuses to start unless server admission is enabled** and
its identity matches the configured gateway. In that mode, uninvited connections
are rejected before a player row is created. Every gameplay reducer also checks
admission. Expiring or revoking a permit stops ongoing actions on the next tick,
even if the client keeps its connection open.

Admission covers **all players in that world**, including browser players.
The world owner can grant human permits with `grant_player`; agents receive
one-hour-or-shorter permits from a separate gateway identity. The gateway cannot
change admission policy, grant human access, renew agent permits, impersonate an
existing character, or appoint another gateway. A combat-restricted player also
cannot be targeted by another player. Changing the gateway invalidates permits
issued by the previous gateway.

New databases capture their publishing identity as the owner during `init`.
Normal local play initially keeps anonymous admission so `npm run play` keeps
working. **Older databases that predate `access_policy` need an owner-controlled,
data-preserving migration before the API can be enabled.** The gateway fails
closed when that record is missing. There is deliberately no public
“first caller becomes owner” bootstrap, and no automatic reset of existing data.
For the first API deployment, use a new admitted world, then plan the migration
of any existing shared world separately.

## Set up a new local world

From the repository root, with the local SpacetimeDB server already running:

```sh
export BERIGAME_AGENT_URI=ws://127.0.0.1:3000
export BERIGAME_AGENT_DB=berigame-agents
spacetime publish --server local --module-path spacetimedb berigame-agents
npm run agent:setup
```

Setup creates a separate gateway credential in `.agent-api-data/gateway.json`
(mode 0600 inside a mode 0700 directory). It prints a `configure_access` command
containing only the gateway's public identity. Run that command using the same
CLI identity that published the database. It enables admission for this world.
An existing gateway file is never overwritten.

Then start the API and frontend in separate terminals:

```sh
npm run agent:serve
npm run dev --prefix frontend
```

Vite proxies `/api/agent` to `http://127.0.0.1:3001` by default. Visit
`http://127.0.0.1:5173/agent`. For a different API port, set
`BERIGAME_AGENT_API_ORIGIN` when starting Vite. The browser game's
`VITE_SPACETIME_DB` setting is independent of the agent service's database setting.

Issue an invite:

```sh
npm run agent:invite
# Explicit opt-ins:
npm run agent:invite -- --combat --chat
```

The code is shown once. Give the agent the onboarding URL and provide the code
privately, outside the URL. Codes expire after 24 hours and are single-use. The
store keeps hashes, capabilities and expiry, not the original invite codes.
Atomic file renames consume invites durably, including concurrent redemption
attempts and API restarts. If connection provisioning or delivery fails after
redemption, issue a replacement code; consumed codes are not restored.

## Call the API

```sh
curl -X POST http://127.0.0.1:3001/api/agent/v1/sessions \
  -H "Authorization: Bearer $BERIGAME_INVITE" \
  -H 'Content-Type: application/json' -d '{}'
```

The response contains `token`, `sessionId`, `playerId`, `expiresAt`, and
`permissions`. Save the token privately as `BERIGAME_SESSION` in your agent's
credential store. Underlying SpacetimeDB credentials are never returned.

```sh
curl http://127.0.0.1:3001/api/agent/v1/state \
  -H "Authorization: Bearer $BERIGAME_SESSION"

curl -X POST http://127.0.0.1:3001/api/agent/v1/actions/harvest \
  -H "Authorization: Bearer $BERIGAME_SESSION" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $ACTION_UUID" -d '{}'

curl -X DELETE http://127.0.0.1:3001/api/agent/v1/session \
  -H "Authorization: Bearer $BERIGAME_SESSION"
```

All action requests need an Idempotency-Key. Use a UUID, reuse it for a retry
with the same arguments, and create a new key for each new intended action.
Receipts remain for the whole session; conflicting reuse is rejected. Only one
action can be in flight per session. A timeout closes the session because the
action outcome may be uncertain. An accepted move or harvest may still be in
progress; read state to observe completion.

To revoke a player as the gateway operator:

```sh
npm run agent:revoke -- PLAYER_ID
```

The world owner can also call `revoke_player` directly. The API checks the
live player before returning state or sending actions. Restarting the API
invalidates its in-memory bearer tokens; the database independently enforces
permit expiration if the API process crashes.

## Abuse controls

| Boundary | Enforced limits |
| --- | --- |
| Admission | Single-use invite; separate identity per session; server permit required even for direct SDK calls |
| Session | At most 1 hour total, 10 minutes idle, 1024 distinct action receipts |
| Actions | 1 attempt/second, burst 4; invalid arguments and denied scopes consume the same budget |
| Session requests | 2/second, burst 10 |
| IP requests | 2/second, burst 60; all paths and failed authentication count |
| IP joins | 1/minute, burst 5, including invalid invite attempts |
| Global requests | 20/second, burst 200; 64 requests in flight; 128 HTTP connections |
| API sessions | 16 total, 4 per IP, including pending connections |
| Database | 32 active agent permits; 128 online players; 4 connections per identity; 10,000 historical players/permits |
| Existing gameplay | 5 committed inputs/tick, server movement/combat/harvest/eating rules; 3-second chat cooldown |
| Payloads | 4 KiB JSON bodies; 8 KiB headers; strict fields, types, bounds and action allowlist; body deadline 3 seconds |

Tokens contain 256 random bits. Only session-token hashes are retained by the
HTTP service. Credentials are accepted only in Authorization headers; query
strings are rejected. Responses use `no-store`. Logs contain event type, public
session/player IDs, action and status; they omit tokens, headers, request bodies,
chat text, and upstream errors. Player names/chat are labeled untrusted in state.
Inventory is scoped by both the database visibility filter and the API response.

## Deployment boundary

Run **one API process** per admitted world with its private data directory on a
persistent local disk. Invite redemption is durable, but sessions and rate
buckets are process-local. Multiple replicas require a shared session/limiter
service and a coordinated invite store before they are supported.

Bind the service to loopback (the default), use an HTTPS reverse proxy, and
proxy `/api/agent` on the frontend origin to it. Serve `/agent.md` as a static
`text/plain; charset=utf-8` file so browsers display it inline, and rewrite
`/agent` to the frontend entrypoint. Configure
`BERIGAME_AGENT_ORIGIN=https://your-game-origin.example`.

The API ignores forwarded IP headers by default. If behind a proxy, set
`BERIGAME_AGENT_TRUSTED_PROXY_IPS` to the exact connecting proxy addresses. Those
proxies must **overwrite** X-Forwarded-For with one validated client address, and
the API port must be reachable only by those proxies. Header chains are rejected.
Without this setting, clients behind the same proxy intentionally share IP limits.

Add connection/request limits at the public reverse proxy for **both the API
and the raw SpacetimeDB endpoint**. Application limits constrain admitted play;
they cannot absorb network floods or eliminate the cost of rejected WebSocket
handshakes. Direct reducer validation also cannot charge rejected calls to a
persistent counter because reducer errors roll back their transactions.

[`deploy/nginx-agent-api.conf.example`](../deploy/nginx-agent-api.conf.example)
provides a single-origin HTTPS example with request and connection limits on
both services, overwritten client IP headers, and logs that omit query strings.
It is a deployment template, not an enabled or deployment-validated config;
replace its domain, certificate paths, frontend root and database name in the
WebSocket allowlist, then run `nginx -t` on the target host. Keep both upstream
ports private. Only identity creation and that world's subscription endpoint
are public; publish and administer databases over loopback or an SSH tunnel.
Do not proxy all SpacetimeDB routes: standalone servers otherwise allow remote
database creation. See the [SpacetimeDB self-hosting guide](https://spacetimedb.com/docs/how-to/deploy/self-hosting/).
Its WebSocket limits cover
handshakes and connection counts, not messages within an established socket.
The directives follow nginx's [request limiting](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html),
[connection limiting](https://nginx.org/en/docs/http/ngx_http_limit_conn_module.html),
and [WebSocket proxying](https://nginx.org/en/docs/http/websocket.html) documentation.

Environment: `BERIGAME_AGENT_URI`, `BERIGAME_AGENT_DB`, `BERIGAME_AGENT_DATA`,
`BERIGAME_AGENT_HOST` (default 127.0.0.1), `BERIGAME_AGENT_PORT` (default 3001),
`BERIGAME_AGENT_ORIGIN`, `BERIGAME_AGENT_TRUSTED_PROXY_IPS`. Remote SpacetimeDB
connections require WSS. Never expose gateway files in the frontend build,
commit them, or use a world-owner credential for the service.

## Verification

`npm test` includes simulation/reducer tests, frontend tests and API abuse tests.
Run `npm run agent:typecheck --prefix frontend` and
`npm run build --prefix frontend` as well.

`frontend/agent-api/integration.ts` drives the actual HTTP API against an isolated
SpacetimeDB server at `127.0.0.1:3010`. It requires
`BERIGAME_AGENT_INTEGRATION=1`, a database name starting with
`berigame-agent-api-check`, `BERIGAME_AGENT_TEST_OWNER` pointing to its disposable
owner credential JSON, and `BERIGAME_AGENT_TEST_DATA` pointing to its private test
directory. It checks real gameplay, separate identities, invite replay, scope
enforcement, direct connection rejection, revocation and throttling. It never
targets the ordinary game world.
