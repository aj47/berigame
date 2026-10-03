import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { loadWikiDocuments } from './wiki-assets.mjs';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root: frontend, server: { middlewareMode: true, watch: null, hmr: false }, logLevel: 'error' });
try {
  const documents = await loadWikiDocuments(server);
  for (const [url, document] of documents) {
    const destination = path.join(frontend, 'dist', url.slice(1));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, document.body);
  }
  console.log(`Generated ${documents.size} wiki documents from the shared article source.`);
} finally {
  await server.close();
}
