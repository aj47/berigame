import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

export async function loadWikiDocuments(server) {
  const [{ wikiDocuments }, { articles }] = await Promise.all([
    server.ssrLoadModule('/src/site/wikiExports.ts'),
    server.ssrLoadModule('/src/site/wikiContent.ts'),
  ]);
  let baseCommit = null;
  let workingTreeDirty = null;
  try {
    baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    workingTreeDirty = !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* Source archives can build without a Git checkout. */ }
  return wikiDocuments({
    generatedAt: new Date().toISOString(),
    contentHash: createHash('sha256').update(JSON.stringify(articles)).digest('hex'),
    baseCommit,
    workingTreeDirty,
  });
}

export function wikiAssets() {
  return {
    name: 'wiki-documents',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const { wikiDocumentType, wikiPageDocument, prefersMarkdown, wikiDiscoveryLinks } = await server.ssrLoadModule('/src/site/wikiHttp.ts');
          const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
          const path = url.pathname.replace(/\/+$/, '') || '/';
          const pageDocument = wikiPageDocument(path, url.hostname);
          res.setHeader('Link', wikiDiscoveryLinks(pageDocument));
          if (pageDocument) res.setHeader('Vary', 'Accept');
          const documentPath = wikiDocumentType(path) ? path : pageDocument && prefersMarkdown(req.headers.accept) ? pageDocument : null;
          if (!documentPath && !path.startsWith('/wiki/')) return next();
          if (!['GET', 'HEAD'].includes(req.method)) {
            res.writeHead(405, { Allow: 'GET, HEAD' });
            return res.end();
          }
          const document = documentPath ? (await loadWikiDocuments(server)).get(documentPath) : undefined;
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Content-Type', document?.contentType ?? 'text/plain; charset=utf-8');
          res.statusCode = document ? 200 : 404;
          if (document && documentPath !== path) res.setHeader('Content-Location', documentPath);
          res.end(req.method === 'HEAD' ? undefined : document?.body ?? 'Wiki document not found.\n');
        } catch (error) { next(error); }
      });
    },
  };
}
