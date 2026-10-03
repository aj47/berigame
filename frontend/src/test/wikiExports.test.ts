import { describe, expect, it } from 'vitest';
import { ITEM_DEFS } from '@sim';
import { articles } from '../site/wikiContent';
import type { WikiArticle } from '../site/wikiContent';
import { articleMarkdown, wikiDocuments } from '../site/wikiExports';
import type { WikiBuildInfo } from '../site/wikiExports';

const build: WikiBuildInfo = {
  generatedAt: '2026-10-03T12:00:00.000Z',
  contentHash: 'a'.repeat(64),
  baseCommit: 'b'.repeat(40),
  workingTreeDirty: true,
};

const documents = wikiDocuments(build);
const index = JSON.parse(documents.get('/wiki-index.json')!.body);

describe('wiki exports', () => {
  it('makes every indexed article and section available without browser rendering', () => {
    expect(index.articles).toHaveLength(articles.length);
    expect(new Set(index.articles.map((article: { slug: string }) => article.slug)).size).toBe(articles.length);
    for (const article of articles) {
      const entry = index.articles.find((candidate: { slug: string }) => candidate.slug === article.slug);
      const url = new URL(entry.markdownUrl);
      expect(url.origin).toBe('https://wiki.berigame.com');
      expect(entry.url).toBe(`https://wiki.berigame.com/${article.slug}`);
      expect(entry.summary).toBe(article.summary);
      expect(entry.sourceFiles).toEqual(article.sourceFiles);
      expect(entry.related).toEqual(article.related);
      expect(entry.sections).toHaveLength(article.sections.length);
      const document = documents.get(url.pathname);
      expect(document?.contentType).toBe('text/markdown; charset=utf-8');
      expect(document?.body).toContain(`Canonical page: ${entry.url}`);
      for (const section of article.sections) {
        const sectionUrl = `${entry.url}#${section.id}`;
        expect(entry.sections).toContainEqual({ id: section.id, title: section.title, url: sectionUrl });
        expect(document?.body).toContain(`Section: ${sectionUrl}`);
      }
      for (const related of entry.related) {
        expect(documents.has(`/wiki/${related}.md`)).toBe(true);
        expect(document?.body).toContain(`](https://wiki.berigame.com/wiki/${related}.md)`);
      }
    }
  });

  it('includes every current inventory item with its machine-readable item ID', () => {
    const items = index.articles.filter((article: { itemId?: string }) => article.itemId);
    expect(items.map((article: { itemId: string }) => article.itemId).sort()).toEqual(Object.keys(ITEM_DEFS).sort());
    for (const item of items) {
      const markdown = documents.get(new URL(item.markdownUrl).pathname)!.body;
      expect(markdown).toContain(`Item ID: \`${item.itemId}\``);
    }
  });

  it('links the directory to every article and includes full article bodies in the complete export', () => {
    const directory = documents.get('/llms.txt')!;
    const complete = documents.get('/llms-full.txt')!;
    expect(directory.contentType).toBe('text/plain; charset=utf-8');
    expect(complete.contentType).toBe('text/plain; charset=utf-8');
    for (const article of index.articles) {
      expect(directory.body).toContain(`](${article.markdownUrl})`);
      expect(complete.body).toContain(documents.get(new URL(article.markdownUrl).pathname)!.body);
    }
    expect(directory.body).toContain('https://beta.berigame.com/api/agent/v1/openapi.json');
    expect(directory.body).toContain('https://beta.berigame.com/api/agent/v1');
    expect(directory.body).toContain('https://beta.berigame.com/agent.md');
  });

  it('preserves build provenance and distinguishes documentation from live world state', () => {
    expect(index.schemaVersion).toBe(1);
    expect(index).toMatchObject(build);
    expect(index.authority).toContain('do not confirm which features are enabled in a running world');
    expect(index.authority).toContain('authenticated state');
    expect(documents.get('/llms-full.txt')!.body).toContain(`Wiki content hash: ${build.contentHash}`);
    const archive = JSON.parse(wikiDocuments({ ...build, baseCommit: null, workingTreeDirty: null }).get('/wiki-index.json')!.body);
    expect(archive.baseCommit).toBeNull();
    expect(archive.workingTreeDirty).toBeNull();
  });

  it('exports literal punctuation and multiline table cells without changing document structure', () => {
    const fixture: WikiArticle = {
      slug: 'export-fixture',
      title: 'A [reference] *guide*',
      category: 'Technical',
      summary: 'Read <script> as text, with `literal` markers.',
      lead: 'A path C:\\island and a [label](https://example.com).',
      facts: [{ label: 'A | B', value: 'One\nTwo' }],
      sections: [{
        id: 'safe-table',
        title: 'Values and syntax',
        paragraphs: ['Keep *stars* and _underscores_.'],
        bullets: ['Inspect [inventory] first.'],
        table: {
          headers: ['Meaning | value', 'Details'],
          rows: [['first | second\nthird\\fourth', '<tag> [value]']],
        },
      }],
      related: ['crafting'],
      sourceFiles: ['shared/sim/items.ts'],
    };
    const markdown = articleMarkdown(fixture, build);
    expect(markdown).toContain(String.raw`# A \[reference\] \*guide\*`);
    expect(markdown).toContain(String.raw`Read \<script\> as text, with \`literal\` markers.`);
    expect(markdown).not.toContain('<script>');
    expect(markdown).toContain(String.raw`A path C:\\island and a \[label\](https://example.com).`);
    expect(markdown).toContain(String.raw`| A \| B | One<br>Two |`);
    expect(markdown).toContain(String.raw`| Meaning \| value | Details |`);
    expect(markdown).toContain(String.raw`| first \| second<br>third\\fourth | \<tag\> \[value\] |`);
    expect(markdown).toContain(String.raw`- Inspect \[inventory\] first.`);
    expect(markdown).toContain('Section: https://wiki.berigame.com/export-fixture#safe-table');
    expect(markdown).toContain('](https://wiki.berigame.com/wiki/crafting.md)');
    expect(markdown).toContain('- `shared/sim/items.ts`');
  });

  it('publishes a canonical sitemap and discovery policy for all article URLs', () => {
    const sitemap = documents.get('/sitemap.xml')!;
    expect(sitemap.contentType).toBe('application/xml; charset=utf-8');
    const urls = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
    expect(urls).toEqual(['https://wiki.berigame.com/', ...index.articles.map((article: { url: string }) => article.url)]);
    expect(documents.get('/robots.txt')!.body).toContain('Sitemap: https://wiki.berigame.com/sitemap.xml');
  });
});
