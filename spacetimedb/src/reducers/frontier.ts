import { t, SenderError } from "spacetimedb/server";
import spacetimedb from "../schema";
import { perform, validateCommand } from "../../../shared/sim/frontier/engine";
import { eatFromSlot } from './inventory';
import {
  clearInteractions,
  currentTick,
  requireAlivePlayer,
  savePlayer,
  touchInput,
} from "../lib/players";
import { carrying, duelFor } from "../lib/adventure";
import {
  configureFrontier,
  ensureFrontierProfile,
  frontierWorld,
  projectFrontier,
} from "../lib/frontier";
import { readSlots } from "../lib/inventory";
import { activityAction } from "../lib/activity";
import { SPIRE_LOBBY_TRAVEL, inSpireLobby, leavesBramblewild, refuseOnSpireFloor } from "../lib/spireGuards";
export const frontierAction = spacetimedb.reducer(
  { command: t.string() },
  (ctx, { command }) => {
    if (command.length > 2048) throw new SenderError("Action is too large");
    const player = requireAlivePlayer(ctx, true);
    let input: unknown;
    try {
      input = JSON.parse(command);
    } catch {
      throw new SenderError("Invalid action JSON");
    }
    if (
      duelFor(ctx, ctx.sender) ||
      (carrying(ctx, ctx.sender) && (input as any)?.action !== "ability")
    )
      throw new SenderError("Finish your current adventure or duel first");
    let validated;
    try { validated = validateCommand(input); }
    catch (e) { throw new SenderError((e as Error).message); }
    if (validated.action === 'eat') {
      const slot = readSlots(ctx, ctx.sender).slots.findIndex(item => item?.itemId === validated.item);
      if (slot < 0) throw new SenderError('Carry that food first');
      eatFromSlot(ctx, slot);
      return;
    }
    // Home walks and boats must never start from a sealed tile (eating above is capped by eatFromSlot).
    refuseOnSpireFloor(player, "You cannot use region actions inside the Sunken Spire");
    touchInput(player, currentTick(ctx));
    const w = frontierWorld(ctx);
    // A Spire lobby member must stay in Bramblewild until the start checks run: refuse any
    // save that moves them out now (boat, region) or later (a queued cross-district walk).
    if (inSpireLobby(ctx, ctx.sender)) {
      const save = w.save, me = ctx.sender.toHexString();
      w.save = (a) => {
        if (a.id === me && leavesBramblewild(a)) throw new SenderError(SPIRE_LOBBY_TRAVEL);
        save.call(w, a);
      };
    }
    ensureFrontierProfile(ctx, w.repo);
    const actor = w.actors.find((a) => a.id === ctx.sender.toHexString())!;
    actor.bag = readSlots(ctx, ctx.sender).slots;
    if ((input as any)?.action === "attack")
      for (const other of w.actors) {
        const row = Array.from(ctx.db.player.iter()).find(
          (p) => p.identity.toHexString() === other.id,
        );
        if (row) other.bag = readSlots(ctx, row.identity).slots;
      }
    if (
      (input as any)?.action === "enter" &&
      ctx.db.expeditionMember.identity.find(ctx.sender)
    )
      throw new SenderError(
        "Leave your berry expedition before travelling to the Meadows",
      );
    clearInteractions(ctx, player, true);
    savePlayer(ctx, player);
    actor.inputStamp = `${player.lastInputTick}:${player.inputsThisTick}`;
    try {
      perform(w, actor, input);
    } catch (e) {
      throw new SenderError((e as Error).message);
    }
    if ((input as any)?.action === "ability") {
      const until = w.repo.get("profile", actor.id)?.events.guardUntil ?? 0;
      const member = ctx.db.expeditionMember.identity.find(ctx.sender);
      const expedition =
        member && ctx.db.expedition.id.find(member.expeditionId);
      if (
        expedition &&
        until > w.now &&
        expedition.carrier?.toHexString() === actor.id
      ) {
        ctx.db.expedition.id.update({
          ...expedition,
          guardUntil: currentTick(ctx) + Math.ceil((until - w.now) / 600),
        });
      }
    }
    projectFrontier(ctx, w.repo);
    activityAction(ctx, ctx.sender, validated.action);
  },
);
export const configureExpansion = spacetimedb.reducer(
  { enabled: t.bool(), pauseCaptures: t.bool() },
  (ctx, { enabled, pauseCaptures }) =>
    configureFrontier(ctx, enabled, pauseCaptures),
);
/** Only the admission gateway may attest that it issued an independent recovery credential. */
export const attestRecovery = spacetimedb.reducer(
  { identity: t.identity() },
  (ctx, { identity }) => {
    const policy = ctx.db.accessPolicy.id.find(0);
    if (
      policy?.gateway?.toHexString() !== ctx.sender.toHexString() &&
      policy?.owner.toHexString() !== ctx.sender.toHexString()
    )
      throw new SenderError("Gateway required");
    const w = frontierWorld(ctx);
    const p = w.repo.get("profile", identity.toHexString());
    if (!p)
      throw new SenderError("Visit the settlement before exporting recovery");
    p.recoveryReady = true;
    w.repo.put("profile", p);
    projectFrontier(ctx, w.repo);
  },
);
