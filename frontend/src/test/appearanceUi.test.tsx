import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE } from '@sim';
import AppearancePanel from '../Components/AppearancePanel';
import { useAppearancePreview } from '../appearance/store';

const mock = vi.hoisted(() => ({ rows: [] as any[], setAppearance: vi.fn().mockResolvedValue(true) }));
vi.mock('../spacetime/hooks', () => ({ useMyIdentityHex: () => 'self', useAppearanceRows: () => mock.rows }));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ setAppearance: mock.setAppearance }) }));
beforeEach(() => { mock.rows = []; mock.setAppearance.mockReset().mockResolvedValue(true); useAppearancePreview.setState({ draft: null }); });
afterEach(() => cleanup());

describe('wardrobe preview and persistence boundary', () => {
  it('previews choices locally and saves the complete selection only on Save', async () => {
    const close = vi.fn();
    render(<AppearancePanel open onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Topknot', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Robe: Forest', exact: true }));
    expect(mock.setAppearance).not.toHaveBeenCalled();
    expect(useAppearancePreview.getState().draft).toEqual({ ...DEFAULT_APPEARANCE, hairStyle: 2, robeColor: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Save style', exact: true }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mock.setAppearance).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, hairStyle: 2, robeColor: 1 });
    expect(useAppearancePreview.getState().draft).toBeNull();
  });
  it('Cancel and external panel switching clear the draft without saving', () => {
    const close = vi.fn();
    const { rerender } = render(<AppearancePanel open onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skin tone: Brown', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    expect(mock.setAppearance).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(useAppearancePreview.getState().draft).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hair color: Silver', exact: true }));
    rerender(<AppearancePanel open={false} onClose={close} />);
    expect(useAppearancePreview.getState().draft).toBeNull();
  });
  it('opens from the local player saved row, keeps an in-progress preview, and reopens the latest saved row', () => {
    mock.rows = [{ ...DEFAULT_APPEARANCE, hairStyle: 1, robeColor: 4, identity: { toHexString: () => 'self' } }, { ...DEFAULT_APPEARANCE, hairStyle: 2, identity: { toHexString: () => 'other' } }];
    const { rerender } = render(<AppearancePanel open onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Cropped' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Robe: Oat' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Tousled' }));
    mock.rows[0] = { ...mock.rows[0], wrapColor: 2 };
    rerender(<AppearancePanel open onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Tousled' })).toHaveAttribute('aria-pressed', 'true');
    rerender(<AppearancePanel open={false} onClose={() => {}} />);
    rerender(<AppearancePanel open onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Cropped' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Wraps: Slate' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('keeps a failed preview for retry instead of closing or pretending it saved', async () => {
    mock.setAppearance.mockResolvedValue(false);
    const close = vi.fn();
    render(<AppearancePanel open onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Robe: Plum' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }));
    await screen.findByRole('alert');
    expect(close).not.toHaveBeenCalled();
    expect(useAppearancePreview.getState().draft?.robeColor).toBe(3);
    expect(screen.getByRole('button', { name: 'Save style' })).toBeEnabled();
  });
  it('does not close a different panel when an earlier save resolves after leaving', async () => {
    let finish!: (result: boolean) => void;
    mock.setAppearance.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const close = vi.fn();
    const { rerender } = render(<AppearancePanel open onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Robe: Plum' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }));
    rerender(<AppearancePanel open={false} onClose={close} />);
    finish(true);
    await waitFor(() => expect(mock.setAppearance).toHaveBeenCalledOnce());
    expect(close).not.toHaveBeenCalled();
    expect(useAppearancePreview.getState().draft).toBeNull();
  });
});
