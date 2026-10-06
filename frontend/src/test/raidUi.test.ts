import { describe, expect, it } from "vitest";
import { ClatterState, GiantEventKind, GiantState, PlayerState, RaidOutcome, SpireStage } from "@sim";
import { minimapModel } from "../Components/minimapModel";
import { mapDestinationAt } from "../frontier/homeMapArt";
import { raidLineText } from "../spacetime/stores/giantStore";

const raidAsleep = (wakeMs: number) => ({ awake: false, nextWakeAtMicros: BigInt(wakeMs) * 1000n, raidEndsAtMicros: 0n, announced: 0 });

describe("scheduled Giant raids on the client", () => {
  it("world-wide lines for announcements, the wake and the sleep; none for fight events", () => {
    expect(raidLineText({ kind: GiantEventKind.Announce, quantity: 10, hp: 0 })).toMatch(/wakes in 10 minutes/);
    expect(raidLineText({ kind: GiantEventKind.Announce, quantity: 1, hp: 0 })).toMatch(/wakes in 1 minute!/);
    expect(raidLineText({ kind: GiantEventKind.Wake, quantity: 3, hp: 1000 })).toMatch(/awake.*1000 HP/);
    expect(raidLineText({ kind: GiantEventKind.Sleep, quantity: RaidOutcome.Defeated, hp: 0 })).toMatch(/falls/);
    expect(raidLineText({ kind: GiantEventKind.Sleep, quantity: RaidOutcome.Slept, hp: 0 })).toMatch(/back to sleep/);
    expect(raidLineText({ kind: GiantEventKind.Hit, quantity: 0, hp: 5 })).toBeNull();
  });

  it("the minimap marks a sleeping Giant with the time to its wake, and RAID while it is up", () => {
    const base = { meHex: null, players: [], trees: [], groundItems: [], tick: 0 };
    const asleep = minimapModel({ ...base, giants: [{ x: 57, z: 57, state: GiantState.Asleep }], raid: raidAsleep(754_000), nowMs: 0 });
    expect(asleep.giant).toMatchObject({ asleep: true, down: true, label: "12:34" });
    const awake = minimapModel({
      ...base, giants: [{ x: 57, z: 57, state: GiantState.Idle }],
      raid: { awake: true, nextWakeAtMicros: 0n, raidEndsAtMicros: 60_000_000n, announced: 0 }, nowMs: 0,
    });
    expect(awake.giant).toMatchObject({ asleep: false, down: false, label: "RAID" });
  });

  it("marks Clatterhorn: Z while Dormant, ! while awake, its return countdown while Burrowed, nothing while Closed", () => {
    const base = { meHex: null, players: [], trees: [], groundItems: [], tick: 100 };
    const row = (state: number, stateUntilTick = 0) => ({ x: 84, z: 106, state, stateUntilTick });
    expect(minimapModel({ ...base, clatter: row(ClatterState.Dormant) }).clatter).toEqual({ x: 84, z: 106, state: ClatterState.Dormant, label: "Z" });
    expect(minimapModel({ ...base, clatter: row(ClatterState.ChargeWindup, 104) }).clatter).toMatchObject({ label: "!" });
    // 300 ticks of 0.6 s: 3:00.
    expect(minimapModel({ ...base, clatter: row(ClatterState.Burrowed, 400) }).clatter).toMatchObject({ label: "3:00" });
    expect(minimapModel({ ...base, clatter: row(ClatterState.Closed) }).clatter).toBeUndefined();
    expect(minimapModel(base).clatter).toBeUndefined();
  });

  it("counts the parties fighting inside the Spire on the gate marker", () => {
    const runs = [{ stage: SpireStage.Active }, { stage: SpireStage.Active }, { stage: SpireStage.Lobby }, { stage: SpireStage.Cleared }];
    expect(minimapModel({ meHex: null, players: [], trees: [], groundItems: [], tick: 0, spireRuns: runs }).spire).toEqual({ x: 62, z: 45, active: 2, queued: 0 });
  });

  it("hides players on the Spire floor and never offers the floor as a walk destination", () => {
    const p = (hex: string, x: number, z: number) => ({ identity: { toHexString: () => hex }, x, z, facing: 0, state: PlayerState.Alive, online: true, hostile: false });
    const m = minimapModel({ meHex: "me", players: [p("me", 61, 45), p("walker", 60, 45), p("diver", 72, 68)], trees: [], groundItems: [], tick: 0 });
    expect(m.others).toEqual([{ x: 60, z: 45, hostile: false }]);
    expect(m.me).toMatchObject({ x: 61, z: 45 });
    // The legacy (single-district) map: the floor's cell centre is not walkable land.
    expect(mapDestinationAt(72.5, 68.5, 128, "bramblewild", false)).toBeNull();
    expect(mapDestinationAt(61.5, 45.5, 128, "bramblewild", false)).toEqual({ region: "bramblewild", x: 61, z: 45 });
  });
});
