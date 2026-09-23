import { ScheduleAt } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import {
  FightState, MAX_HP, PlayerState, Pending, SPAWN_TILE, Stance, TICK_MS, TREE_SEEDS,
} from '../../../shared/sim';
import { clearInteractions, findPlayer, hex, sameId, savePlayer } from '../lib/players';
import { requireAdmission } from '../lib/access';

export const init = spacetimedb.init((ctx) => {
  if (!ctx.db.accessPolicy.id.find(0)) {
    ctx.db.accessPolicy.insert({ id: 0, owner: ctx.sender, gateway: undefined, requireAdmission: false });
  }
  if (!ctx.db.world.id.find(0)) {
    ctx.db.world.insert({ id: 0, tick: 0, tickStartedAt: ctx.timestamp });
  }
  for (const seed of TREE_SEEDS) {
    if (!ctx.db.tree.id.find(seed.id)) {
      ctx.db.tree.insert({ id: seed.id, x: seed.x, z: seed.z, itemId: seed.itemId, cooldownUntilTick: 0, harvester: undefined });
    }
  }
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
  if (existing && existing.connections >= 4) throw new SenderError('too many connections for this player');
  if ((!existing || !existing.online) && [...ctx.db.player.iter()].filter(p => p.online).length >= 128) {
    throw new SenderError('world is full');
  }
  if (existing) {
    savePlayer(ctx, {
      ...existing,
      online: true,
      connections: Math.min(255, existing.connections + 1),
      lastSeenAt: ctx.timestamp,
    });
    return;
  }
  if (ctx.db.player.count() >= 10000n) throw new SenderError('world character capacity reached');
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
    hp: MAX_HP,
    maxHp: MAX_HP,
    state: PlayerState.Alive,
    respawnTick: 0,
    stance: Stance.Strike,
    fightState: FightState.Neutral,
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
  });
});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  const existing = findPlayer(ctx, ctx.sender);
  if (!existing) return;
  const p = { ...existing, lastSeenAt: ctx.timestamp, connections: Math.max(0, existing.connections - 1) };
  if (p.connections === 0) {
    p.online = false;
    clearInteractions(ctx, p);
    // Nobody can keep fighting or following someone who left.
    for (const other of [...ctx.db.player.iter()]) {
      if (other.combatTarget && other.combatTarget.toHexString() === hex(p.identity)) {
        ctx.db.player.identity.update({ ...other, combatTarget: undefined, hostile: false });
      }
    }
  }
  savePlayer(ctx, p);
});
