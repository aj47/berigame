/** Public website and wiki. The existing beta Worker continues to own the game. */
interface SiteEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const WIKI_ORIGIN = 'https://wiki.berigame.com';
const GAME_ORIGIN = 'https://beta.berigame.com';

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

    if (path === '/play' || (url.hostname === 'berigame.com' && path === '/' && url.searchParams.has('join'))) {
      return redirect(url, GAME_ORIGIN, '/', 302);
    }
    if (path === '/agent' || path === '/agent.md') {
      return redirect(url, GAME_ORIGIN, path, 302);
    }
    if (path === '/docs' || path.startsWith('/docs/')) {
      return redirect(url, WIKI_ORIGIN, path.slice('/docs'.length) || '/', 308);
    }

    return env.ASSETS.fetch(request);
  },
};
