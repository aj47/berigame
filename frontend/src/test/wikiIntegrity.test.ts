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

describe('the Long Season article', () => {
  it('lists every tiered node, season recipe and ledger commission from the shared definitions', async () => {
    const { LEDGER_TEMPLATES, SEASON_RECIPES, SEASON_ITEMS, TIER_NODES } = await import('@sim');
    const season = articles.find(article => article.slug === 'the-long-season')!;
    const table = (id: string) => season.sections.find(section => section.id === id)!.table!;
    expect(table('tier-nodes').rows.map(row => [row[0], row[2]])).toEqual(TIER_NODES.map(node => [node.name, String(node.minLevel)]));
    expect(table('recipe-chain').rows.map(row => row[0])).toEqual(SEASON_RECIPES.map(recipe => recipe.name));
    expect(table('island-ledger').rows).toHaveLength(LEDGER_TEMPLATES.length);
    for (const item of SEASON_ITEMS) {
      const page = articles.find(article => article.itemId === item.id)!;
      expect(page.related, item.id).toContain('the-long-season');
      expect(page.lead, item.id).not.toMatch(/settlement expansion/);
    }
  });
});

describe('the Expanse article', () => {
  it('lists every biome, route, place and waystone from expanse.ts', async () => {
    const { BIOMES, CAUSEWAYS, EXPANSE_BRIDGES, EXPANSE_LANDMARKS, RIDGES, WAYSTONES } = await import('../../../shared/sim/expanse');
    const page = articles.find(article => article.slug === 'the-expanse')!;
    const table = (id: string) => page.sections.find(section => section.id === id)!.table!;
    expect(table('biomes').rows.map(row => row[0])).toEqual(Object.values(BIOMES).map(b => b.name));
    const routes = table('routes').rows.map(row => row[0]);
    for (const route of [...CAUSEWAYS, ...EXPANSE_BRIDGES]) expect(routes, route.id).toContain(route.name);
    expect(routes).toHaveLength(CAUSEWAYS.length + EXPANSE_BRIDGES.length + RIDGES.reduce((n, r) => n + r.passes.length, 0));
    expect(table('places').rows).toHaveLength(EXPANSE_LANDMARKS.length);
    expect(table('waystones').rows.map(row => row[0])).toEqual(WAYSTONES.map(w => w.name));
    // Every tier node is counted in exactly one biome.
    const counted = table('biomes').rows.flatMap(row => [...row[3].matchAll(/× (\d+)/g)].map(m => Number(m[1]))).reduce((a, b) => a + b, 0);
    const { TIER_NODE_SEEDS } = await import('@sim');
    expect(counted).toBe(TIER_NODE_SEEDS.length);
  });
});
