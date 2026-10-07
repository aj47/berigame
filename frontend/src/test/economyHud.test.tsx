import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DROP_BOXES, ENERGY_MAX, ENERGY_SEASON_MS, Pending, energyRestedLine } from "@sim";
import EconomyHud from "../Components/EconomyHud";
import VaultPanel from "../Components/VaultPanel";

const NOW = 1_000_000_000;
const mock = vi.hoisted(() => ({
  rows: [] as any[],
  vault: [] as any[],
  energy: undefined as any,
  player: { x: 25, z: 25, region: "bramblewild", state: 0, pending: 0 } as any,
  vaultDeposit: vi.fn().mockResolvedValue(true),
  vaultWithdraw: vi.fn().mockResolvedValue(true),
  setTarget: vi.fn().mockResolvedValue(true),
}));
vi.mock("../spacetime/hooks", () => ({
  useInventoryRows: () => mock.rows,
  useMyPlayer: () => mock.player,
  useMyEnergy: () => mock.energy,
  useMyVaultSlots: () => mock.vault,
  useNow: () => NOW,
}));
vi.mock("../spacetime/actions", () => ({ useGameActions: () => mock }));

beforeEach(() => {
  mock.rows = [];
  mock.vault = [];
  mock.energy = undefined;
  mock.player = { x: 25, z: 25, region: "bramblewild", state: 0, pending: 0 };
  vi.clearAllMocks();
});
afterEach(cleanup);

const seasoned = (points: number) => ({ id: "me", points, at: NOW, born: NOW - ENERGY_SEASON_MS, tired: 0 });

describe("economy strip", () => {
  it("shows the energy band with its numbers and the rested line", () => {
    mock.energy = seasoned(energyRestedLine(ENERGY_MAX) + 50);
    render(<EconomyHud />);
    const meter = screen.getByRole("meter", { name: "Energy: Rested ×2" });
    expect(meter).toHaveAttribute("aria-valuemax", String(ENERGY_MAX));
    expect(meter.getAttribute("title")).toMatch(/pays double/);
    cleanup();
    mock.energy = seasoned(0);
    render(<EconomyHud />);
    expect(screen.getByRole("meter", { name: "Energy: Tired" })).toBeInTheDocument();
  });

  it("before the first harvest shows normal pay without invented numbers", () => {
    render(<EconomyHud />);
    const meter = screen.getByRole("meter", { name: "Energy: Energy" });
    expect(meter.getAttribute("title")).toMatch(/^Gathering pays normally/);
  });

  it("shows the unbanked value and glows from 30, not counting your first weapon", () => {
    mock.player = { ...mock.player, x: 35 };
    mock.rows = [{ slot: 0, itemId: "stick", quantity: 1 }];
    const { rerender } = render(<EconomyHud />);
    expect(screen.queryByText(/Unbanked/)).toBeNull();
    mock.rows = [{ slot: 0, itemId: "stick", quantity: 1 }, { slot: 3, itemId: "driftwood", quantity: 30 }];
    rerender(<EconomyHud />);
    expect(screen.getByText("Unbanked 30")).toHaveClass("load-1");
  });

  it("offers the vault in the safe ring and the drop box beside one, and nothing elsewhere", () => {
    const open = vi.fn();
    const { rerender } = render(<EconomyHud onOpenVault={open} />);
    fireEvent.click(screen.getByRole("button", { name: "Vault" }));
    expect(open).toHaveBeenCalled();
    mock.player = { ...mock.player, x: DROP_BOXES[0].x + 1, z: DROP_BOXES[0].z };
    rerender(<EconomyHud onOpenVault={open} />);
    expect(screen.getByRole("button", { name: "Drop box" })).toBeInTheDocument();
    mock.player = { ...mock.player, x: 35, z: 25 };
    rerender(<EconomyHud onOpenVault={open} />);
    expect(screen.queryByRole("button", { name: /Vault|Drop box/ })).toBeNull();
  });
});

describe("vault panel", () => {
  it("deposits and withdraws in the safe ring, one request at a time", async () => {
    mock.rows = [{ slot: 4, itemId: "driftwood", quantity: 7 }];
    mock.vault = [{ itemId: "flint", quantity: 3 }, null];
    render(<VaultPanel open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Deposit 7 Driftwood" }));
    expect(mock.vaultDeposit).toHaveBeenCalledWith("driftwood", 7);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Withdraw 3 Flint Shard" }));
    expect(mock.vaultWithdraw).toHaveBeenCalledWith("flint", 3);
  });

  it("at a drop box only deposits, and says a hit or a step stops it", () => {
    mock.player = { ...mock.player, x: DROP_BOXES[1].x, z: DROP_BOXES[1].z + 1 };
    mock.rows = [{ slot: 4, itemId: "driftwood", quantity: 2 }];
    mock.vault = [{ itemId: "flint", quantity: 3 }];
    render(<VaultPanel open onClose={() => {}} />);
    expect(screen.getByText(/deposits take 2.4 s and a hit or a step stops them/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw 3 Flint Shard" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deposit 2 Driftwood" })).toBeEnabled();
  });

  it("while depositing, holds further deposits; away from any bank, offers the walk", () => {
    mock.player = { ...mock.player, x: DROP_BOXES[1].x, z: DROP_BOXES[1].z, pending: Pending.Deposit };
    mock.rows = [{ slot: 4, itemId: "driftwood", quantity: 2 }];
    const { rerender } = render(<VaultPanel open onClose={() => {}} />);
    expect(screen.getByText(/Depositing/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deposit 2 Driftwood" })).toBeDisabled();
    mock.player = { ...mock.player, x: 35, z: 25, pending: 0 };
    rerender(<VaultPanel open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Walk to the Grove vault" }));
    expect(mock.setTarget).toHaveBeenCalledWith(25, 25);
  });

  it("renders nothing while closed", () => {
    const { container } = render(<VaultPanel open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
