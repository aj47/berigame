import { describe, expect, it } from 'vitest';
import { loadSpireScene } from '../bosses/spire/loadSpireScene';

describe('loadSpireScene', () => {
  it('does not cache a failed chunk load: the next call fetches again, then keeps the success', async () => {
    let calls = 0;
    const flaky = () => { calls++; return calls === 1 ? Promise.reject(new Error('chunk 404')) : Promise.resolve({} as any); };
    await expect(loadSpireScene(flaky)).rejects.toThrow('chunk 404');
    const ok = loadSpireScene(flaky);
    await expect(ok).resolves.toEqual({});
    expect(loadSpireScene(flaky)).toBe(ok);
    expect(calls).toBe(2);
  });
});
