import { describe, expect, it } from 'vitest'
import { articles } from '../site/wikiContent'
import type { WikiArticle } from '../site/wikiContent'
import { escapePattern, searchArticles } from '../site/wikiSearch'

const article = (slug: string, title: string, sections: WikiArticle['sections'] = []): WikiArticle => ({
  slug, title, category: 'Test category', summary: 'A useful summary.', lead: 'An introductory explanation.', sections, related: [], sourceFiles: [],
})

describe('wiki search', () => {
  it('ranks every real item page ahead of guide references to that item', () => {
    const items = articles.filter(entry => entry.itemId)
    expect(items).toHaveLength(11)
    for (const item of items) {
      const results = searchArticles(articles, `  ${item.title.toUpperCase()}  `)
      expect(results[0].article.slug).toBe(item.slug)
      expect(results[0].snippet.length).toBeGreaterThan(10)
    }
  })

  it('ranks title matches before section headings and headings before body mentions', () => {
    const results = searchArticles([
      article('body', 'Apple', [{ id: 'a', title: 'Cooking', paragraphs: ['Prepare a stone club.'] }]),
      article('heading', 'Banana', [{ id: 'a', title: 'Your stone club', paragraphs: ['Prepare a weapon.'] }]),
      article('title', 'Stone Club reference'),
    ], 'stone club')
    expect(results.map(result => result.article.slug)).toEqual(['title', 'heading', 'body'])
  })

  it('requires every query word and searches reference table cells', () => {
    const matches = searchArticles(articles, 'driftwood flint')
    expect(matches.some(result => result.article.slug === 'crafting')).toBe(true)
    expect(searchArticles(articles, 'driftwood nonexistentmaterial')).toEqual([])
    const tables = [article('recipe', 'Recipe guide', [{ id: 'recipes', title: 'Recipes', table: { headers: ['Ingredients'], rows: [['1 Driftwood + 2 Flint Shard']] } }])]
    expect(searchArticles(tables, 'flint   driftwood')[0].snippet).toBe('1 Driftwood + 2 Flint Shard')
  })

  it('keeps a meaningful summary for category-only matches', () => {
    const result = searchArticles([article('topic', 'Topic')], 'test category')[0]
    expect(result.snippet).toBe('A useful summary.')
  })

  it('keeps late matching text in a short excerpt', () => {
    const paragraph = `${'A long explanation about gathering resources. '.repeat(12)}Obsidian is gathered in the Boulders. ${'More useful details. '.repeat(12)}`
    const result = searchArticles([article('late', 'Materials', [{ id: 'details', title: 'Details', paragraphs: [paragraph] }])], 'obsidian')[0]
    expect(result.snippet).toContain('Obsidian is gathered')
    expect(result.snippet).toMatch(/^….*…$/)
    expect(result.snippet.length).toBeLessThanOrEqual(237)
  })

  it('links specific answers to the best matching section and keeps the excerpt there', () => {
    const entry = article('survival', 'Survival guide', [
      { id: 'overview', title: 'Overview', paragraphs: ['Food timing is explained later in this guide.'] },
      { id: 'food-timing', title: 'Food timing', paragraphs: ['Wait for your next eating window.'] },
    ])
    const result = searchArticles([entry], 'food timing')[0]
    expect(result.sectionId).toBe('food-timing')
    expect(result.sectionTitle).toBe('Food timing')
    expect(result.snippet).toBe('Wait for your next eating window.')
    const tableResult = searchArticles(articles, 'driftwood flint').find(result => result.article.slug === 'crafting')
    expect(tableResult?.sectionId).toBe('recipe-table')
    expect(tableResult?.snippet).toContain('Driftwood')
  })

  it('keeps title and distributed matches at the top of the article', () => {
    const entry = article('gathering', 'Gathering resources', [
      { id: 'wood', title: 'Driftwood', paragraphs: ['Coast resources.'] },
      { id: 'stone', title: 'Flint', paragraphs: ['Tide rocks.'] },
    ])
    expect(searchArticles([entry], 'gathering')[0].sectionId).toBeUndefined()
    expect(searchArticles([entry], 'driftwood flint')[0].sectionId).toBeUndefined()
    expect(searchArticles(articles, 'Stone Club')[0].sectionId).toBeUndefined()
  })

  it('treats punctuation as literal text and handles blank or missing queries', () => {
    for (const query of ['[', '.*', '(', '\\', 'a+b', '$5', '<script>']) {
      expect(new RegExp(escapePattern(query)).test(query)).toBe(true)
      expect(() => searchArticles(articles, query)).not.toThrow()
    }
    expect(searchArticles(articles, '   ')).toEqual([])
    expect(searchArticles(articles, 'not-an-item-at-all')).toEqual([])
  })
})
