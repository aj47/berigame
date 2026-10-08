import { isGameHost, isProductionHost, isWikiHost } from './siteUrls';

export type SiteRoute =
  | { kind: 'landing' }
  | { kind: 'game' }
  | { kind: 'agent' }
  | { kind: 'admin' }
  | { kind: 'wiki'; slug?: string }
  | { kind: 'not-found' };

/** Resolve entry pages without importing the game or consuming its invite query. */
export function resolveSiteRoute(pathname: string, search = '', hostname = ''): SiteRoute {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') {
    if (isWikiHost(hostname)) return { kind: 'wiki' };
    // Existing shared invitations used /?join=CODE before the landing page existed.
    return { kind: isGameHost(hostname) || new URLSearchParams(search).has('join') ? 'game' : 'landing' };
  }
  if (path === '/play') return { kind: 'game' };
  if (path === '/agent') return { kind: 'agent' };
  if (path === '/admin') return { kind: 'admin' };
  if (path === '/docs') return { kind: 'wiki' };

  const article = /^\/docs\/([^/]+)$/.exec(path) || (isWikiHost(hostname) ? /^\/([^/]+)$/.exec(path) : null);
  if (article) {
    try {
      const slug = decodeURIComponent(article[1]);
      if (slug && slug !== '.' && slug !== '..' && !/[\\/?#\u0000-\u001f\u007f]/.test(slug)) {
        return { kind: 'wiki', slug };
      }
    } catch {
      // A malformed percent escape should show the missing-page view, not crash.
    }
  }
  return { kind: 'not-found' };
}

/** Fallback for a production asset host that does not apply the edge redirects. */
export function resolveSiteRedirect(pathname: string, search = '', hash = '', hostname = ''): string | null {
  if (!isProductionHost(hostname)) return null;
  const path = pathname.replace(/\/+$/, '') || '/';
  const suffix = `${search}${hash}`;
  if (path === '/docs' || path.startsWith('/docs/')) {
    return `https://wiki.berigame.com${path.slice('/docs'.length) || '/'}${suffix}`;
  }
  if (!isGameHost(hostname)) {
    if (path === '/play') return `https://beta.berigame.com/${suffix}`;
    if (path === '/agent') return `https://beta.berigame.com/agent${suffix}`;
    // The admin API lives on the game Worker only.
    if (path === '/admin') return `https://beta.berigame.com/admin${suffix}`;
    if (!isWikiHost(hostname) && path === '/' && new URLSearchParams(search).has('join')) {
      return `https://beta.berigame.com/${suffix}`;
    }
  }
  return null;
}
