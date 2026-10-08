import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import HudToggle from "../Components/HudToggle";
import SettingsPanel from "../Components/SettingsPanel";
import { useHudStore } from "../Components/hudVisibility";

const hidden = () => document.documentElement.hasAttribute("data-hud-hidden");

afterEach(() => { cleanup(); act(() => useHudStore.setState({ hidden: false })); });

describe("hide HUD", () => {
  it("U toggles the attribute hud.css hides everything but the world with", () => {
    render(<HudToggle />);
    fireEvent.keyDown(window, { key: "u" });
    expect(hidden()).toBe(true);
    fireEvent.keyDown(window, { key: "U" });
    expect(hidden()).toBe(false);
  });

  it("ignores U while typing, held, or with a modifier", () => {
    render(<><HudToggle /><input aria-label="chat" /></>);
    fireEvent.keyDown(screen.getByLabelText("chat"), { key: "u" });
    fireEvent.keyDown(window, { key: "u", repeat: true });
    fireEvent.keyDown(window, { key: "u", metaKey: true });
    expect(hidden()).toBe(false);
  });

  it("Settings can hide the interface, and unmounting the game brings it back", () => {
    const { unmount } = render(<><HudToggle /><SettingsPanel open onClose={() => {}} /></>);
    fireEvent.click(screen.getByRole("button", { name: /Hide interface/ }));
    expect(hidden()).toBe(true);
    unmount();
    expect(hidden()).toBe(false);
  });
});
