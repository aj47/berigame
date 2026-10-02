const MAIN_HOST = 'berigame.com';
const WIKI_HOST = 'wiki.berigame.com';
const GAME_HOST = 'beta.berigame.com';

export const currentHostname = () => typeof window === 'undefined' ? '' : window.location.hostname;
export const isProductionHost = (hostname: string) => [MAIN_HOST, `www.${MAIN_HOST}`, WIKI_HOST, GAME_HOST].includes(hostname.toLowerCase());
export const isWikiHost = (hostname: string) => hostname.toLowerCase() === WIKI_HOST;
export const isGameHost = (hostname: string) => hostname.toLowerCase() === GAME_HOST;

function hostedUrl(hostname: string, target: string, path: string, localPath: string): string {
  if (!isProductionHost(hostname)) return localPath;
  return hostname.toLowerCase() === target ? path : `https://${target}${path}`;
}

/** Local previews keep all pages together; public domains use their own roots. */
export function homeUrl(fragment = '', hostname = currentHostname()): string {
  return hostedUrl(hostname, MAIN_HOST, `/${fragment}`, `/${fragment}`);
}

/** Accepts a wiki slug, optionally followed by a query or section fragment. */
export function wikiUrl(article = '', hostname = currentHostname()): string {
  const suffix = article.replace(/^\/+/, '');
  const localPath = `/docs${suffix ? `${/^[?#]/.test(suffix) ? '' : '/'}${suffix}` : ''}`;
  return hostedUrl(hostname, WIKI_HOST, `/${suffix}`, localPath);
}

export function gameUrl(hostname = currentHostname()): string {
  return hostedUrl(hostname, GAME_HOST, '/', '/play');
}

export function agentUrl(hostname = currentHostname()): string {
  return hostedUrl(hostname, GAME_HOST, '/agent', '/agent');
}
