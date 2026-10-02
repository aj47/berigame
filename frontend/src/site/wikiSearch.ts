import type { WikiArticle, WikiSection } from './wikiContent'

export const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const sectionParts = (section: WikiSection) => [
  section.title, ...(section.paragraphs || []), ...(section.bullets || []),
  ...(section.table?.rows.map(row => row.join(' · ')) || []), ...(section.table?.headers || []),
]

const searchableParts = (article: WikiArticle) => [
  article.summary, article.lead,
  ...(article.facts || []).map(fact => `${fact.label}: ${fact.value}`),
  ...article.sections.flatMap(sectionParts),
]

export function searchArticles(articles: WikiArticle[], query: string) {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!normalized) return []
  const words = normalized.split(' ')
  return articles.flatMap(article => {
    const parts = searchableParts(article)
    const title = article.title.toLowerCase()
    const headings = article.sections.map(section => section.title.toLowerCase())
    const content = [title, article.category, ...parts].join(' ').toLowerCase()
    if (!words.every(word => content.includes(word))) return []
    // Each tier is larger than all the tiers below it, keeping exact item
    // names ahead of articles that merely mention them in a reference table.
    const score = (title === normalized ? 10000 : 0)
      + (title.startsWith(normalized) ? 2000 : 0)
      + (title.includes(normalized) ? 1000 : 0)
      + (words.every(word => title.includes(word)) ? 500 : 0)
      + (headings.some(heading => heading.includes(normalized)) ? 200 : 0)
      + (headings.some(heading => words.every(word => heading.includes(word))) ? 100 : 0)
      + (article.summary.toLowerCase().includes(normalized) ? 40 : 0)
    // Broad title searches open the whole article. Specific questions found
    // within a section land beside the answer, including reference-table rows.
    const section = words.every(word => title.includes(word)) ? undefined : article.sections
      .map(entry => {
        const heading = entry.title.toLowerCase()
        const values = sectionParts(entry).map(part => part.toLowerCase())
        const allTerms = words.every(word => values.some(value => value.includes(word)))
        const relevance = !allTerms ? 0
          : heading === normalized ? 5
          : heading.includes(normalized) ? 4
          : words.every(word => heading.includes(word)) ? 3
          : values.some(value => value.includes(normalized)) ? 2 : 1
        return { entry, relevance }
      })
      .filter(candidate => candidate.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)[0]?.entry
    const contextParts = section ? sectionParts(section).slice(1) : parts
    const context = contextParts.find(part => part.toLowerCase().includes(normalized))
      || contextParts.find(part => words.every(word => part.toLowerCase().includes(word)))
      || contextParts.find(part => words.some(word => part.toLowerCase().includes(word)))
      || contextParts[0] || article.summary
    const exactIndex = context.toLowerCase().indexOf(normalized)
    const wordIndices = words.map(word => context.toLowerCase().indexOf(word)).filter(index => index >= 0)
    const matchIndex = exactIndex >= 0 ? exactIndex : wordIndices.length ? Math.min(...wordIndices) : 0
    let start = Math.max(0, matchIndex - 65)
    if (start) start = context.lastIndexOf(' ', start) + 1
    let end = Math.min(context.length, start + 235)
    if (end < context.length) end = context.lastIndexOf(' ', end)
    const snippet = `${start ? '…' : ''}${context.slice(start, end)}${end < context.length ? '…' : ''}`
    return [{ article, score, snippet, sectionId: section?.id, sectionTitle: section?.title }]
  }).sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title))
}
