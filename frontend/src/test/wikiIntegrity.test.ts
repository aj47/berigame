import { describe, expect, it } from 'vitest';
import { ITEM_DEFS } from '@sim';
import { articles } from '../site/wikiContent';

describe('wiki content integrity', () => {
  it('provides one dedicated article for every current inventory item', () => {
    const documentedItems = articles.filter(article => article.itemId).map(article => article.itemId);
    expect(documentedItems.sort()).toEqual(Object.keys(ITEM_DEFS).sort());
  });

  it('keeps article URLs, related links and section anchors resolvable', () => {
    const slugs = new Set(articles.map(article => article.slug));
    expect(slugs.size).toBe(articles.length);
    for (const article of articles) {
      expect(article.slug, article.title).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      for (const related of article.related) {
        expect(slugs.has(related), `${article.slug} links to missing article ${related}`).toBe(true);
      }
      const anchors = article.sections.map(section => section.id);
      expect(new Set(anchors).size, `${article.slug} has duplicate section anchors`).toBe(anchors.length);
    }
  });

  it('keeps reference-table values aligned with their column headings', () => {
    for (const article of articles) {
      for (const section of article.sections) {
        if (!section.table) continue;
        expect(section.table.headers.length, `${article.slug}/${section.id} has no headings`).toBeGreaterThan(0);
        for (const row of section.table.rows) {
          expect(row.length, `${article.slug}/${section.id} has an unaligned row`).toBe(section.table.headers.length);
        }
      }
    }
  });
});
