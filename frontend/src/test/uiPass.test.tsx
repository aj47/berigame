import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Object3D } from "three";
import SettingsPanel from "../Components/SettingsPanel";
import { DEFAULT_SETTINGS, useSettingsStore } from "../spacetime/stores/settingsStore";
import { drawMinimap, minimapModel } from "../Components/minimapModel";
import { tipFor, TIP_MS } from "../Components/OnboardingTip";
import { clickHandlerOf, tapSamples } from "../Components/3D/tapAssist";
import GoalChip from "../Components/GoalChip";
import { useFirstDayStore } from "../spacetime/stores/firstDayStore";

const mock = vi.hoisted(() => ({
  rows: [] as any[],
  player: null as any,
  trees: [] as any[],
  startHarvest: vi.fn().mockResolvedValue(true),
  setTarget: vi.fn().mockResolvedValue(true),
}));
vi.mock("../spacetime/hooks", () => ({
  useInventoryRows: () => mock.rows,
  useMyPlayer: () => mock.player,
  useTick: () => 100,
  useTrees: () => mock.trees,
  useGiants: () => [],
  useGiantRaid: () => null,
  useNow: () => 0,
  useMenteeCounts: () => new Map(),
  useMyIdentityHex: () => "me",
  usePlayers: () => [mock.player],
}));
vi.mock("../spacetime/actions", () => ({ useGameActions: () => mock }));
vi.mock("../store", () => ({
  useUserInputStore: { getState: () => ({ clickedOtherObject: null }) },
  useLoadingStore: (select: (s: { isLoading: boolean }) => unknown) => select({ isLoading: false }),
}));

const id = (hex: string) => ({ toHexString: () => hex });
const basePlayer = () => ({
  identity: id("me"), hp: 18, maxHp: 30, weapon: "", state: 0, x: 25, z: 25, facing: 0, online: true,
  hostile: false, pending: 0, pendingId: 0n, harvestEndTick: 0, harvestTreeId: 0, respawnTick: 380, lastInputTick: 0,
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.getState().reset();
  mock.player = basePlayer();
  mock.rows = [];
  mock.trees = [{ id: 3, x: 28, z: 25, itemId: "berry_strawberry", cooldownUntilTick: 0, kind: 0 }];
});

describe("settings panel", () => {
  it("binds sound, graphics, nameplates and camera to the settings store", () => {
    render(<SettingsPanel open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Master"), { target: { value: "0.3" } });
    expect(useSettingsStore.getState().masterVolume).toBe(0.3);
    expect(JSON.parse(localStorage.getItem("berigame.settings.v1")!).masterVolume).toBe(0.3);
    fireEvent.click(screen.getByLabelText("Mute all sound"));
    expect(useSettingsStore.getState().muted).toBe(true);
    expect(screen.getByLabelText("Effects")).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Low" }));
    expect(useSettingsStore.getState().graphics).toBe("low");
    expect(screen.getByRole("radio", { name: "Low" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByLabelText("Show name plates"));
    expect(useSettingsStore.getState().showNameplates).toBe(false);
    fireEvent.change(screen.getByLabelText("Sensitivity"), { target: { value: "1.6" } });
    expect(useSettingsStore.getState().cameraSensitivity).toBe(1.6);
  });

  it("resets to defaults and closes from its close button", () => {
    const onClose = vi.fn();
    useSettingsStore.getState().set({ sfxVolume: 0.1, graphics: "high", showNameplates: false });
    render(<SettingsPanel open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    const { set: _s, reset: _r, ...values } = useSettingsStore.getState();
    expect(values).toEqual(DEFAULT_SETTINGS);
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    const { container } = render(<SettingsPanel open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("minimap model", () => {
  const players = [
    { identity: id("me"), x: 10, z: 12, facing: 6, state: 0, online: true, hostile: false },
    { identity: id("them"), x: 30, z: 30, facing: 0, state: 0, online: true, hostile: true },
    { identity: id("gone"), x: 1, z: 1, facing: 0, state: 0, online: false, hostile: false },
  ];
  const trees = [
    { x: 30, z: 25, itemId: "berry_blueberry", kind: 0, cooldownUntilTick: 0 },
    { x: 3, z: 3, itemId: "flint", kind: 2, cooldownUntilTick: 500 },
  ];
  const groundItems = [
    { x: 40, z: 40, droppedBy: id("me"), droppedOnDeath: true },
    { x: 40, z: 40, droppedBy: id("me"), droppedOnDeath: true },
    { x: 41, z: 41, droppedBy: id("me"), droppedOnDeath: false },
    { x: 20, z: 20, droppedBy: id("them"), droppedOnDeath: true },
  ];

  it("shows you with facing, online others, nodes by kind and only your death drop", () => {
    const m = minimapModel({ meHex: "me", players, trees, groundItems, tick: 100 });
    expect(m.me).toMatchObject({ x: 10, z: 12 });
    expect(m.me!.yaw).toBeCloseTo(Math.PI / 2); // facing 6 = east (+x)
    expect(m.others).toEqual([{ x: 30, z: 30, hostile: true }]);
    expect(m.nodes[0]).toMatchObject({ color: "#4F46E5", ripe: true, kind: 0 });
    expect(m.nodes[1]).toMatchObject({ kind: 2, ripe: false });
    expect(m.bags).toEqual([{ x: 40, z: 40 }]);
  });

  it("draws onto a 2D context without throwing", () => {
    const calls: string[] = [];
    const ctx = new Proxy({}, {
      get: (_t, key) => (typeof key === "string" && !["fillStyle", "strokeStyle", "lineWidth", "globalAlpha"].includes(key) ? (..._a: unknown[]) => calls.push(key) : undefined),
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    drawMinimap(ctx, minimapModel({ meHex: "me", players, trees, groundItems, tick: 100 }), 120);
    expect(calls).toContain("fillRect");
    expect(calls).not.toContain("strokeRect"); // The woodland boundary follows the terrain.
    expect(calls.filter((c) => c === "arc").length).toBeGreaterThan(2);
  });
});

describe("mobile tap assist", () => {
  it("samples a centre point and two rings", () => {
    const s = tapSamples(30);
    expect(s).toHaveLength(17);
    expect(Math.hypot(...s[16])).toBeCloseTo(30);
  });

  it("finds an ancestor's click handler but never the ground's", () => {
    const tree = new Object3D();
    const leaf = new Object3D();
    tree.add(leaf);
    const onClick = () => {};
    (tree as any).__r3f = { handlers: { onClick } };
    expect(clickHandlerOf(leaf)?.handler).toBe(onClick);
    const land = new Object3D();
    land.name = "land_mesh";
    (land as any).__r3f = { handlers: { onClick } };
    expect(clickHandlerOf(land)).toBeNull();
    expect(clickHandlerOf(new Object3D())).toBeNull();
  });
});

describe("onboarding tips and the First Day celebration", () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ left: 20, top: 70, right: 220, bottom: 120, width: 200, height: 50, x: 20, y: 70, toJSON() {} } as DOMRect);
    useFirstDayStore.setState({ owner: null, done: [], seen: {}, tipped: [], activeTip: null, celebrating: false, stickFoundAt: null });
  });

  it("points eat and wield tips at the quick-bar slot", () => {
    expect(tipFor({ id: "eat-berry", text: "", hint: "", action: { kind: "eat", slot: 1 } }).targets[0]).toBe('.hotbar-slot[data-slot="1"]');
    expect(tipFor({ id: "reach-coast", text: "", hint: "", action: null }).targets[0]).toBe(".minimap");
  });

  it("shows a step's tip once, remembers it, and does not show it again after a reload", () => {
    vi.useFakeTimers();
    const { unmount } = render(<GoalChip visible />);
    expect(screen.getByText(/walk to a berry tree and pick it/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("berigame.firstDay.me")!).tipped).toContain("pick-berry");
    act(() => { vi.advanceTimersByTime(TIP_MS + 10); });
    expect(screen.queryByText(/walk to a berry tree and pick it/)).not.toBeInTheDocument();
    unmount();
    // "Reload": a fresh store read from storage.
    useFirstDayStore.setState({ owner: null, done: [], seen: {}, tipped: [], activeTip: null, celebrating: false });
    render(<GoalChip visible />);
    expect(screen.queryByText(/walk to a berry tree and pick it/)).not.toBeInTheDocument();
  });

  it("dismisses a tip on the next tap anywhere", () => {
    render(<GoalChip visible />);
    expect(screen.getByText(/walk to a berry tree/)).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText(/walk to a berry tree/)).not.toBeInTheDocument();
  });

  it("celebrates First Day when it completes, once", () => {
    const steps = ["pick-berry", "eat-berry", "find-stick", "wield-stick"];
    localStorage.setItem("berigame.firstDay.me", JSON.stringify({ done: steps, seen: {}, tipped: ["pick-berry", "gather-coast", "reach-coast"] }));
    mock.rows = [{ slot: 0, itemId: "stick", quantity: 1 }];
    mock.player = { ...basePlayer(), weapon: "stick", x: 8, z: 25 };
    const { rerender, unmount } = render(<GoalChip visible />);
    expect(screen.queryByText("You made it to the Coast!")).not.toBeInTheDocument();
    mock.player = { ...mock.player, x: 7 };
    rerender(<GoalChip visible />);
    expect(screen.getByText("You made it to the Coast!")).toBeInTheDocument();
    unmount();
    useFirstDayStore.setState({ owner: null, done: [], seen: {}, tipped: [], activeTip: null, celebrating: false });
    render(<GoalChip visible />);
    expect(screen.queryByText("You made it to the Coast!")).not.toBeInTheDocument();
  });
});
