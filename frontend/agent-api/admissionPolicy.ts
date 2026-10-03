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
