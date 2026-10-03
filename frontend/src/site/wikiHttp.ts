/** Shared by the public Worker and Vite development server. */
export function wikiDocumentType(path: string): string | null {
  if (/^\/wiki\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(path)) return 'text/markdown; charset=utf-8';
  if (['/llms.txt', '/llms-full.txt', '/robots.txt'].includes(path)) return 'text/plain; charset=utf-8';
  if (path === '/wiki-index.json') return 'application/json; charset=utf-8';
  if (path === '/sitemap.xml') return 'application/xml; charset=utf-8';
  return null;
}

export function prefersMarkdown(accept: string | null): boolean {
  const types = (accept ?? '').toLowerCase().split(',').map(entry => {
    const [type, ...parameters] = entry.trim().split(';');
    const quality = parameters.map(parameter => parameter.trim()).find(parameter => parameter.startsWith('q='));
    const q = quality === undefined ? 1 : Number(quality.slice(2));
    return { type: type.trim(), q: Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0 };
  });
  const markdown = Math.max(0, ...types.filter(entry => entry.type === 'text/markdown').map(entry => entry.q));
  const html = Math.max(0, ...types.filter(entry => ['text/html', 'application/xhtml+xml'].includes(entry.type)).map(entry => entry.q));
  return markdown > 0 && markdown >= html;
}

export function wikiPageDocument(path: string, hostname: string): string | null {
  if (/%(?:2f|5c)/i.test(path)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(path).replace(/\/+$/, '') || '/'; }
  catch { return null; }
  if (decoded === '/docs' || (hostname === 'wiki.berigame.com' && decoded === '/')) return '/llms.txt';
  const match = /^\/docs\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(decoded)
    ?? (hostname === 'wiki.berigame.com' ? /^\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(decoded) : null);
  return match ? `/wiki/${match[1]}.md` : null;
}

export function wikiDiscoveryLinks(documentPath: string | null = null): string {
  return [
    '</llms.txt>; rel="describedby"; type="text/plain"',
    '</wiki-index.json>; rel="describedby"; type="application/json"',
    ...(documentPath ? [`<${documentPath}>; rel="alternate"; type="${documentPath.endsWith('.md') ? 'text/markdown' : 'text/plain'}"`] : []),
  ].join(', ');
}
