import { describe, expect, it, vi } from 'vitest';
import { adventureTables } from './adventureHarness';
import { newProfile } from '../frontier/model';
import { PATH_FIELDS } from '../adventure';
vi.mock('../../../spacetimedb/node_modules/spacetimedb/dist/server/index.mjs', () => ({
  t: new Proxy({}, { get: () => () => ({}) }), SenderError: class SenderError extends Error {},
}));
vi.mock('../../../spacetimedb/src/schema', () => ({ default: { reducer: (...args: unknown[]) => args.at(-1) } }));
import { progress } from '../../../spacetimedb/src/lib/adventure';
import { frontierRepository } from '../../../spacetimedb/src/lib/frontier';

describe('shrine bonuses on shared island progression', () => {
  it.each([0, 1, 2, 3, 4])('applies the permanent bonus to discipline XP from adventure path %s only', path => {
    const hex = '1'.padStart(64, '0'), identity = { toHexString: () => hex };
    const ctx: any = { db: adventureTables(), sender: identity };
    const repo = frontierRepository(ctx), profile = newProfile(hex);
    profile.events['shrine:reedwake'] = 1;
    profile.events['shrine:cinder'] = 1;
    repo.put('profile', profile);
    for (let i = 0; i < 10; i++) progress(ctx, identity as any, path, 1);
    const discipline = [1, 2, 4, 0, 3][path];
    expect(frontierRepository(ctx).get('profile', hex)!.xp[discipline]).toBe(11);
    expect(ctx.db.adventureProfile.identity.find(identity)[PATH_FIELDS[path]]).toBe(10);
    const view = [...ctx.db.frontierView.iter()].find((row: any) => row.kind === 'profile') as any;
    expect(JSON.parse(view.data).xp[discipline]).toBe(11);
  });
});
