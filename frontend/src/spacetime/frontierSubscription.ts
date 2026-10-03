import type { DbConnection } from "../module_bindings";

/** Subscribe to local geometry while keeping the small ownership directory visible. */
export function subscribeFrontier(
  conn: DbConnection,
  identity: string,
  onError: () => void,
) {
  conn
    .subscriptionBuilder()
    .onError(onError)
    .subscribe([
      "SELECT * FROM frontier_object WHERE kind = 'config'",
      "SELECT * FROM frontier_object WHERE kind = 'claim'",
      "SELECT * FROM frontier_object WHERE kind = 'boat'",
      "SELECT * FROM frontier_object WHERE kind = 'creature'",
    ]);
  let current = "";
  let subscription: { unsubscribe(): void } | undefined;
  const update = () => {
    const self = [...conn.db.player.iter()].find(
      (p) => p.identity.toHexString() === identity,
    );
    const actualRegion = self?.region || "bramblewild";
    // Both districts share a scene; retain Meadows geometry across the walking seam.
    const region = actualRegion === "bramblewild" ? "settlement" : actualRegion;
    if (
      current === region ||
      !["bramblewild", "settlement", "reedwake", "cinder", "sea"].includes(
        region,
      )
    )
      return;
    current = region;
    subscription?.unsubscribe();
    subscription = conn
      .subscriptionBuilder()
      .onError(onError)
      .subscribe(
        ["building", "crop", "drop", "resource"].map(
          (kind) =>
            `SELECT * FROM frontier_object WHERE kind = '${kind}' AND region = '${region}'`,
        ),
      );
  };
  conn.db.player.onInsert(update);
  conn.db.player.onUpdate(update);
  update();
}
