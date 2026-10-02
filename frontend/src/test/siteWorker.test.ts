// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import worker from '../../cloudflare/site-worker';

const request = (host: string, path: string, method = 'GET') => new Request(`https://${host}${path}`, { method });
const env = () => ({ ASSETS: { fetch: vi.fn(async () => new Response('static website')) } });

describe('public website hosting', () => {
  it.each([
    ['berigame.com', '/docs', 'https://wiki.berigame.com/'],
    ['berigame.com', '/docs/crafting/?q=club', 'https://wiki.berigame.com/crafting?q=club'],
    ['wiki.berigame.com', '/docs/item-stone-club', 'https://wiki.berigame.com/item-stone-club'],
  ])('canonicalizes %s%s without losing search', async (host, path, destination) => {
    const bindings = env();
    const response = await worker.fetch(request(host, path), bindings);
    expect(response.status).toBe(308);
    expect(response.headers.get('Location')).toBe(destination);
    expect(bindings.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['berigame.com', '/play?join=CODE', 'https://beta.berigame.com/?join=CODE'],
    ['wiki.berigame.com', '/play/', 'https://beta.berigame.com/'],
    ['berigame.com', '/?join=CODE&source=friend', 'https://beta.berigame.com/?join=CODE&source=friend'],
    ['wiki.berigame.com', '/agent', 'https://beta.berigame.com/agent'],
    ['berigame.com', '/agent.md', 'https://beta.berigame.com/agent.md'],
  ])('sends %s%s to the existing game host', async (host, path, destination) => {
    const response = await worker.fetch(request(host, path), env());
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(destination);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it.each([
    ['berigame.com', '/'],
    ['wiki.berigame.com', '/'],
    ['wiki.berigame.com', '/crafting?q=stick'],
    ['wiki.berigame.com', '/?join=CODE'],
    ['wiki.berigame.com', '/favicon.svg'],
    ['berigame.com', '/site/berigame-trailer.mp4'],
  ])('serves %s%s through the static asset binding', async (host, path) => {
    const bindings = env();
    const incoming = request(host, path);
    const response = await worker.fetch(incoming, bindings);
    expect(await response.text()).toBe('static website');
    expect(bindings.ASSETS.fetch).toHaveBeenCalledWith(incoming);
  });

  it('keeps API requests out of the HTML fallback and never handles player admission', async () => {
    const bindings = env();
    const response = await worker.fetch(request('berigame.com', '/api/play/v1/sessions', 'POST'), bindings);
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(bindings.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it('rejects writes to public pages', async () => {
    const bindings = env();
    const response = await worker.fetch(request('berigame.com', '/play', 'POST'), bindings);
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
    expect(bindings.ASSETS.fetch).not.toHaveBeenCalled();
  });
});
