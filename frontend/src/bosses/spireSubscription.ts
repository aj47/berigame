import type { DbConnection } from '../module_bindings';

type Handle = { unsubscribe(): void };

/**
 * The per-run fight subscription (FINAL_SPEC 7.1), shared with the agent
 * gateway: watches your own spire_member row and, whenever its run changes,
 * subscribes `SELECT * FROM spire_fight WHERE run_id = <id>` first and then
 * drops the previous run's handle. No membership, no subscription. Overworld
 * clients therefore never receive other runs' fight rows. Returns a disposer.
 */
export function subscribeSpire(conn: DbConnection, identityHex: string, onError: () => void): () => void {
  const members = (conn.db as any).spireMember;
  let runId: bigint | null = null;
  let handle: Handle | undefined;

  const mine = (row: { identity: { toHexString(): string } }) => row.identity.toHexString() === identityHex;
  const drop = (h: Handle | undefined) => { try { h?.unsubscribe(); } catch { /* already ended */ } };
  const follow = (next: bigint | null) => {
    if (next === runId) return;
    runId = next;
    const previous = handle;
    handle = next === null ? undefined : conn
      .subscriptionBuilder()
      .onError(onError)
      .subscribe([`SELECT * FROM spire_fight WHERE run_id = ${next.toString()}`]);
    drop(previous);
  };
  const current = (): bigint | null => {
    for (const row of members?.iter?.() ?? []) if (mine(row)) return row.runId;
    return null;
  };

  const onInsert = (_ctx: unknown, row: any) => { if (mine(row)) follow(row.runId); };
  const onUpdate = (_ctx: unknown, _prev: any, row: any) => { if (mine(row)) follow(row.runId); };
  const onDelete = (_ctx: unknown, row: any) => { if (mine(row)) follow(null); };
  members?.onInsert(onInsert);
  members?.onUpdate?.(onUpdate);
  members?.onDelete(onDelete);
  follow(current());

  return () => {
    members?.removeOnInsert(onInsert);
    members?.removeOnUpdate?.(onUpdate);
    members?.removeOnDelete(onDelete);
    runId = null;
    drop(handle);
    handle = undefined;
  };
}
