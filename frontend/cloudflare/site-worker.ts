/** Public website and wiki. The existing beta Worker continues to own the game. */
import { prefersMarkdown, wikiDiscoveryLinks, wikiDocumentType, wikiPageDocument } from '../src/site/wikiHttp';

interface SiteEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const WIKI_ORIGIN = 'https://wiki.berigame.com';
const GAME_ORIGIN = 'https://beta.berigame.com';
const BRAND_ASSETS = new Set(['/favicon.svg', '/favicon.ico', '/favicon.png', '/apple-touch-icon.png', '/icon.png', '/logo.png']);

async function wikiDocument(request: Request, env: SiteEnv, path: string, negotiated: boolean): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = path;
  // Search parameters do not change a documentation snapshot.
  url.search = '';
  const asset = await env.ASSETS.fetch(new Request(url, request));
  const headers = new Headers(asset.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Link', wikiDiscoveryLinks(path));
  if (negotiated) {
    headers.set('Vary', [headers.get('Vary'), 'Accept'].filter(Boolean).join(', '));
    headers.set('Content-Location', path);
  }
  // The asset binding's SPA fallback is a 200 HTML shell, not a missing document.
  if (asset.status === 404 || (asset.ok && asset.headers.get('Content-Type')?.toLowerCase().includes('text/html'))) {
    headers.set('Content-Type', 'text/plain; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    headers.delete('Content-Length');
    headers.delete('ETag');
    return new Response(request.method === 'HEAD' ? null : 'Wiki document not found.\n', { status: 404, headers });
  }
  headers.set('Content-Type', wikiDocumentType(path)!);
  return new Response(request.method === 'HEAD' || asset.status === 304 ? null : asset.body, { status: asset.status, headers });
}

function redirect(url: URL, origin: string, pathname: string, status: 302 | 308): Response {
  const destination = new URL(origin);
  destination.pathname = pathname;
  destination.search = url.search;
  // HTTP requests do not contain fragments; browsers preserve them on redirects.
  return new Response(null, {
    status,
    headers: {
      Location: destination.href,
      ...(status === 302 ? { 'Cache-Control': 'no-store' } : {}),
    },
  });
}

export default {
  async fetch(request: Request, env: SiteEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/api' || path.startsWith('/api/')) {
      return Response.json({ error: { code: 'not_found', message: 'The game API is hosted at https://beta.berigame.com.' } }, { status: 404 });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    // Only the beta's icon paths route here. Never serve the site bundle as a game fallback.
    if (url.hostname === 'beta.berigame.com') {
      if (!BRAND_ASSETS.has(path)) return new Response(null, { status: 404 });
      const asset = await env.ASSETS.fetch(request);
      if (asset.headers.get('Content-Type')?.includes('text/html')) return new Response(null, { status: 404 });
      const headers = new Headers(asset.headers);
      headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
      return new Response(request.method === 'HEAD' || asset.status === 304 ? null : asset.body, { status: asset.status, headers });
    }

    if (path === '/play' || (url.hostname === 'berigame.com' && path === '/' && url.searchParams.has('join'))) {
      return redirect(url, GAME_ORIGIN, '/', 302);
    }
    if (path === '/agent' || path === '/agent.md') {
      return redirect(url, GAME_ORIGIN, path, 302);
    }
    if (path === '/docs' || path.startsWith('/docs/')) {
      return redirect(url, WIKI_ORIGIN, path.slice('/docs'.length) || '/', 308);
    }

    if (wikiDocumentType(path)) return wikiDocument(request, env, path, false);
    if (path.startsWith('/wiki/')) {
      return new Response(request.method === 'HEAD' ? null : 'Wiki document not found.\n', {
        status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
      });
    }
    const documentPath = wikiPageDocument(path, url.hostname);
    if (documentPath && prefersMarkdown(request.headers.get('Accept'))) {
      return wikiDocument(request, env, documentPath, true);
    }
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    headers.append('Link', wikiDiscoveryLinks(documentPath));
    if (documentPath) headers.append('Vary', 'Accept');
    return new Response(request.method === 'HEAD' ? null : asset.body, { status: asset.status, headers });
  },
};
