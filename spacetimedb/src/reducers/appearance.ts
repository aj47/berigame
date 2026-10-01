import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { CosmeticSlot, canWear, validAppearance, normalizeAppearance, NAME_MIN_LEN, NAME_MAX_LEN } from '../../../shared/sim';
import { currentTick, requirePlayer, savePlayer, touchInput } from '../lib/players';

/** The sender can change only their own cosmetics; gameplay fields stay intact. */
export const setAppearance = spacetimedb.reducer(
  { hairStyle: t.u8(), skinTone: t.u8(), hairColor: t.u8(), robeColor: t.u8(), wrapColor: t.u8() },
  (ctx, choices) => {
    if (!validAppearance(choices)) throw new SenderError('Choose one of the available styles');
    const player = requirePlayer(ctx);
    touchInput(player, currentTick(ctx));
    const existing = ctx.db.appearance.identity.find(ctx.sender);
    const row = { identity: ctx.sender, ...normalizeAppearance(existing), setupComplete: existing?.setupComplete ?? false, ...choices };
    if (ctx.db.appearance.identity.find(ctx.sender)) ctx.db.appearance.identity.update(row);
    else ctx.db.appearance.insert(row);
    savePlayer(ctx, player);
  }
);

/** Name and appearance commit together, so failed names never leave a partial setup. */
export const saveCharacter = spacetimedb.reducer(
  {
    name: t.string(), hairStyle: t.u8(), skinTone: t.u8(), hairColor: t.u8(), robeColor: t.u8(), wrapColor: t.u8(),
    bodyType: t.u8(), faceShape: t.u8(), eyeColor: t.u8(), facialHair: t.u8(), outfitStyle: t.u8(),
    trouserColor: t.u8(), bootColor: t.u8(), accessory: t.u8(), accessoryColor: t.u8(),
  },
  (ctx, { name, ...choices }) => {
    const trimmed = name.trim();
    if (trimmed.length < NAME_MIN_LEN || trimmed.length > NAME_MAX_LEN) throw new SenderError(`Choose a name with ${NAME_MIN_LEN}–${NAME_MAX_LEN} characters`);
    if (!/^[A-Za-z0-9_ ]+$/.test(trimmed)) throw new SenderError('Use letters, numbers, spaces or underscores');
    if (!validAppearance(choices)) throw new SenderError('Choose one of the available styles');
    const player = requirePlayer(ctx);
    for (const other of ctx.db.player.iter()) {
      if (other.name.toLowerCase() === trimmed.toLowerCase() && other.identity.toHexString() !== ctx.sender.toHexString()) throw new SenderError('That name is already taken');
    }
    touchInput(player, currentTick(ctx));
    const row = { identity: ctx.sender, ...choices, setupComplete: true };
    if (ctx.db.appearance.identity.find(ctx.sender)) ctx.db.appearance.identity.update(row);
    else ctx.db.appearance.insert(row);
    player.name = trimmed;
    savePlayer(ctx, player);
  }
);

/**
 * Wear (or take off, cosmetic 0) an earned milestone cosmetic. `slot` is
 * shared/sim CosmeticSlot (0 head, 1 neck); `cosmetic` is its id + 1. Purely
 * visual: nothing reads it but the renderer.
 */
export const wearCosmetic = spacetimedb.reducer(
  { slot: t.u8(), cosmetic: t.u8() },
  (ctx, { slot, cosmetic }) => {
    const player = requirePlayer(ctx);
    touchInput(player, currentTick(ctx));
    const existing = ctx.db.playerCosmetic.identity.find(ctx.sender);
    const row = existing ?? { identity: ctx.sender, unlocked: 0, head: 0, neck: 0 };
    if (!canWear(row.unlocked, slot, cosmetic)) throw new SenderError('You have not earned that yet');
    const next = slot === CosmeticSlot.Head ? { ...row, head: cosmetic } : { ...row, neck: cosmetic };
    if (existing) ctx.db.playerCosmetic.identity.update(next);
    else ctx.db.playerCosmetic.insert(next);
    savePlayer(ctx, player);
  }
);
