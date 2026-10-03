import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BugReportPanel, { createBugReport, GameDiagnostics } from '../Components/BugReportPanel';
import { clearDiagnostics, diagnosticAsset, diagnosticHistory, recordDiagnostic } from '../spacetime/diagnostics';
vi.mock('../spacetime/hooks', () => ({ useMyPlayer: () => ({ name: 'PRIVATE NAME', identity: 'PRIVATE ID', region: 'settlement', x: 31, z: 64, hp: 30, state: 0, online: true }) }));
beforeEach(clearDiagnostics);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('shareable bug diagnostics', () => {
  it('keeps bounded chronological data and never exposes its mutable buffer', () => {
    for (let tick = 0; tick < 150; tick++) recordDiagnostic('tick', { tick });
    const events = diagnosticHistory(); expect(events).toHaveLength(120); expect(events[0].data.tick).toBe(30);
    events[0].data.tick = -1; expect(diagnosticHistory()[0].data.tick).toBe(30);
  });
  it('includes movement and build evidence, excluding name, identity, query credentials and raw errors', () => {
    const script = document.createElement('script'); script.src = 'https://example.com/assets/Game-abcd.js?token=SECRET'; document.body.append(script);
    render(<GameDiagnostics />);
    window.dispatchEvent(new ErrorEvent('error', { message: 'SECRET CHAT', filename: 'https://example.com/assets/Game-abcd.js?auth=SECRET', lineno: 10 }));
    const report = createBugReport('I jumped when walking');
    expect(report).toContain('Game-abcd.js'); expect(report).toContain('settlement'); expect(report).toContain('I jumped when walking');
    expect(report).not.toMatch(/PRIVATE|SECRET|auth=|token=/);
    expect(diagnosticAsset('/assets/main.js?token=x#secret')).toBe('main.js'); script.remove();
  });
  it('copies the description with diagnostics only after player action', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<BugReportPanel onClose={() => {}} />); expect(writeText).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'Walk animation skipped' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy report' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Report copied'));
    expect(JSON.parse(writeText.mock.calls[0][0]).description).toBe('Walk animation skipped');
  });
});
