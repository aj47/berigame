/** Local Worker + SpacetimeDB recovery integration. Never uses hosted secrets. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DbConnection, tables } from "../src/module_bindings";
const origin = "http://127.0.0.1:8789";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  const secrets = JSON.parse(
    await readFile(
      "../.spacetime-data/settlements-validation/gateway-secrets.json",
      "utf8",
    ),
  );
  const testIp = `recovery-check-${Date.now()}`;
  const request = async (
    path: string,
    token?: string,
    body: any = {},
    ip = testIp,
  ) => {
    const res = await fetch(origin + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": ip,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = res.status === 204 ? {} : await res.json();
    return { status: res.status, data };
  };
  const visit = await request("/api/play/v1/sessions");
  assert.equal(visit.status, 201, JSON.stringify(visit.data));
  const v = visit.data;
  assert.equal(v.database, "settlements-validation-gateway");
  assert.equal(v.uri, "ws://127.0.0.1:3123");
  const conn = await new Promise<DbConnection>((resolve, reject) =>
    DbConnection.builder()
      .withUri(v.uri)
      .withDatabaseName(v.database)
      .withToken(v.token)
      .onConnectError((_c, e) => reject(e))
      .onConnect((conn) =>
        conn
          .subscriptionBuilder()
          .onApplied(() => resolve(conn))
          .subscribe([tables.player, tables.frontierView]),
      )
      .build(),
  );
  try {
    await conn.reducers.setTarget({ x: 22, z: 18 });
    for (let n = 0; n < 50; n++) {
      const p = [...conn.db.player.iter()].find(
        (p) => p.identity.toHexString() === v.playerId,
      );
      if (p && Math.max(Math.abs(p.x - 22), Math.abs(p.z - 18)) <= 4) break;
      await wait(300);
    }
    await conn.reducers.frontierAction({ command: '{"action":"enter"}' });
    const exported = await request("/api/play/v1/recovery", v.renewToken, {
      token: v.token,
    });
    assert.equal(exported.status, 200, JSON.stringify(exported.data));
    assert.match(exported.data.recoveryToken, /^bgk_/);
    const restored = await request(
      "/api/play/v1/recover",
      exported.data.recoveryToken,
    );
    assert.equal(restored.status, 200);
    assert.equal(restored.data.playerId, v.playerId);
    assert.equal(restored.data.token, v.token);
    assert.notEqual(restored.data.recoveryToken, exported.data.recoveryToken);
    assert.equal(
      (await request("/api/play/v1/recover", exported.data.recoveryToken))
        .status,
      401,
    );
    const renewed = await request(
      "/api/play/v1/renewals",
      restored.data.renewToken,
    );
    assert.equal(renewed.status, 200, JSON.stringify(renewed.data));
    assert.equal(renewed.data.playerId, v.playerId);
    assert.ok(Date.parse(renewed.data.expiresAt) <= Date.now() + 3601000);
    const revoked = await request("/api/admin/revoke", secrets.ADMIN_TOKEN, {
      sessionId: v.sessionId,
    });
    assert.equal(revoked.status, 204);
    assert.equal(
      (
        await request(
          "/api/play/v1/recover",
          restored.data.recoveryToken,
          {},
          testIp + "-revoked",
        )
      ).status,
      401,
    );
    console.log(
      "PASS local Worker recovery: encrypted export, same-character restore, rotated one-use key, bounded permit renewal, admin revocation.",
    );
  } finally {
    conn.disconnect();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
