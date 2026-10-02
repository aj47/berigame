/** Creates credentials/config only for the isolated local recovery check. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { DbConnection, tables } from "../src/module_bindings";
async function main() {
  const uri = "ws://127.0.0.1:3123",
    database = "settlements-validation-gateway";
  const output = resolve("../.spacetime-data/settlements-validation");
  const config = await readFile(`${output}/cli.toml`, "utf8");
  const ownerToken = JSON.parse(
    config.match(/spacetimedb_token\s*=\s*("[^"\n]+")/)![1],
  );
  const connect = (token?: string) =>
    new Promise<any>((resolve, reject) =>
      DbConnection.builder()
        .withUri(uri)
        .withDatabaseName(database)
        .withToken(token)
        .onConnectError((_c, e) => reject(e))
        .onConnect((conn, identity, token) =>
          conn
            .subscriptionBuilder()
            .onApplied(() => resolve({ conn, identity, token }))
            .subscribe([tables.world]),
        )
        .build(),
    );
  const owner = await connect(ownerToken),
    gateway = await connect();
  await owner.conn.reducers.configureAccess({
    gateway: gateway.identity,
    requireAdmission: true,
  });
  await owner.conn.reducers.configureExpansion({
    enabled: true,
    pauseCaptures: false,
  });
  const secrets = {
    GATEWAY_CREDENTIAL: JSON.stringify({
      uri,
      database,
      identity: gateway.identity.toHexString(),
      token: gateway.token,
    }),
    ADMIN_TOKEN: randomBytes(32).toString("hex"),
    RECOVERY_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  };
  await writeFile(`${output}/gateway-secrets.json`, JSON.stringify(secrets), {
    mode: 0o600,
  });
  await writeFile(
    `${output}/wrangler.json`,
    JSON.stringify({
      name: "berigame-frontier-validation",
      main: resolve("cloudflare/worker.ts"),
      compatibility_date: "2025-09-01",
      compatibility_flags: ["nodejs_compat"],
      alias: {
        spacetimedb: resolve("node_modules/spacetimedb/src/index.ts"),
        "#spacetime-wire": resolve(
          "node_modules/spacetimedb/src/sdk/client_api/types.ts",
        ),
      },
      vars: {
        ...secrets,
        PUBLIC_ORIGIN: "http://127.0.0.1:8789",
        SPACETIME_URI: uri,
        SPACETIME_DB: database,
      },
      durable_objects: {
        bindings: [{ name: "AGENT_GATEWAY", class_name: "AgentGateway" }],
      },
      migrations: [{ tag: "v1", new_sqlite_classes: ["AgentGateway"] }],
      ratelimits: [
        {
          name: "EDGE_LIMIT",
          namespace_id: "927472",
          simple: { limit: 120, period: 60 },
        },
      ],
    }),
    { mode: 0o600 },
  );
  owner.conn.disconnect();
  gateway.conn.disconnect();
  console.log(
    "Prepared isolated local gateway config. Credentials remain in ignored files.",
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
