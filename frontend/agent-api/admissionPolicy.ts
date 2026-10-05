/** HTTP work budgets. New-character creation cannot exhaust the renewal budget. */
export const MAX_AGENT_SESSIONS = 64;
export const REQUEST_BUDGET = { burst: 1024, perSecond: 256 };
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
