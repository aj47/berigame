import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
/** Recovery records are encrypted separately from bearer-token digests. Never log either. */
export function sealRecovery(value: unknown, secret: string): string {
  if (!secret) throw new Error("Recovery encryption key is unavailable");
  const key = createHash("sha256")
    .update("berigame-recovery-v1\0" + secret)
    .digest();
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function openRecovery<T>(sealed: string, secret: string): T {
  const bytes = Buffer.from(sealed, "base64url");
  if (bytes.length < 29) throw new Error("Invalid recovery record");
  const key = createHash("sha256")
    .update("berigame-recovery-v1\0" + secret)
    .digest();
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(28)),
      decipher.final(),
    ]).toString("utf8"),
  );
}
