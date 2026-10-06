import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpireMemberState, SpireStage } from '@sim';

const { stub } = vi.hoisted(() => ({ stub: (id: string) => () => <div data-testid={id} /> }));
vi.mock('../bosses/spire/SpireHud', () => ({ default: stub('spire-hud') }));
vi.mock('../bosses/spire/SpireControls', () => ({ default: stub('spire-controls') }));
vi.mock('../bosses/spire/SpireLobbyPanel', () => ({ default: stub('spire-lobby') }));
vi.mock('../bosses/spire/SpireResult', () => ({ default: stub('spire-result') }));

import { SpireLayer } from '../Components/UIComponents';
import { BossAreaTip, bossTipAt, BOSS_TIPS } from '../Components/OnboardingTip';
import SettingsPanel from '../Components/SettingsPanel';
import { useBossStore } from '../bosses/bossStore';
import { useSettingsStore } from '../spacetime/stores/settingsStore';

afterEach(() => { cleanup(); useBossStore.getState().reset(); useSettingsStore.getState().reset(); localStorage.clear(); });

const membership = (state: number, stage: number) => act(() => {
  useBossStore.setState({ myMember: { state } as any, myRun: { stage } as any });
});
const shown = () => ['spire-hud', 'spire-controls', 'spire-lobby', 'spire-result'].filter((id) => screen.queryByTestId(id));

describe('Spire HUD mounts', () => {
  it('inside: HUD and step controls; the result card is always mounted', () => {
    render(<SpireLayer inside />);
    expect(shown()).toEqual(['spire-hud', 'spire-controls', 'spire-result']);
  });

  it('outside: the lobby panel while the gate panel is open or you wait in a lobby, the party chip while your run fights', () => {
    render(<SpireLayer inside={false} />);
    expect(shown()).toEqual(['spire-result']);
    act(() => useBossStore.getState().setLobbyOpen(true));
    expect(shown()).toEqual(['spire-lobby', 'spire-result']);
    act(() => useBossStore.getState().setLobbyOpen(false));
    membership(SpireMemberState.Lobby, SpireStage.Lobby);
    expect(shown()).toEqual(['spire-lobby', 'spire-result']);
    // Knocked out while the party fights on: SpireHud draws the chip.
    membership(SpireMemberState.Out, SpireStage.Active);
    expect(shown()).toEqual(['spire-hud', 'spire-result']);
    membership(SpireMemberState.Done, SpireStage.Cleared);
    expect(shown()).toEqual(['spire-result']);
  });
});

describe('first-arrival boss tips', () => {
  it('names the glade and the gate zone, nothing elsewhere or in other regions', () => {
    expect(bossTipAt({ x: 84, z: 106 })).toBe('clatter-glade');
    expect(bossTipAt({ x: 61, z: 45, region: 'bramblewild' })).toBe('spire-gate');
    expect(bossTipAt({ x: 30, z: 30 })).toBeNull();
    expect(bossTipAt({ x: 84, z: 106, region: 'settlement' })).toBeNull();
    expect(bossTipAt(null)).toBeNull();
  });

  it('shows once per browser, dismisses on a tap, and respects the guidance setting', () => {
    const ui = render(<BossAreaTip me={{ x: 84, z: 106 }} />);
    expect(screen.getByTestId('boss-tip')).toHaveTextContent(BOSS_TIPS['clatter-glade']);
    fireEvent.pointerDown(window);
    expect(screen.queryByTestId('boss-tip')).not.toBeInTheDocument();
    ui.rerender(<BossAreaTip me={{ x: 30, z: 30 }} />);
    ui.rerender(<BossAreaTip me={{ x: 84, z: 106 }} />);
    expect(screen.queryByTestId('boss-tip')).not.toBeInTheDocument();
    act(() => useSettingsStore.getState().set({ showGuidance: false }));
    ui.rerender(<BossAreaTip me={{ x: 62, z: 46 }} />);
    expect(screen.queryByTestId('boss-tip')).not.toBeInTheDocument();
  });
});

describe('dodge assist setting', () => {
  it('is on by default and toggles from Settings > Controls', () => {
    render(<SettingsPanel open onClose={() => {}} />);
    const box = screen.getByRole('checkbox', { name: 'Dodge assist' });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(useSettingsStore.getState().dodgeAssist).toBe(false);
  });
});
