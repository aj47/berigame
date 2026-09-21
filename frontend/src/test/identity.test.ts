import { describe, expect, it } from 'vitest';
import { Identity } from 'spacetimedb';
import { identityHex } from '../spacetime/identity';

describe('presentation identity encoding', () => {
  it('preserves SDK byte order and zero padding across the full u256 range', () => {
    for (const value of [0n, 1n, 255n, 256n, 1n << 255n, (1n << 256n) - 1n]) {
      const id = new Identity(value);
      expect(identityHex(id)).toBe(id.toHexString());
      expect(Identity.fromString(identityHex(id)).__identity__).toBe(value);
    }
  });
  it('does not return a previous key when the SDK public value changes', () => {
    const id = new Identity(1n);
    const before = identityHex(id);
    id.__identity__ = 256n;
    expect(identityHex(id)).toBe(id.toHexString());
    expect(identityHex(id)).not.toBe(before);
  });
});
