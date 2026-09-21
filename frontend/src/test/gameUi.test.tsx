import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerState, Stance } from "@sim";
import Inventory from "../Components/Inventory";
import StanceHud from "../Components/StanceHud";
import LoadingScreen from "../Components/LoadingScreen";
import GatherShortcut from "../Components/GatherShortcut";

const mock = vi.hoisted(() => ({
  rows: [{ slot: 0, itemId: "berry_blueberry", quantity: 3 }],
  eatBerry: vi.fn().mockResolvedValue(undefined),
  moveItem: vi.fn().mockResolvedValue(undefined),
  dropItem: vi.fn().mockResolvedValue(undefined),
  setStance: vi.fn(),
  cancel: vi.fn(),
  startHarvest: vi.fn().mockResolvedValue(true),
  tick: 100,
  player: {
    hp: 18,
    maxHp: 30,
    stance: 0,
    fightState: 0,
    state: 0,
    x: 25,
    z: 25,
    hostile: false,
    combatTarget: undefined,
    nextSwingTick: 0,
    pending: 0,
    harvestEndTick: 0,
  } as any,
  players: new Map<string, any>(),
  trees: [] as any[],
  loading: {
    isLoading: true,
    loadingProgress: 0.5,
    loadingMessage: "Loading world",
    websocketConnected: false,
    gameDataLoaded: false,
  },
}));
vi.mock("../spacetime/hooks", () => ({
  useInventoryRows: () => mock.rows,
  useMyPlayer: () => mock.player,
  usePlayersByHex: () => mock.players,
  useTick: () => mock.tick,
  useTrees: () => mock.trees,
}));
vi.mock("../spacetime/actions", () => ({ useGameActions: () => mock }));
vi.mock("../store", () => ({ useLoadingStore: () => mock.loading }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  vi.clearAllMocks();
  mock.player = {
    hp: 18,
    maxHp: 30,
    stance: 0,
    fightState: 0,
    state: 0,
    x: 25,
    z: 25,
    hostile: false,
    combatTarget: undefined,
    nextSwingTick: 0,
    pending: 0,
    harvestEndTick: 0,
  };
  mock.players = new Map();
  mock.trees = [];
  mock.tick = 100;
});

describe("cross-platform inventory actions", () => {
  it("selecting a berry does not consume it; eating requires the explicit action", async () => {
    render(<Inventory open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Slot 1: Blueberry/ }));
    expect(mock.eatBerry).not.toHaveBeenCalled();
    expect(screen.getByText("Restores 5 HP · 3 held")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Eat/ }));
    await waitFor(() => expect(mock.eatBerry).toHaveBeenCalledWith(0));
  });

  it("moves to an empty slot without HTML drag and drops only one item", async () => {
    render(<Inventory open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Slot 1: Blueberry/ }));
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Slot 2: empty, move here/ }),
    );
    await waitFor(() => expect(mock.moveItem).toHaveBeenCalledWith(0, 1));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: /Slot 1: Blueberry/ }));
    fireEvent.click(screen.getByRole("button", { name: "Drop 1" }));
    await waitFor(() => expect(mock.dropItem).toHaveBeenCalledWith(0, 1));
  });

  it("cancels moving when the bag closes", () => {
    const { rerender } = render(<Inventory open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Slot 1: Blueberry/ }));
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    rerender(<Inventory open={false} onClose={() => {}} />);
    rerender(<Inventory open onClose={() => {}} />);
    expect(
      screen.queryByText("Choose a destination slot"),
    ).not.toBeInTheDocument();
  });
});

describe("combat controls", () => {
  it("offers an on-screen Stop and does not switch stance while typing", () => {
    render(
      <>
        <StanceHud />
        <input aria-label="Message" />
      </>,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Stop moving, attacking, or harvesting",
      }),
    );
    expect(mock.cancel).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "2" });
    expect(mock.setStance).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "2" });
    expect(mock.setStance).toHaveBeenCalledWith(Stance.Grab);
    expect(screen.getByRole("meter", { name: "Health" })).toHaveAttribute(
      "aria-valuenow",
      "18",
    );
    expect(screen.getByText("beats Guard")).toBeInTheDocument();
  });
});

describe("connection recovery", () => {
  it("reopens an actionable overlay when a previously playable world disconnects", () => {
    mock.loading = {
      isLoading: false,
      loadingProgress: 1,
      loadingMessage: "",
      websocketConnected: true,
      gameDataLoaded: true,
    };
    const { rerender } = render(<LoadingScreen />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    mock.loading = {
      ...mock.loading,
      websocketConnected: false,
      gameDataLoaded: false,
    };
    rerender(<LoadingScreen />);
    expect(screen.getByText("Connection interrupted")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Rejoin island" }),
    ).toBeInTheDocument();
  });

  it("offers recovery after a slow initial connection", async () => {
    vi.useFakeTimers();
    mock.loading = {
      isLoading: true,
      loadingProgress: 0,
      loadingMessage: "Connecting",
      websocketConnected: false,
      gameDataLoaded: false,
    };
    render(<LoadingScreen />);
    await act(async () => {
      vi.advanceTimersByTime(9000);
    });
    expect(
      screen.getByRole("button", { name: "Rejoin island" }),
    ).toBeInTheDocument();
  });
});

describe("guided gathering", () => {
  it("only sends a harvest when clicked and selects the nearest available tree", async () => {
    mock.trees = [
      {
        id: 1,
        x: 26,
        z: 25,
        itemId: "berry_greenberry",
        cooldownUntilTick: 110,
      },
      {
        id: 2,
        x: 25,
        z: 26,
        itemId: "berry_goldberry",
        cooldownUntilTick: 0,
        harvester: {},
      },
      { id: 3, x: 28, z: 25, itemId: "berry_strawberry", cooldownUntilTick: 0 },
      { id: 4, x: 32, z: 25, itemId: "berry_blueberry", cooldownUntilTick: 0 },
    ];
    render(<GatherShortcut visible solo />);
    expect(mock.startHarvest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Gather Strawberry/ }));
    await waitFor(() => expect(mock.startHarvest).toHaveBeenCalledWith(3));
  });
  it("does not interrupt combat and disables harvesting while all trees regrow", () => {
    mock.player.hostile = true;
    const { rerender } = render(<GatherShortcut visible solo />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    mock.player.hostile = false;
    rerender(<GatherShortcut visible solo />);
    expect(
      screen.getByRole("button", { name: /No trees ready/ }),
    ).toBeDisabled();
  });
});

describe("authoritative swing timing", () => {
  it("shows recovery from the server tick, but never promises a swing outside melee range", () => {
    mock.player = {
      ...mock.player,
      hostile: true,
      combatTarget: { toHexString: () => "opponent" },
      nextSwingTick: 103,
    };
    mock.players.set("opponent", {
      name: "Rival",
      online: true,
      state: PlayerState.Alive,
      x: 26,
      z: 25,
    });
    const { rerender } = render(<StanceHud />);
    expect(screen.getByText("Rival")).toBeInTheDocument();
    expect(screen.getByText("Recovery · 3 ticks")).toBeInTheDocument();
    mock.tick = 104;
    rerender(<StanceHud />);
    expect(screen.getByText("Swing ready")).toBeInTheDocument();
    mock.players.set("opponent", {
      name: "Rival",
      online: true,
      state: PlayerState.Alive,
      x: 32,
      z: 25,
    });
    rerender(<StanceHud />);
    expect(screen.getByText("Moving into range")).toBeInTheDocument();
    expect(screen.queryByText("Swing ready")).not.toBeInTheDocument();
  });
});
