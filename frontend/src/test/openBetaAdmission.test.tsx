import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../spacetime/connection', () => ({ SPACETIME_DB: 'test-beta', SPACETIME_URI: 'wss://example.test', TOKEN_KEY: 'open-beta-test' }));
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

test('public admission needs no code and saves a renewable character', async () => {
  vi.stubEnv('VITE_INVITE_REQUIRED', 'true');
  vi.stubEnv('VITE_OPEN_BETA', 'true');
  vi.resetModules();
  const { default: BetaAdmission } = await import('../agent/BetaAdmission');
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    token: 'test-character', uri: 'wss://example.test', database: 'test-beta',
    expiresAt: new Date(Date.now() + 3600000).toISOString(), renewToken: `bgr_${'a'.repeat(43)}`,
  }) });
  vi.stubGlobal('fetch', fetchMock);
  render(<BetaAdmission><p>Island loaded</p></BetaAdmission>);
  expect(screen.queryByLabelText('Your player invite')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Enter the island' }));
  await waitFor(() => expect(screen.getByText('Island loaded')).toBeTruthy());
  expect(fetchMock).toHaveBeenCalledWith('/api/play/v1/sessions', expect.objectContaining({
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }));
  expect(localStorage.getItem('open-beta-test')).toBe('test-character');
});

test('a capacity rejection stays on the entry screen and allows retry', async () => {
  vi.stubEnv('VITE_INVITE_REQUIRED', 'true');
  vi.stubEnv('VITE_OPEN_BETA', 'true');
  vi.resetModules();
  const { default: BetaAdmission } = await import('../agent/BetaAdmission');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'Player session capacity reached. Try later.' } }) }));
  render(<BetaAdmission><p>Island loaded</p></BetaAdmission>);
  fireEvent.click(screen.getByRole('button', { name: 'Enter the island' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('capacity reached'));
  expect(screen.queryByText('Island loaded')).toBeNull();
  expect(localStorage.getItem('open-beta-test')).toBeNull();
  expect((screen.getByRole('button', { name: 'Enter the island' }) as HTMLButtonElement).disabled).toBe(false);
});

test('returning players see capacity details and can pause retries', async () => {
  vi.stubEnv('VITE_INVITE_REQUIRED', 'true');
  vi.stubEnv('VITE_OPEN_BETA', 'true');
  vi.resetModules();
  localStorage.setItem('open-beta-test', 'saved-character');
  localStorage.setItem('open-beta-test:renew', `bgr_${'a'.repeat(43)}`);
  localStorage.setItem('open-beta-test:permit-expires', String(Date.now() - 1));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'session_capacity' } }),
    { status: 429, headers: { 'Retry-After': '120' } })));
  const { default: BetaAdmission } = await import('../agent/BetaAdmission');
  render(<BetaAdmission><p>Island loaded</p></BetaAdmission>);
  await waitFor(() => expect(screen.getByText(/reached its player limit/)).toBeTruthy());
  expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Pause automatic retry' }));
  expect(screen.getByRole('button', { name: 'Resume automatic retry' })).toBeTruthy();
  expect(localStorage.getItem('open-beta-test')).toBe('saved-character');
});

test('an idle logout closes the game and waits for the player to return', async () => {
  vi.stubEnv('VITE_INVITE_REQUIRED', 'true');
  vi.stubEnv('VITE_OPEN_BETA', 'true');
  vi.resetModules();
  localStorage.setItem('open-beta-test', 'saved-character');
  localStorage.setItem('open-beta-test:renew', `bgr_${'a'.repeat(43)}`);
  localStorage.setItem('open-beta-test:permit-expires', String(Date.now() + 3600_000));
  const { default: BetaAdmission } = await import('../agent/BetaAdmission');
  const { reportSignedOut } = await import('../spacetime/visitRenewal');
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'idle_logout' } }), { status: 409 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ renewToken: `bgr_${'b'.repeat(43)}`, expiresAt: new Date(Date.now() + 3600_000).toISOString() }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<BetaAdmission><p>Island loaded</p></BetaAdmission>);
  expect(screen.getByText('Island loaded')).toBeTruthy();
  reportSignedOut();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Return to the island' })).toBeTruthy());
  expect(screen.queryByText('Island loaded')).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Return to the island' }));
  await waitFor(() => expect(screen.getByText('Island loaded')).toBeTruthy());
  expect(fetchMock.mock.calls[1][1].body).toBe('{"resume":true}');
});
