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
import { PlayerState, PUNCH_DAMAGE, getItemDef } from "@sim";
import Inventory from "../Components/Inventory";
import CombatHud from "../Components/CombatHud";
import { isWieldedSlot, slotsFromRows } from "../Components/itemUi";
import { useToastStore } from "../spacetime/stores/toastStore";
import LoadingScreen from "../Components/LoadingScreen";
import GoalChip from "../Components/GoalChip";
import { useFirstDayStore } from "../spacetime/stores/firstDayStore";
import { BRAMBLE_MESSAGE } from "@sim";

const mock = vi.hoisted(() => ({
  rows: [{ slot: 0, itemId: "berry_blueberry", quantity: 3 }] as any[],
  eatBerry: vi.fn().mockResolvedValue(undefined),
  moveItem: vi.fn().mockResolvedValue(undefined),
  dropItem: vi.fn().mockResolvedValue(undefined),
  wieldItem: vi.fn().mockResolvedValue(true),
  setTarget: vi.fn().mockResolvedValue(true),
  unwield: vi.fn().mockResolvedValue(true),
  cancel: vi.fn(),
  startHarvest: vi.fn().mockResolvedValue(true),
  tick: 100,
  player: {
    hp: 18,
    maxHp: 30,
    weapon: "",
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
  useGiants: () => [],
  useMyIdentityHex: () => "me",
  usePlayers: () => [...mock.players.values()],
  useMySkills: () => null,
  useMyCosmetics: () => null,
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
    weapon: "",
    state: 0,
    x: 25,
    z: 25,
    hostile: false,
    combatTarget: undefined,
    nextSwingTick: 0,
    pending: 0,
    harvestEndTick: 0,
  };
  mock.rows = [{ slot: 0, itemId: "berry_blueberry", quantity: 3 }];
  useToastStore.setState({ message: null });
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

  it("offers Wield for a stick in a quick slot and Unwield once it is wielded", async () => {
    mock.rows = [
      { slot: 0, itemId: "berry_blueberry", quantity: 3 },
      { slot: 1, itemId: "stick", quantity: 1 },
    ];
    const { rerender } = render(<Inventory open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Slot 2: Stick/ }));
    expect(screen.getByText(/Weapon · 6 damage/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Eat/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Wield" }));
    await waitFor(() => expect(mock.wieldItem).toHaveBeenCalledWith(1));
    await act(async () => {});
    mock.player = { ...mock.player, weapon: "stick" };
    rerender(<Inventory open onClose={() => {}} />);
    expect(
      screen.getByRole("button", { name: /Slot 2: Stick, 1, wielded/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unwield" }));
    await waitFor(() => expect(mock.unwield).toHaveBeenCalledOnce());
    expect(mock.eatBerry).not.toHaveBeenCalled();
  });

  it("agrees with the quick bar when two sticks are in quick slots", async () => {
    mock.rows = [
      { slot: 1, itemId: "stick", quantity: 1 },
      { slot: 2, itemId: "stick", quantity: 1 },
    ];
    mock.player = { ...mock.player, weapon: "stick" };
    render(<Inventory open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Slot 3: Stick, 1, wielded/ }));
    fireEvent.click(screen.getByRole("button", { name: "Unwield" }));
    await waitFor(() => expect(mock.unwield).toHaveBeenCalledOnce());
    expect(mock.wieldItem).not.toHaveBeenCalled();
  });

  it("only wields from the quick bar and explains slots 1-3", () => {
    mock.rows = [{ slot: 5, itemId: "stick", quantity: 1 }];
    render(<Inventory open onClose={() => {}} />);
    expect(
      screen.getByText(/Slots 1–3 are your quick bar — move a stick there to wield it/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Slot 6: Stick/ }));
    expect(screen.getByRole("button", { name: "Wield" })).toBeDisabled();
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

describe("combat quick slots", () => {
  const stickAndBerries = () => {
    mock.rows = [
      { slot: 0, itemId: "berry_blueberry", quantity: 3 },
      { slot: 1, itemId: "stick", quantity: 1 },
    ];
  };

  it("offers an on-screen Stop, shows health and the punch chip", () => {
    render(<CombatHud />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Stop moving, attacking, or harvesting",
      }),
    );
    expect(mock.cancel).toHaveBeenCalledOnce();
    expect(screen.getByRole("meter", { name: "Health" })).toHaveAttribute(
      "aria-valuenow",
      "18",
    );
    expect(screen.getByText(`Punch · ${PUNCH_DAMAGE} dmg`)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mock.cancel).toHaveBeenCalledTimes(2);
  });

  it("renders inventory slots 0-2 as quick slots with name, quantity and action", () => {
    stickAndBerries();
    render(<CombatHud />);
    const berry = screen.getByRole("button", { name: "Quick slot 1: Blueberry" });
    expect(berry).toHaveTextContent("Blueberry");
    expect(berry).toHaveTextContent("Eat +5");
    expect(berry).toHaveTextContent("3");
    // Eating is a one-shot action, not a toggle; the hint describes what it does.
    expect(berry).not.toHaveAttribute("aria-pressed");
    expect(berry).toHaveAccessibleDescription("Eat +5");
    const stick = screen.getByRole("button", { name: "Quick slot 2: Stick" });
    expect(stick).toHaveTextContent("Wield");
    expect(stick).toHaveAttribute("aria-pressed", "false");
    const empty = screen.getByRole("button", { name: "Quick slot 3: empty" });
    expect(empty).toBeDisabled();
    expect(empty).not.toHaveAttribute("aria-pressed");
  });

  it("key 1 eats the berry in slot 0, but not at full health", async () => {
    const { rerender } = render(<CombatHud />);
    fireEvent.keyDown(window, { key: "1" });
    await waitFor(() => expect(mock.eatBerry).toHaveBeenCalledWith(0));
    await act(async () => {});
    mock.eatBerry.mockClear();
    mock.player = { ...mock.player, hp: 30 };
    rerender(<CombatHud />);
    fireEvent.keyDown(window, { key: "1" });
    expect(mock.eatBerry).not.toHaveBeenCalled();
    expect(useToastStore.getState().message).toBe(
      "You're already at full health",
    );
  });

  it("key 2 wields the stick in slot 1, and pressing it again unwields", async () => {
    stickAndBerries();
    const { rerender } = render(<CombatHud />);
    const event = new KeyboardEvent("keydown", { key: "2", cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(mock.wieldItem).toHaveBeenCalledWith(1));
    await act(async () => {});
    mock.player = { ...mock.player, weapon: "stick" };
    rerender(<CombatHud />);
    const stick = screen.getByRole("button", {
      name: "Quick slot 2: Stick, wielded",
    });
    expect(stick).toHaveAttribute("aria-pressed", "true");
    expect(stick).toHaveClass("active");
    expect(stick).toHaveTextContent("Wielded");
    expect(
      screen.getByText(`Stick · ${getItemDef("stick")!.weaponDamage} dmg`),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "2" });
    await waitFor(() => expect(mock.unwield).toHaveBeenCalledOnce());
    expect(mock.wieldItem).toHaveBeenCalledOnce();
    expect(mock.eatBerry).not.toHaveBeenCalled();
  });

  it("clicking a quick slot does the same as its key", async () => {
    stickAndBerries();
    render(<CombatHud />);
    fireEvent.click(screen.getByRole("button", { name: "Quick slot 2: Stick" }));
    await waitFor(() => expect(mock.wieldItem).toHaveBeenCalledWith(1));
  });

  it("ignores digits while typing, repeated or with modifiers, and on empty slots", () => {
    stickAndBerries();
    render(
      <>
        <CombatHud />
        <input aria-label="Message" />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "1" });
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "2" });
    fireEvent.keyDown(window, { key: "1", repeat: true });
    fireEvent.keyDown(window, { key: "2", ctrlKey: true });
    fireEvent.keyDown(window, { key: "3" });
    expect(mock.eatBerry).not.toHaveBeenCalled();
    expect(mock.wieldItem).not.toHaveBeenCalled();
    expect(mock.unwield).not.toHaveBeenCalled();
  });

  it("ignores quick keys while a text-entry panel such as Appearance is open", () => {
    stickAndBerries();
    render(<CombatHud quickKeysEnabled={false} />);
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "2" });
    expect(mock.eatBerry).not.toHaveBeenCalled();
    expect(mock.wieldItem).not.toHaveBeenCalled();
  });

  it("disables quick slots while dead", () => {
    stickAndBerries();
    mock.player = { ...mock.player, state: PlayerState.Dead, hp: 0 };
    render(<CombatHud />);
    expect(screen.getByText("Respawning…")).toBeInTheDocument();
    for (const button of document.querySelectorAll(".hotbar-slot"))
      expect(button).toBeDisabled();
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "2" });
    expect(mock.eatBerry).not.toHaveBeenCalled();
    expect(mock.wieldItem).not.toHaveBeenCalled();
  });

  it("treats every quick slot holding the wielded item as wielded", () => {
    const slots = slotsFromRows(
      [
        { slot: 2, itemId: "stick", quantity: 1 },
        { slot: 1, itemId: "stick", quantity: 1 },
        { slot: 40, itemId: "stick", quantity: 1 },
      ],
      3,
    );
    expect(slots.map((slot) => slot?.itemId ?? null)).toEqual([
      null,
      "stick",
      "stick",
    ]);
    expect([0, 1, 2].map((i) => isWieldedSlot(slots, i, "stick", 3))).toEqual([false, true, true]);
    expect(isWieldedSlot(slots, 1, "", 3)).toBe(false);
    const bag = slotsFromRows([{ slot: 5, itemId: "stick", quantity: 1 }]);
    expect(isWieldedSlot(bag, 5, "stick", 3)).toBe(false);
  });

  it("with two sticks in the quick bar, either one reads Wielded and puts the weapon away", async () => {
    mock.rows = [
      { slot: 0, itemId: "berry_blueberry", quantity: 3 },
      { slot: 1, itemId: "stick", quantity: 1 },
      { slot: 2, itemId: "stick", quantity: 1 },
    ];
    mock.player = { ...mock.player, weapon: "stick" };
    render(<CombatHud />);
    for (const n of [2, 3]) {
      const stick = screen.getByRole("button", { name: `Quick slot ${n}: Stick, wielded` });
      expect(stick).toHaveAttribute("aria-pressed", "true");
      expect(stick).toHaveTextContent("Wielded");
    }
    fireEvent.keyDown(window, { key: "3" });
    await waitFor(() => expect(mock.unwield).toHaveBeenCalledOnce());
    expect(mock.wieldItem).not.toHaveBeenCalled();
  });

  it("keeps a used quick slot focusable while its request is in flight", async () => {
    stickAndBerries();
    let finish!: () => void;
    mock.wieldItem.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<CombatHud />);
    const stick = screen.getByRole("button", { name: "Quick slot 2: Stick" });
    stick.focus();
    fireEvent.click(stick);
    await waitFor(() => expect(stick).toHaveAttribute("aria-busy", "true"));
    expect(stick).not.toBeDisabled();
    expect(document.activeElement).toBe(stick);
    // A second press while busy is ignored rather than queued.
    fireEvent.click(stick);
    expect(mock.wieldItem).toHaveBeenCalledOnce();
    await act(async () => finish());
    expect(stick).not.toHaveAttribute("aria-busy");
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

describe("First Day goal chip", () => {
  beforeEach(() => {
    try { window.localStorage.clear(); } catch { /* ignore */ }
    useFirstDayStore.setState({ owner: null, done: [], seen: {}, tipped: [], activeTip: null, celebrating: false, stickFoundAt: null });
    mock.player = { ...mock.player, respawnTick: 380, lastInputTick: 0, harvestTreeId: 0, pendingId: 0n };
    mock.rows = [];
  });

  it("starts at 'Pick a berry' and only harvests when tapped, choosing the soonest claim", async () => {
    mock.trees = [
      { id: 1, x: 26, z: 25, itemId: "berry_greenberry", cooldownUntilTick: 110 },
      { id: 2, x: 25, z: 26, itemId: "berry_goldberry", cooldownUntilTick: 0, harvester: {} },
      { id: 3, x: 28, z: 25, itemId: "berry_strawberry", cooldownUntilTick: 0 },
      { id: 4, x: 32, z: 25, itemId: "berry_blueberry", cooldownUntilTick: 0 },
    ];
    render(<GoalChip visible />);
    expect(mock.startHarvest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Pick a berry/ }));
    await waitFor(() => expect(mock.startHarvest).toHaveBeenCalledWith(3));
  });

  it("then asks you to eat it from the quick bar", async () => {
    mock.rows = [{ slot: 0, itemId: "berry_blueberry", quantity: 1 }];
    render(<GoalChip visible />);
    fireEvent.click(screen.getByRole("button", { name: /Eat it: tap the Blueberry in your quick bar/ }));
    await waitFor(() => expect(mock.eatBerry).toHaveBeenCalledWith(0));
  });

  it("shows 'Waiting: ripe in N s' beside a regrowing tree and does nothing on tap", () => {
    mock.trees = [{ id: 1, x: 26, z: 25, itemId: "berry_greenberry", cooldownUntilTick: 110 }];
    mock.player = { ...mock.player, x: 27, z: 25, pending: 1, pendingId: 1n };
    render(<GoalChip visible />);
    const chip = screen.getByRole("button", { name: /Waiting: ripe in 6 s/ });
    expect(chip).toBeDisabled();
  });

  it("stays out of combat and closed panels", () => {
    mock.player.hostile = true;
    const { rerender } = render(<GoalChip visible />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    mock.player.hostile = false;
    rerender(<GoalChip visible={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("celebrates a stick find, then asks to wield it and push through the brambles", async () => {
    useFirstDayStore.setState({ owner: "me", done: ["pick-berry", "eat-berry"], seen: { harvested: true, ate: true }, stickFoundAt: performance.now() });
    mock.rows = [{ slot: 1, itemId: "stick", quantity: 1 }];
    const { rerender } = render(<GoalChip visible />);
    expect(screen.getByText(/You found a sturdy stick! Tap it to wield/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Wield your stick: tap it \(key 2\)/ }));
    await waitFor(() => expect(mock.wieldItem).toHaveBeenCalledWith(1));
    mock.player = { ...mock.player, weapon: "stick", x: 30, z: 20 };
    rerender(<GoalChip visible />);
    fireEvent.click(screen.getByRole("button", { name: /Push through the brambles to the Coast/ }));
    await waitFor(() => expect(mock.setTarget).toHaveBeenCalledWith(25, 7));
  });

  it("toasts once on first reaching the Coast", () => {
    useFirstDayStore.setState({ owner: "me", done: ["pick-berry", "eat-berry", "find-stick", "wield-stick"], seen: {}, stickFoundAt: null });
    mock.rows = [{ slot: 0, itemId: "stick", quantity: 1 }];
    mock.player = { ...mock.player, weapon: "stick", x: 8, z: 25 };
    const { rerender } = render(<GoalChip visible />);
    mock.player = { ...mock.player, x: 7 };
    rerender(<GoalChip visible />);
    expect(useToastStore.getState().message).toBe("You pushed through to the Coast");
    expect(useFirstDayStore.getState().done).toContain("reach-coast");
  });

  it("remembers the done set per identity in localStorage", () => {
    mock.rows = [{ slot: 0, itemId: "berry_blueberry", quantity: 1 }];
    render(<GoalChip visible />);
    expect(JSON.parse(window.localStorage.getItem("berigame.firstDay.me")!).done).toContain("pick-berry");
  });

  it("uses the bramble copy shared with the server", () => {
    expect(BRAMBLE_MESSAGE).toBe("Thorny brambles — you need a sturdy stick to push through");
  });
});

describe("the Safe badge", () => {
  it("shows in the safe ring and hides outside it without grace", () => {
    mock.player = { ...mock.player, respawnTick: 0 };
    const { rerender } = render(<CombatHud />);
    expect(screen.getByText("Safe")).toBeInTheDocument();
    mock.player = { ...mock.player, x: 30 };
    rerender(<CombatHud />);
    expect(screen.queryByText("Safe")).not.toBeInTheDocument();
    mock.player = { ...mock.player, respawnTick: 95 };
    rerender(<CombatHud />);
    expect(screen.getByText("Safe")).toBeInTheDocument();
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
    const { rerender } = render(<CombatHud />);
    expect(screen.getByText("Rival")).toBeInTheDocument();
    expect(screen.getByText("Recovery · 3 ticks")).toBeInTheDocument();
    mock.tick = 104;
    rerender(<CombatHud />);
    expect(screen.getByText("Swing ready")).toBeInTheDocument();
    mock.players.set("opponent", {
      name: "Rival",
      online: true,
      state: PlayerState.Alive,
      x: 32,
      z: 25,
    });
    rerender(<CombatHud />);
    expect(screen.getByText("Moving into range")).toBeInTheDocument();
    expect(screen.queryByText("Swing ready")).not.toBeInTheDocument();
  });
});
