import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { requireOwner } from '../lib/access';
import { clearInteractions, sameId } from '../lib/players';

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
    if (ctx.db.playerGrant.count() >= 10000n) throw new SenderError('world permit capacity reached');
    let active = 0;
    for (const grant of ctx.db.playerGrant.iter()) if (grant.agent && grant.expiresAtMicros > now) active++;
    if (active >= 32) throw new SenderError('agent capacity reached');
    ctx.db.playerGrant.insert({ identity, issuer: ctx.sender, agent: true,
      expiresAtMicros: now + BigInt(lifetimeSeconds) * 1_000_000n, combat, chat });
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
