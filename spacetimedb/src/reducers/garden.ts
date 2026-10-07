import { carrying, duelFor, syncShowcase } from '../lib/adventure';
import { t, SenderError } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';
import spacetimedb from '../schema';
import {
  Skill, addItem, gardenHarvestRejection, gardenPlantRejection, getGardenCrop, removeFromSlot,
} from '../../../shared/sim';
import { readSlots, writeSlots } from '../lib/inventory';
import { requireOwner } from '../lib/access';
import { currentTick, requireAlivePlayer, sameId, savePlayer, touchInput } from '../lib/players';
import { activityAction } from '../lib/activity';
import { grantXp, skillLevel } from '../lib/progress';
import { refuseOnSpireFloor } from '../lib/spireGuards';
import type { Ctx, GardenPlotRow } from '../lib/types';

/**
 * The personal garden (shared/sim/garden.ts). Both verbs are instant and need
 * you standing within reach of the plot; growth is computed from the stored
 * planting time, so nothing is written while plants grow (online or not).
 */

const nowMs = (ctx: Ctx) => Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);

function plotRow(ctx: Ctx, owner: Identity, plot: number): GardenPlotRow | undefined {
  for (const row of ctx.db.gardenPlot.owner.filter(owner)) if (row.plot === plot) return row;
  return undefined;
}

export const plantGarden = spacetimedb.reducer(
  { plot: t.u8(), itemId: t.string() },
  (ctx, { plot, itemId }) => {
    const p = requireAlivePlayer(ctx);
    refuseOnSpireFloor(p);
    if (carrying(ctx, p.identity)) throw new SenderError("Put down the giant berry first; it needs both hands");
    touchInput(p, currentTick(ctx));
    activityAction(ctx, p.identity, 'garden-plant');
    const snap = readSlots(ctx, p.identity);
    const occupied = plotRow(ctx, p.identity, plot) !== undefined;
    const why = gardenPlantRejection(snap.slots, p, plot, itemId, skillLevel(ctx, p.identity, Skill.Foraging), occupied);
    if (why) throw new SenderError(why);
    // Take one berry from the last stack of it (keeps the quick bar intact where possible).
    let slot = -1;
    for (let i = snap.slots.length - 1; i >= 0; i--) if (snap.slots[i]?.itemId === itemId) { slot = i; break; }
    writeSlots(ctx, p.identity, snap, removeFromSlot(snap.slots, slot, 1).slots);
    ctx.db.gardenPlot.insert({ id: 0n, owner: p.identity, plot, itemId, plantedAtMicros: ctx.timestamp.microsSinceUnixEpoch });
    syncShowcase(ctx, p.identity);
    savePlayer(ctx, p);
  }
);

/** A ripe plot gives its berries and Foraging XP. A full bag refuses and keeps the plant. */
export const harvestGarden = spacetimedb.reducer(
  { plot: t.u8() },
  (ctx, { plot }) => {
    const p = requireAlivePlayer(ctx);
    refuseOnSpireFloor(p);
    if (carrying(ctx, p.identity)) throw new SenderError("Put down the giant berry first; it needs both hands");
    touchInput(p, currentTick(ctx));
    activityAction(ctx, p.identity, 'garden-harvest');
    const row = plotRow(ctx, p.identity, plot);
    const snap = readSlots(ctx, p.identity);
    const plant = row ? { itemId: row.itemId, plantedAtMs: Number(row.plantedAtMicros / 1000n) } : null;
    const why = gardenHarvestRejection(snap.slots, p, plot, plant, nowMs(ctx));
    if (why) throw new SenderError(why);
    const crop = getGardenCrop(row!.itemId)!;
    writeSlots(ctx, p.identity, snap, addItem(snap.slots, crop.itemId, crop.yield).slots);
    ctx.db.gardenPlot.id.delete(row!.id);
    grantXp(ctx, p.identity, Skill.Foraging, crop.xp);
    syncShowcase(ctx, p.identity);
    savePlayer(ctx, p);
  }
);

/**
 * Owner-only test hook for live checks: makes a player's current plants ripe
 * now (or `aheadMs` short of ripe, to see a growth stage). Never used in play;
 * the shipped grow times are unchanged.
 */
export const gardenDevRipen = spacetimedb.reducer(
  { target: t.identity(), aheadMs: t.u32() },
  (ctx, { target, aheadMs }) => {
    requireOwner(ctx);
    const now = ctx.timestamp.microsSinceUnixEpoch;
    for (const row of [...ctx.db.gardenPlot.owner.filter(target)]) {
      if (!sameId(row.owner, target)) continue;
      const crop = getGardenCrop(row.itemId);
      if (!crop) continue;
      const planted = now - BigInt(crop.growMs) * 1000n + BigInt(aheadMs) * 1000n;
      ctx.db.gardenPlot.id.update({ ...row, plantedAtMicros: planted < 0n ? 0n : planted });
    }
  }
);
