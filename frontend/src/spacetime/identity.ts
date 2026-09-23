import type { Identity } from 'spacetimedb';

// The SDK formatter allocates a byte buffer and formats all 32 bytes. Reuse its
// exact encoding for UI keys, without retaining identities after rows disappear.
const hexCache = new WeakMap<Identity, { value: bigint; hex: string }>();
export function identityHex(identity: Identity): string {
  const cached = hexCache.get(identity);
  if (cached && cached.value === identity.__identity__) return cached.hex;
  const hex = identity.toHexString();
  hexCache.set(identity, { value: identity.__identity__, hex });
  return hex;
}
