import React, { Profiler } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Ticks arrive like SpacetimeDB table updates: an external store read with useSyncExternalStore.
const mock = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    tick: 1,
    period: 600,
    players: [] as any[],
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    advance(period: number) {
      this.tick += 1;
      this.period = period;
      for (const fn of listeners) fn();
    },
  };
});
vi.mock("../spacetime/hooks", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useTick: () => useSyncExternalStore(mock.subscribe, () => mock.tick),
    usePlayers: () => mock.players,
    useMyPlayer: () => null,
  };
});
vi.mock("../spacetime/tickClock", () => ({
  tickClock: {
    get period() {
      return mock.period;
    },
  },
}));

import TickDebug from "../Components/TickDebug";

afterEach(cleanup);

describe("TickDebug", () => {
  // Setting state from the per-tick effect re-rendered from inside every tick's
  // passive effects. On a client that mostly watches, 50 such commits in a row
  // raised React's "Maximum update depth exceeded" warning.
  it("renders once per tick: its effect never sets state", async () => {
    let commits = 0;
    const view = render(<Profiler id="tick" onRender={() => { commits++; }}><TickDebug /></Profiler>);
    commits = 0;
    const ticks = 20;
    for (let i = 0; i < ticks; i++) {
      await act(async () => {
        mock.advance(600 + i);
      });
    }
    expect(commits).toBe(ticks);
    expect((window as any).__berigame.tick).toBe(mock.tick);
    expect(view.container.textContent).toContain(`${mock.period}ms`);
  });
});
