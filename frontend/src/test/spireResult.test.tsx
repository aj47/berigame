import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BossId, BossNoticeKind, SpireMemberState, SpireOutcome, SpireStage } from '@sim';
import { identity, seedRun } from './spireFixtures';

const mock = vi.hoisted(() => ({ players: new Map<string, any>() }));
vi.mock('../spacetime/hooks', () => ({ usePlayersByHex: () => mock.players }));

import SpireResult, { resultHeadline, resultVisible } from '../bosses/spire/SpireResult';
import { useBossStore } from '../bosses/bossStore';
import { inSpire } from '../bosses/selectors';

// You stand at the exit (61,45), off the floor: the card is keyed on membership, not position.
const me = { identity: identity('me'), name: 'Me', x: 61, z: 45, region: 'bramblewild' };
const notice = (kind: number, over: Record<string, unknown> = {}) => ({
  tick: 300, boss: BossId.Spire, kind, player: identity('me'), runId: 7n, amount: 0, total: 0, hp: 0, half: 0, quantity: 0, itemId: '', x: 0, z: 0, ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  mock.players = new Map([['me', me], ['ada', { ...me, identity: identity('ada'), name: 'Ada' }]]);
});
afterEach(() => { cleanup(); vi.useRealTimers(); useBossStore.getState().reset(); });

const skipIntro = () => act(() => { vi.advanceTimersByTime(1300); });

describe('SpireResult', () => {
  it('shows for a Done member of a Cleared run while you stand at the exit', () => {
    expect(inSpire(me)).toBe(false);
    seedRun({ stage: SpireStage.Cleared, outcome: SpireOutcome.Cleared, clearTicks: 420 },
      { me: { state: SpireMemberState.Done }, ada: { state: SpireMemberState.Done } }, { hits0: 0 });
    act(() => {
      useBossStore.getState().pushNotice(notice(BossNoticeKind.Reward, { itemId: 'berry_goldberry', quantity: 4 }) as any);
      useBossStore.getState().pushNotice(notice(BossNoticeKind.Reward, { itemId: 'prism_shard', quantity: 1 }) as any);
      useBossStore.getState().pushNotice(notice(BossNoticeKind.Keepsake, { quantity: 13 }) as any);
      useBossStore.getState().pushNotice(notice(BossNoticeKind.Keepsake, { quantity: 14 }) as any);
    });
    render(<SpireResult />);
    expect(screen.getByTestId('spire-result')).toHaveTextContent('The Shardmother shatters');
    skipIntro();
    const card = screen.getByTestId('spire-result');
    expect(card).toHaveTextContent('Cleared in 4:12');
    expect(card).toHaveTextContent('Ada');
    expect(card).toHaveTextContent('4 Goldberry');
    expect(card).toHaveTextContent('1 Prism Shard');
    expect(card).toHaveTextContent('Keepsake: Prism Crown');
    expect(card).toHaveTextContent('Flawless!');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('spire-result')).not.toBeInTheDocument();
  });

  it('shows for an Out or Left member of a Failed run, with the outcome', () => {
    seedRun({ stage: SpireStage.Failed, outcome: SpireOutcome.TimedOut }, { me: { state: SpireMemberState.Out } });
    render(<SpireResult />);
    expect(screen.getByTestId('spire-result')).toHaveTextContent('Time ran out');
    skipIntro();
    expect(screen.getByTestId('spire-result')).toHaveTextContent('No reward this time');
    expect(screen.getByTestId('spire-result')).toHaveTextContent('Me (knocked out)');
    cleanup();
    // A Left row shows the card with its RunResult notice.
    seedRun({ stage: SpireStage.Failed, outcome: SpireOutcome.Wiped }, { me: { state: SpireMemberState.Left } });
    act(() => { useBossStore.getState().pushNotice(notice(BossNoticeKind.RunResult, { quantity: SpireOutcome.Wiped }) as any); });
    render(<SpireResult />);
    expect(screen.getByTestId('spire-result')).toHaveTextContent('The party fell');
  });

  it('a forfeit (Left, no RunResult) gets no card when the party later finishes', () => {
    seedRun({ stage: SpireStage.Active }, { me: { state: SpireMemberState.Left }, ada: { state: SpireMemberState.In } });
    render(<SpireResult />);
    act(() => {
      const s = useBossStore.getState();
      s.setRow('spireRun', { ...s.myRun!, stage: SpireStage.Cleared, outcome: SpireOutcome.Cleared });
      s.setRow('spireMember', { ...s.members.get('ada')!, state: SpireMemberState.Done });
      // Another run's result does not count.
      s.pushNotice(notice(BossNoticeKind.RunResult, { runId: 8n }) as any);
    });
    expect(screen.queryByTestId('spire-result')).not.toBeInTheDocument();
  });

  it('is hidden while the run is Active, and closes itself when the run row is deleted', () => {
    seedRun({ stage: SpireStage.Active }, { me: { state: SpireMemberState.Out } });
    render(<SpireResult />);
    expect(screen.queryByTestId('spire-result')).not.toBeInTheDocument();
    act(() => useBossStore.getState().setRow('spireRun', { ...useBossStore.getState().myRun!, stage: SpireStage.Cleared, outcome: SpireOutcome.Cleared }));
    expect(screen.getByTestId('spire-result')).toBeInTheDocument();
    act(() => { useBossStore.getState().deleteRow('spireRun', 7n); });
    expect(screen.queryByTestId('spire-result')).not.toBeInTheDocument();
  });

  it('lists a slot whose member row is gone as "left"', () => {
    seedRun({ stage: SpireStage.Cleared, outcome: SpireOutcome.Cleared, partySize: 3 }, { me: { state: SpireMemberState.Done } });
    render(<SpireResult />);
    skipIntro();
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(rows[3]).toHaveTextContent('left');
  });

  it('decides visibility from membership (Left needs its RunResult)', () => {
    expect(resultVisible({ state: SpireMemberState.Done }, { stage: SpireStage.Cleared })).toBe(true);
    expect(resultVisible({ state: SpireMemberState.In }, { stage: SpireStage.Cleared })).toBe(false);
    expect(resultVisible({ state: SpireMemberState.Done }, { stage: SpireStage.Active })).toBe(false);
    expect(resultVisible(null, { stage: SpireStage.Failed })).toBe(false);
    expect(resultVisible({ state: SpireMemberState.Left }, { stage: SpireStage.Cleared })).toBe(false);
    expect(resultVisible({ state: SpireMemberState.Left }, { stage: SpireStage.Cleared }, true)).toBe(true);
    expect(resultVisible({ state: SpireMemberState.Left }, { stage: SpireStage.Active }, true)).toBe(false);
    expect(resultHeadline({ stage: SpireStage.Failed, outcome: SpireOutcome.Closed })).toBe('The Sunken Spire was sealed');
  });
});
