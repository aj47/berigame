/**
 * Reducer calls in flight. A promise for a call sent on a socket that then
 * dies may never settle, which would leave buttons "busy" forever. When the
 * connection is lost every tracked call is rejected so the UI unlocks; the
 * server clears the character's queued interactions on disconnect anyway.
 */
const rejecters = new Set<(err: Error) => void>();

export class ConnectionLostError extends Error {
  constructor() {
    super('Connection lost');
    this.name = 'ConnectionLostError';
  }
}

export function trackCall<T>(call: Promise<T>): Promise<T> {
  let reject!: (err: Error) => void;
  const aborted = new Promise<never>((_, r) => { reject = r; });
  rejecters.add(reject);
  return Promise.race([call, aborted]).finally(() => rejecters.delete(reject));
}

export function abortPendingCalls(): number {
  const n = rejecters.size;
  for (const reject of [...rejecters]) reject(new ConnectionLostError());
  rejecters.clear();
  return n;
}

export function pendingCallCount(): number {
  return rejecters.size;
}
