/** HTTP work budgets. New-character creation cannot exhaust the renewal budget. */
/**
 * Agent sessions one gateway process or Durable Object hosts. Each session keeps only its own socket and private
 * rows; the world cache is one shared observer per host (game.ts ConnectionScope), so this is socket- and
 * CPU-bound, not memory-bound (docs/AGENT_API.md "Session shards").
 */
export const MAX_AGENT_SESSIONS_PER_SHARD = 250;
/** Session shards when the Worker's AGENT_SHARDS var is unset. 0 would host every session in the coordinator, as before. */
export const DEFAULT_AGENT_SHARDS = 8;
/** Session tokens carry their shard as one base64url character, so at most 64 shards. */
export const MAX_AGENT_SHARDS = 64;
/** AGENT_SHARDS as a shard count: an integer 0..64, else the default. */
export function agentShards(value: string | number | undefined): number {
  const n = Number(value ?? DEFAULT_AGENT_SHARDS);
  return Number.isInteger(n) && n >= 0 && n <= MAX_AGENT_SHARDS ? n : DEFAULT_AGENT_SHARDS;
}
/** Agent sessions a deployment can hold: per-shard cap x shards (one host when unsharded). */
export const agentSessionCapacity = (shards: number) => MAX_AGENT_SESSIONS_PER_SHARD * Math.max(1, shards);
/** 8 x 250 = 2000 agent sessions. The world's MAX_ONLINE_PLAYERS still caps who is online at once. */
export const MAX_AGENT_SESSIONS = agentSessionCapacity(DEFAULT_AGENT_SHARDS);
/** Per host: every session it holds at its full action and read budgets, with headroom for browser play. */
export const REQUEST_BUDGET = { burst: 4096, perSecond: 2560 };
export const JOIN_BUDGET = { burst: 256, perSecond: 8 };
export const NETWORK_JOIN_BUDGET = { burst: 256, perSecond: 4 };
export const RENEWAL_BUDGET = { burst: 512, perSecond: 32 };
export const CHARACTER_RENEWAL_BUDGET = { burst: 3, perSecond: 1 / 30 };

export function requestLane(path: string, method: string) {
  if (method === 'POST' && ['/api/play/v1/sessions', '/api/agent/v1/sessions'].includes(path)) return 'join';
  if (method === 'POST' && ['/api/play/v1/renewals', '/api/agent/v1/renewals'].includes(path)) return 'renew';
  return 'requests';
}

/**
 * Per-session agent budgets. Actions are sized for reacting every 600 ms tick (dodging telegraphs, eating
 * mid-fight); the game's own MAX_INPUTS_PER_TICK still caps bots and humans alike. Reads exclude actions.
 */
export const AGENT_ACTION_BUDGET = { burst: 10, perSecond: 5 };
export const AGENT_READ_BUDGET = { burst: 10, perSecond: 4 };
/** Distinct action receipts per session: the sustained action rate for the full one-hour session lifetime. */
export const MAX_SESSION_ACTIONS = AGENT_ACTION_BUDGET.perSecond * 3600;
/** Pacing hints advertised to agents, matching the sustained budgets above. */
export const AGENT_POLL_INTERVAL_MS = Math.ceil(1000 / AGENT_READ_BUDGET.perSecond);
export const AGENT_ACTION_INTERVAL_MS = Math.ceil(1000 / AGENT_ACTION_BUDGET.perSecond);
