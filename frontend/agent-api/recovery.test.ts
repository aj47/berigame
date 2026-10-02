import { test } from "node:test";
import assert from "node:assert/strict";
import { openRecovery, sealRecovery } from "./recovery";
import { validateAction } from "./contract";

test("recovery encrypts credentials with a fresh nonce and authenticates every byte", () => {
  const payload = {
    identity: "a".repeat(64),
    token: "private-test-credential",
  };
  const sealed = sealRecovery(payload, "test-only-key");
  assert.deepEqual(openRecovery(sealed, "test-only-key"), payload);
  assert.notEqual(sealRecovery(payload, "test-only-key"), sealed);
  assert.ok(
    !Buffer.from(sealed, "base64url").includes(Buffer.from(payload.token)),
  );
  assert.throws(() => openRecovery(sealed, "wrong-key"));
  for (const at of [0, 12, 28]) {
    const bytes = Buffer.from(sealed, "base64url");
    bytes[at] ^= 1;
    assert.throws(() =>
      openRecovery(bytes.toString("base64url"), "test-only-key"),
    );
  }
  assert.throws(() => openRecovery("short", "test-only-key"));
  assert.throws(() => sealRecovery(payload, ""));
});

test("frontier HTTP contract rejects malformed nested commands as client errors", () => {
  for (const command of [
    "{",
    "null",
    '{"action":"claim","admin":true}',
    '{"action":"move","x":128,"z":4}',
    '{"action":"specialize","disciplines":[0,0]}',
  ]) {
    assert.throws(
      () => validateAction("frontier", { command }),
      (e: any) => e.status === 400,
    );
  }
  assert.equal(
    validateAction("frontier", { command: '{"action":"move","x":127,"z":4}' })
      .command,
    '{"action":"move","x":127,"z":4}',
  );
});
