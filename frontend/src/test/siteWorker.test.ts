// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import worker from '../../cloudflare/site-worker';

const request = (host: string, path: string, method = 'GET') => new Request(`https://${host}${path}`, { method });
const env = () => ({ ASSETS: { fetch: vi.fn(async () => new Response('static website')) } });
const documentEnv = (body = '# Crafting', contentType = 'text/markdown') => ({ ASSETS: { fetch: vi.fn(async (_request: Request) => new Response(body, { headers: { 'Content-Type': contentType, ETag: '"wiki-test"' } })) } });

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

  it.each(['/favicon.svg', '/favicon.ico', '/favicon.png', '/apple-touch-icon.png', '/icon.png', '/logo.png'])('serves the beta brand asset %s through the shared site', async path => {
    const incoming = request('beta.berigame.com', `${path}?v=blueberry-1`);
    const bindings = env();
    const response = await worker.fetch(incoming, bindings);
    expect(response.status).toBe(200);
    expect(bindings.ASSETS.fetch).toHaveBeenCalledWith(incoming);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
  });

  it.each(['/', '/play', '/favicon-unknown.png', '/icon.png/extra', '/assets/game.js'])('does not serve the public site bundle for beta path %s', async path => {
    const bindings = env();
    expect((await worker.fetch(request('beta.berigame.com', path), bindings)).status).toBe(404);
    expect(bindings.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it('rejects a missing beta icon instead of returning the SPA shell', async () => {
    const response = await worker.fetch(request('beta.berigame.com', '/icon.png'), documentEnv('<html>SPA shell</html>', 'text/html'));
    expect(response.status).toBe(404);
  });

  it.each([
    ['/llms.txt', 'text/plain'], ['/llms-full.txt', 'text/plain'],
    ['/wiki-index.json', 'application/json'], ['/wiki/crafting.md', 'text/markdown'],
    ['/robots.txt', 'text/plain'], ['/sitemap.xml', 'application/xml'],
  ])('serves %s as a readable document', async (path, type) => {
    const response = await worker.fetch(request('wiki.berigame.com', path), documentEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain(type);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Link')).toContain('/llms.txt');
    expect(await response.text()).toBe('# Crafting');
  });

  it.each([['/crafting', '/wiki/crafting.md'], ['/getting%2Dstarted/', '/wiki/getting-started.md'], ['/', '/llms.txt']])('negotiates Markdown for %s', async (path, target) => {
    const bindings = documentEnv();
    const response = await worker.fetch(new Request(`https://wiki.berigame.com${path}?q=wood`, { headers: { Accept: 'text/markdown' } }), bindings);
    expect(response.status).toBe(200);
    expect(response.headers.get('Vary')).toContain('Accept');
    expect(response.headers.get('Content-Location')).toBe(target);
    expect(bindings.ASSETS.fetch.mock.calls[0][0].url).toBe(`https://wiki.berigame.com${target}`);
  });

  it.each(['*/*', 'text/markdown;q=0', 'text/html, text/markdown;q=0.5', 'text/markdown;q=bad'])('preserves HTML for Accept: %s', async accept => {
    const incoming = new Request('https://wiki.berigame.com/crafting', { headers: { Accept: accept } });
    const bindings = env();
    const response = await worker.fetch(incoming, bindings);
    expect(bindings.ASSETS.fetch).toHaveBeenCalledWith(incoming);
    expect(response.headers.get('Vary')).toContain('Accept');
    expect(response.headers.get('Link')).toContain('</wiki/crafting.md>; rel="alternate"');
    expect(await response.text()).toBe('static website');
  });

  it('keeps the main landing page when Markdown is requested', async () => {
    const incoming = new Request('https://berigame.com/', { headers: { Accept: 'text/markdown' } });
    const bindings = env();
    const response = await worker.fetch(incoming, bindings);
    expect(bindings.ASSETS.fetch).toHaveBeenCalledWith(incoming);
    expect(await response.text()).toBe('static website');
  });

  it.each(['/docs%2Fcrafting', '/crafting%5Cother', '/%ZZ'])('does not turn malformed page path %s into a Markdown article', async path => {
    const incoming = new Request(`https://wiki.berigame.com${path}`, { headers: { Accept: 'text/markdown' } });
    const bindings = env();
    const response = await worker.fetch(incoming, bindings);
    expect(bindings.ASSETS.fetch).toHaveBeenCalledWith(incoming);
    expect(response.headers.get('Content-Location')).toBeNull();
  });

  it.each(['/wiki/not-a-page.md', '/llms.txt', '/wiki-index.json'])('returns 404 if %s is a missing asset with an HTML fallback', async path => {
    const response = await worker.fetch(request('wiki.berigame.com', path), documentEnv('<html>SPA shell</html>', 'text/html'));
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('ETag')).toBeNull();
    expect(await response.text()).not.toContain('<html>');
  });

  it('returns 404 for a missing negotiated article', async () => {
    const response = await worker.fetch(new Request('https://wiki.berigame.com/missing', { headers: { Accept: 'text/markdown' } }), documentEnv('<html>SPA</html>', 'text/html'));
    expect(response.status).toBe(404);
    expect(response.headers.get('Vary')).toContain('Accept');
  });

  it.each(['/wiki/unsafe%2Fpath.md', '/wiki/%ZZ.md', '/wiki/nested/path.md'])('rejects malformed document path %s', async path => {
    const bindings = env();
    const response = await worker.fetch(request('wiki.berigame.com', path), bindings);
    expect(response.status).toBe(404);
    expect(bindings.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it('serves HEAD with the same representation headers and no body', async () => {
    const response = await worker.fetch(new Request('https://wiki.berigame.com/crafting', { method: 'HEAD', headers: { Accept: 'text/markdown' } }), documentEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/markdown');
    expect(response.headers.get('Content-Location')).toBe('/wiki/crafting.md');
    expect(await response.text()).toBe('');
  });

  it('preserves conditional asset responses', async () => {
    const bindings = { ASSETS: { fetch: vi.fn(async () => new Response(null, { status: 304, headers: { ETag: '"wiki-test"' } })) } };
    const response = await worker.fetch(request('wiki.berigame.com', '/wiki/crafting.md'), bindings);
    expect(response.status).toBe(304);
    expect(response.headers.get('ETag')).toBe('"wiki-test"');
    expect(await response.text()).toBe('');
  });
});
