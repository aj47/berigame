import { t, SenderError } from "spacetimedb/server";
import spacetimedb from "../schema";
import { perform } from "../../../shared/sim/frontier/engine";
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
export const frontierAction = spacetimedb.reducer(
  { command: t.string() },
  (ctx, { command }) => {
    if (command.length > 2048) throw new SenderError("Action is too large");
    const player = requireAlivePlayer(ctx, true);
    touchInput(player, currentTick(ctx));
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
    const w = frontierWorld(ctx);
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
    clearInteractions(ctx, player);
    savePlayer(ctx, player);
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
