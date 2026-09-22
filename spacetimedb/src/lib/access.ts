import { SenderError } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';
import type { Ctx } from './types';

const same = (a: Identity | undefined, b: Identity) => a?.toHexString() === b.toHexString();

export function canPlay(ctx: Ctx, identity: Identity): boolean {
  const policy = ctx.db.accessPolicy.id.find(0);
  const grant = ctx.db.playerGrant.identity.find(identity);
  if (!grant) return !policy?.requireAdmission;
  return grant.expiresAtMicros > ctx.timestamp.microsSinceUnixEpoch
    && (grant.agent ? same(policy?.gateway, grant.issuer) : same(policy?.owner, grant.issuer));
}

export function requireAdmission(ctx: Ctx): void {
  if (!canPlay(ctx, ctx.sender)) throw new SenderError('player access required or expired');
}

export function requireCapability(ctx: Ctx, identity: Identity, capability: 'combat' | 'chat'): void {
  if (!canPlay(ctx, identity)) throw new SenderError('player access required or expired');
  const grant = ctx.db.playerGrant.identity.find(identity);
  if (grant && !grant[capability]) throw new SenderError(`${capability} is not enabled for this player`);
}

export function requireOwner(ctx: Ctx) {
  const policy = ctx.db.accessPolicy.id.find(0);
  if (!policy || !same(policy.owner, ctx.sender)) throw new SenderError('world owner required');
  return policy;
}
