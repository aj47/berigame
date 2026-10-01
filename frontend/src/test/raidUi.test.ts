import { describe, expect, it } from "vitest";
import { GiantEventKind, GiantState, RaidOutcome } from "@sim";
import { minimapModel } from "../Components/minimapModel";
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
});
