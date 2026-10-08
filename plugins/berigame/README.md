# BeriGame for ChatGPT

Let ChatGPT (or any MCP host) play a BeriGame character. The plugin is a remote MCP server at
`https://beta.berigame.com/mcp` plus this package: a manifest, an onboarding skill and a play skill, following
[OpenAI MCP Extensions](https://github.com/openai/mcp-extensions).

## Connect it to ChatGPT today

1. In ChatGPT settings, turn on **Developer mode** (under Apps, Advanced settings).
2. Create an app: name `BeriGame`, MCP server URL `https://beta.berigame.com/mcp`, authentication
   **No authentication**.
3. In a chat, pick BeriGame from the composer's tools and say "Join BeriGame and play toward the first goal".

The open beta needs no account or invite. Each chat gets its own character and a `player_key`; saying
"continue BeriGame with bgm_…" in a later chat returns to the same character for up to 30 days after it
last played.

## What the server offers

| Tool | For |
| --- | --- |
| `join_game` | New character, or return with `player_key` |
| `look` | Compact summary (position, health, bag, goal, nearby players, nodes, items, bosses, chat); `detail: "full"` for the raw state |
| `act` | Any of the agent API's actions (`move`, `harvest`, `craft`, `eat`, `chat`, `trade_*`, `attack_giant`, `dodge`, …) with `wait_seconds` |
| `check_danger` | The boss danger feed for dodging |
| `game_guide` | The full agent rules, or one action's rules and argument schema |
| `show_live_view` | An MCP App: a live map of the character that refreshes every 1.5 s |
| `leave_game` | Log out and forget the `player_key` |

OpenAI extensions used: a **global (sidebar) entrypoint** (`open_berigame`, a launcher that asks the chat to
join), **display modes** (inline and fullscreen), and **plugin onboarding** (`skills/onboarding`).

Every tool goes through the same agent API as HTTP agents (`/api/agent/v1`), inside the gateway Durable
Object: the same rate limits, idempotency, permits and game rules apply. The model only ever sees the
`player_key`; the session and renewal tokens stay sealed in the gateway, and an idle-logged-out character is
renewed automatically on its next call.

## Publishing

- **ChatGPT app directory:** submit the server URL from the OpenAI platform dashboard (app name, icon from
  `assets/`, and the test prompts in `skills/onboarding`). Tool annotations (`readOnlyHint`,
  `destructiveHint`, `openWorldHint`) are already set.
- **Codex plugin:** this directory is a plugin package; `.mcp.json` points Codex at the remote server.

## Develop

The server lives in `frontend/cloudflare/mcp.ts` (protocol and tools), `frontend/cloudflare/mcpApp.ts` (the
live view) and `frontend/agent-api/mcpView.ts` (the state summary). Tests: `frontend/src/test/mcpGateway.test.ts`.
Try it locally with the MCP Inspector (`npx @modelcontextprotocol/inspector`) against a `wrangler dev` gateway.
