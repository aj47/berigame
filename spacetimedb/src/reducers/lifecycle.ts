import { ScheduleAt } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { settleEnergyFor } from '../lib/energy';
import {
  FIRST_SPAWN_GRACE_TICKS, FIRST_SPAWN_HP, MAX_HP, PlayerState, RESPAWN_GRACE_TICKS, Pending, SPAWN_TILE, TICK_MS, TREE_SEEDS, NodeKind,
} from '../../../shared/sim';
import { clearInteractions, findPlayer, hex, sameId, savePlayer } from '../lib/players';
import { requireAdmission } from '../lib/access';
import { seedMissingNodes } from '../lib/nodes';
import { statsSessionEnd, statsSessionStart } from '../lib/stats';
import { activity } from '../lib/activity';
import { noteConnected } from '../lib/idle';
import { cancelTrade, tradesOf } from '../lib/social';
import { hasWorldSpace, MAX_CHARACTER_CONNECTIONS, MAX_STORED_CHARACTERS } from '../../../shared/sim/admission';

export const init = spacetimedb.init((ctx) => {
  if (!ctx.db.accessPolicy.id.find(0)) {
    ctx.db.accessPolicy.insert({ id: 0, owner: ctx.sender, gateway: undefined, requireAdmission: false });
  }
  if (!ctx.db.world.id.find(0)) {
    ctx.db.world.insert({ id: 0, tick: 0, tickStartedAt: ctx.timestamp });
  }
  for (const seed of TREE_SEEDS) {
    if (!ctx.db.tree.id.find(seed.id)) {
      ctx.db.tree.insert({ id: seed.id, x: seed.x, z: seed.z, itemId: seed.itemId, cooldownUntilTick: 0, harvester: undefined, kind: NodeKind.Berry });
    }
  }
  seedMissingNodes(ctx);
  if (ctx.db.tickSchedule.count() === 0n) {
    ctx.db.tickSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(BigInt(TICK_MS) * 1000n) });
  }
});

export const onConnect = spacetimedb.clientConnected((ctx) => {
  const policy = ctx.db.accessPolicy.id.find(0);
  // Control connections do not create characters or consume player slots.
  if (sameId(policy?.owner, ctx.sender) || sameId(policy?.gateway, ctx.sender)) return;
  requireAdmission(ctx);
  const existing = findPlayer(ctx, ctx.sender);
  if (existing && existing.connections >= MAX_CHARACTER_CONNECTIONS) throw new SenderError('too many connections for this player');
  if (!hasWorldSpace(ctx.db.player.iter(), !!existing?.online)) {
    throw new SenderError('world is full');
  }
  // Only a real live connection counts as "already online": after a module
  // restart, stale session state is closed out and a new session starts.
  const alreadyOnline = Boolean(existing && existing.online && existing.connections > 0);
  statsSessionStart(ctx, ctx.sender, alreadyOnline);
  activity(ctx, ctx.sender, 'sessions', alreadyOnline ? 0 : 1);
  noteConnected(ctx, ctx.sender, ctx.db.world.id.find(0)?.tick ?? 0);
  // The time away fills the energy meter above the rested line (shared/sim/energy.ts).
  if (existing && !alreadyOnline) settleEnergyFor(ctx, ctx.sender, false);
  if (existing) {
    savePlayer(ctx, {
      ...existing,
      online: true,
      connections: Math.min(255, existing.connections + 1),
      lastSeenAt: ctx.timestamp,
    });
    return;
  }
  if (ctx.db.player.count() >= BigInt(MAX_STORED_CHARACTERS)) throw new SenderError('world character capacity reached');
  ctx.db.player.insert({
    identity: ctx.sender,
    name: 'Player-' + hex(ctx.sender).slice(4, 8),
    online: true,
    connections: 1,
    lastSeenAt: ctx.timestamp,
    x: SPAWN_TILE.x,
    z: SPAWN_TILE.z,
    facing: 0,
    targetX: undefined,
    targetZ: undefined,
    // New characters wash ashore tired, protected until a stick, an attack or 3:00.
    hp: FIRST_SPAWN_HP,
    maxHp: MAX_HP,
    state: PlayerState.Alive,
    respawnTick: (ctx.db.world.id.find(0)?.tick ?? 0) + FIRST_SPAWN_GRACE_TICKS - RESPAWN_GRACE_TICKS,
    stance: 0,
    fightState: 0,
    combatTarget: undefined,
    hostile: false,
    nextSwingTick: 0,
    lastExchangeTick: 0,
    outOfRangeTicks: 0,
    pending: Pending.None,
    pendingId: 0n,
    harvestTreeId: 0,
    harvestEndTick: 0,
    eatCooldownUntilTick: 0,
    lastInputTick: 0,
    inputsThisTick: 0,
    weapon: '', region: 'bramblewild', load: 0,
  });
});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  const existing = findPlayer(ctx, ctx.sender);
  if (!existing) return;
  const p = { ...existing, lastSeenAt: ctx.timestamp, connections: Math.max(0, existing.connections - 1) };
  if (p.connections === 0) {
    p.online = false;
    clearInteractions(ctx, p);
    statsSessionEnd(ctx, p.identity);
    settleEnergyFor(ctx, p.identity, true);
    // Nobody can keep fighting or following someone who left.
    for (const other of [...ctx.db.player.iter()]) {
      if (other.combatTarget && other.combatTarget.toHexString() === hex(p.identity)) {
        ctx.db.player.identity.update({ ...other, combatTarget: undefined, hostile: false });
      }
    }
    for (const row of tradesOf(ctx, p.identity)) cancelTrade(ctx, row, `Trade cancelled: ${p.name} left`);
  }
  savePlayer(ctx, p);
});
