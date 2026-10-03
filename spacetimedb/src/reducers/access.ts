import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { requireOwner } from '../lib/access';
import { clearInteractions, sameId } from '../lib/players';
import { hasWorldSpace, MAX_STORED_CHARACTERS } from '../../../shared/sim/admission';

/** Only the publisher captured during init can configure admission. */
export const configureAccess = spacetimedb.reducer(
  { gateway: t.identity(), requireAdmission: t.bool() },
  (ctx, { gateway, requireAdmission }) => {
    const policy = requireOwner(ctx);
    if (sameId(gateway, policy.owner)) throw new SenderError('use a separate gateway identity');
    ctx.db.accessPolicy.id.update({ ...policy, gateway, requireAdmission });
  },
);

/** The gateway may provision bounded, expiring agent permits, never owner access. */
export const grantAgent = spacetimedb.reducer(
  { identity: t.identity(), lifetimeSeconds: t.u32(), combat: t.bool(), chat: t.bool() },
  (ctx, { identity, lifetimeSeconds, combat, chat }) => {
    const policy = ctx.db.accessPolicy.id.find(0);
    if (!policy?.requireAdmission || !sameId(policy.gateway, ctx.sender)) throw new SenderError('agent gateway required');
    if (lifetimeSeconds < 60 || lifetimeSeconds > 3600) throw new SenderError('agent lifetime must be 60..3600 seconds');
    if (sameId(identity, policy.owner) || sameId(identity, policy.gateway)
      || ctx.db.playerGrant.identity.find(identity) || ctx.db.player.identity.find(identity)) {
      throw new SenderError('a fresh agent identity is required');
    }
    const now = ctx.timestamp.microsSinceUnixEpoch;
    if (ctx.db.playerGrant.count() >= BigInt(MAX_STORED_CHARACTERS)) throw new SenderError('world character capacity reached');
    if (!hasWorldSpace(ctx.db.player.iter())) throw new SenderError('world is full');
    ctx.db.playerGrant.insert({ identity, issuer: ctx.sender, agent: true,
      expiresAtMicros: now + BigInt(lifetimeSeconds) * 1_000_000n, combat, chat });
  },
);

/**
 * The gateway extends a permit it issued earlier, so a returning browser keeps
 * its character (F1). Only an existing, gateway-issued, unrevoked permit can be
 * renewed: revocation writes expiresAtMicros = 0, which is final here.
 */
export const renewGrant = spacetimedb.reducer(
  { identity: t.identity(), lifetimeSeconds: t.u32() },
  (ctx, { identity, lifetimeSeconds }) => {
    const policy = ctx.db.accessPolicy.id.find(0);
    if (!policy?.requireAdmission || !sameId(policy.gateway, ctx.sender)) throw new SenderError('agent gateway required');
    if (lifetimeSeconds < 60 || lifetimeSeconds > 3600) throw new SenderError('agent lifetime must be 60..3600 seconds');
    const grant = ctx.db.playerGrant.identity.find(identity);
    if (!grant || !grant.agent || !sameId(grant.issuer, ctx.sender)) throw new SenderError('no renewable permit for this identity');
    if (grant.expiresAtMicros === 0n) throw new SenderError('this permit was revoked');
    const now = ctx.timestamp.microsSinceUnixEpoch;
    // A player already online can always extend their permit at a full world.
    const player = ctx.db.player.identity.find(identity);
    if (!hasWorldSpace(ctx.db.player.iter(), !!player?.online)) throw new SenderError('world is full');
    ctx.db.playerGrant.identity.update({ ...grant, expiresAtMicros: now + BigInt(lifetimeSeconds) * 1_000_000n });
  },
);

/** Human players in an admitted world are explicitly approved by its owner. */
export const grantPlayer = spacetimedb.reducer(
  { identity: t.identity(), lifetimeSeconds: t.u32(), combat: t.bool(), chat: t.bool() },
  (ctx, { identity, lifetimeSeconds, combat, chat }) => {
    requireOwner(ctx);
    if (lifetimeSeconds < 60 || lifetimeSeconds > 86400) throw new SenderError('player lifetime must be 60..86400 seconds');
    const row = { identity, issuer: ctx.sender, agent: false,
      expiresAtMicros: ctx.timestamp.microsSinceUnixEpoch + BigInt(lifetimeSeconds) * 1_000_000n, combat, chat };
    if (ctx.db.playerGrant.identity.find(identity)) ctx.db.playerGrant.identity.update(row);
    else ctx.db.playerGrant.insert(row);
  },
);

export const revokePlayer = spacetimedb.reducer({ identity: t.identity() }, (ctx, { identity }) => {
  const policy = ctx.db.accessPolicy.id.find(0);
  const grant = ctx.db.playerGrant.identity.find(identity);
  const owner = sameId(policy?.owner, ctx.sender);
  if (!owner && !(grant?.agent && sameId(policy?.gateway, ctx.sender) && sameId(grant.issuer, ctx.sender))) {
    throw new SenderError('world owner or issuing gateway required');
  }
  if (!grant) return;
  ctx.db.playerGrant.identity.update({ ...grant, expiresAtMicros: 0n });
  const player = ctx.db.player.identity.find(identity);
  if (player) {
    const p = { ...player, online: false };
    clearInteractions(ctx, p);
    ctx.db.player.identity.update(p);
  }
  for (const other of ctx.db.player.iter()) {
    if (sameId(other.combatTarget, identity)) {
      const p = { ...other };
      clearInteractions(ctx, p);
      ctx.db.player.identity.update(p);
    }
  }
});

/** End one visit while keeping its identity renewable. Admin revocation (zero) remains final. */
export const endVisit = spacetimedb.reducer({ identity: t.identity() }, (ctx, { identity }) => {
  const policy = ctx.db.accessPolicy.id.find(0), grant = ctx.db.playerGrant.identity.find(identity);
  if (!grant?.agent || !sameId(policy?.gateway, ctx.sender) || !sameId(grant.issuer, ctx.sender)) throw new SenderError('issuing gateway required');
  if (grant.expiresAtMicros !== 0n) ctx.db.playerGrant.identity.update({ ...grant, expiresAtMicros: ctx.timestamp.microsSinceUnixEpoch });
  const row = ctx.db.player.identity.find(identity);
  if (row) { const p = { ...row, online: false }; clearInteractions(ctx, p); ctx.db.player.identity.update(p); }
});
