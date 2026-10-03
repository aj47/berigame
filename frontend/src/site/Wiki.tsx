import { homeUrl, wikiResourceUrl, wikiUrl } from './siteUrls';
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ITEM_DEFS } from '@sim'
import { articles } from './wikiContent'
import { latestUpdate } from './changelog'
import type { WikiArticle } from './wikiContent'
import { escapePattern, searchArticles } from './wikiSearch'
import { useHashAnchor } from './useHashAnchor'
import { useArticleNavigation } from './useArticleNavigation'
import RecipePlanner from './RecipePlanner'
import WikiDocumentLink from './WikiDocumentLink'
import { BerryMark } from './SiteIcons'
import './wiki.css'
import './wikiReading.css'

function BookIcon({ size = 22 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 6.2C8.8 3.9 5.5 3.8 2.5 4.7v14c3-.9 6.3-.8 9.5 1.5 3.2-2.3 6.5-2.4 9.5-1.5v-14c-3-.9-6.3-.8-9.5 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M12 6.2v14M5.7 8.5c1.1-.1 2.2.1 3.3.6m-3.3 3c1.1-.1 2.2.1 3.3.6m6-3.6c1.1-.5 2.2-.7 3.3-.6M15 12.7c1.1-.5 2.2-.7 3.3-.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
}
function SearchIcon() {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.6"/><path d="m15.5 15.5 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
}
function ArrowIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
}

function LinkIcon({ copied = false }: { copied?: boolean }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">{copied ? <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : <><path d="m10 13 4-4m-6 6-1 1a4.2 4.2 0 0 1-6-6l4-4a4.2 4.2 0 0 1 6 0m2 5 1-1a4.2 4.2 0 0 1 6 6l-4 4a4.2 4.2 0 0 1-6 0" transform="translate(1 1)" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></>}</svg>
}

const articleHref = (slug: string) => wikiUrl(encodeURIComponent(slug))
const itemDefinitions = Object.values(ITEM_DEFS)
const topicLinks = [
  { slug: 'getting-started', title: 'Getting started', description: 'Your first five minutes', icon: '/items/blueberry.png' },
  { slug: 'crafting', title: 'Crafting & recipes', description: 'Ingredients, levels & XP', icon: '/items/flint_knife.png' },
  { slug: 'giant-raids', title: 'Giant raids', description: 'Prepare for the Boulders', icon: '/items/stone_club.png' },
  { slug: 'techniques', title: 'Techniques', description: 'Build your three-slot loadout', icon: '/items/driftwood_crown.png' },
]
const categoryIcons: Record<string, string> = {
  Essentials: '/items/blueberry.png', World: '/items/driftwood.png',
  'Skills & activities': '/items/greenberry.png', 'Items & equipment': '/items/flint_knife.png',
  Combat: '/items/stone_club.png', Community: '/items/goldberry.png',
}
const linkTargets = new Map(articles.map(article => [article.title.toLowerCase(), article]))
const linkPattern = new RegExp(`\\b(${[...linkTargets.keys()].sort((a, b) => b.length - a.length).map(escapePattern).join('|')})\\b`, 'gi')

/** Text is rendered as React nodes, including user-supplied search terms. */
function Highlight({ text, query }: { text: string; query: string }) {
  const words = [...new Set(query.trim().split(/\s+/).filter(Boolean))].sort((a, b) => b.length - a.length)
  if (!words.length) return <>{text}</>
  const pattern = new RegExp(`(${words.map(escapePattern).join('|')})`, 'gi')
  return <>{text.split(pattern).map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : part)}</>
}
function LinkedText({ text, currentSlug, withIcon = false }: { text: string; currentSlug: string; withIcon?: boolean }) {
  if (currentSlug === 'changelog') return <>{text}</>
  return <>{text.split(linkPattern).map((part, index) => {
    const target = index % 2 ? linkTargets.get(part.toLowerCase()) : undefined
    return target && target.slug !== currentSlug
      ? <a className={`wiki-inline-link${withIcon && target.icon ? ' wiki-item-link' : ''}`} href={articleHref(target.slug)} key={index}>{withIcon && target.icon && <img src={target.icon} alt="" loading="lazy" width="24" height="24" />}{part}</a>
      : part
  })}</>
}
function ArticleCard({ article, compact = false }: { article: WikiArticle; compact?: boolean }) {
  return <a className={`wiki-article-card${compact ? ' wiki-article-card-compact' : ''}`} href={articleHref(article.slug)}>
    <span className="wiki-card-heading">{article.icon && <img className="wiki-card-item-icon" src={article.icon} alt="" width="32" height="32" loading="lazy" />}<span>{article.title}</span><ArrowIcon /></span>
    <span className="wiki-card-summary">{article.summary}</span>
  </a>
}

export default function Wiki({ slug }: { slug?: string }) {
  const [query, setQuery] = useState(() => typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('q') || '')
  const [menuOpen, setMenuOpen] = useState(false)
  const [itemFilter, setItemFilter] = useState('All items')
  const primarySearch = useRef<HTMLInputElement>(null)
  const menuToggle = useRef<HTMLButtonElement>(null)
  const normalizedQuery = query.trim().toLowerCase()
  useHashAnchor(normalizedQuery ? 'search' : slug || 'wiki-home')
  const article = slug ? articles.find(item => item.slug === slug) : undefined
  const articleHeadings = useMemo(() => article ? [...(article.slug === 'crafting' ? [{ id: 'recipe-planner', title: 'Plan your supplies' }] : []), ...article.sections.map(({ id, title }) => ({ id, title }))] : [], [article])
  const reading = useArticleNavigation(normalizedQuery ? 'search' : article?.slug || '', articleHeadings)
  const readingMinutes = article ? Math.max(1, Math.ceil([article.summary, article.lead, ...article.sections.flatMap(section => [section.title, ...(section.paragraphs || []), ...(section.bullets || []), ...(section.table?.rows.flat() || [])])].join(' ').split(/\s+/).length / 200)) : 0
  const guides = useMemo(() => articles.filter(item => !item.itemId), [])
  const itemArticles = useMemo(() => articles.filter(item => item.itemId), [])
  const categories = useMemo(() => Array.from(new Set(guides.map(item => item.category))), [guides])
  const results = useMemo(() => searchArticles(articles, normalizedQuery), [normalizedQuery])
  const tableCount = articles.reduce((count, entry) => count + entry.sections.filter(section => section.table).length, 0)
  const visibleItems = itemDefinitions.filter(item => itemFilter === 'All items'
    || (itemFilter === 'Food' && item.healthRestore > 0)
    || (itemFilter === 'Weapons' && item.weaponDamage > 0)
    || (itemFilter === 'Materials' && !item.healthRestore && !item.weaponDamage))

  function updateQuery(value: string) {
    setQuery(value)
    const url = new URL(window.location.href)
    if (value.trim()) url.searchParams.set('q', value)
    else url.searchParams.delete('q')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !target?.closest('input, textarea, select, [contenteditable]')) {
        event.preventDefault()
        primarySearch.current?.focus()
      }
      if (event.key === 'Escape' && menuOpen) {
        setMenuOpen(false)
        menuToggle.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])
  useEffect(() => {
    document.title = `${normalizedQuery ? 'Search the wiki' : article?.title || (slug ? 'Page not found' : 'Wiki')} · BeriGame`
  }, [article, slug, normalizedQuery])

  return <div className={`wiki-page${!slug ? ' wiki-home-page' : ''}`}>
    <a className="wiki-skip-link" href="#wiki-content">Skip wiki navigation</a>
    <div className="wiki-mobile-bar">
      <a href={wikiUrl()} className="wiki-mobile-title"><BerryMark size={26} />BeriGame Wiki</a>
      <button ref={menuToggle} className="wiki-menu-toggle" type="button" aria-expanded={menuOpen} aria-controls="wiki-navigation" onClick={() => setMenuOpen(!menuOpen)}>
        {menuOpen ? 'Close menu' : 'Browse wiki'}<span aria-hidden="true">{menuOpen ? '×' : '☰'}</span>
      </button>
    </div>
    <div className="wiki-layout">
      <aside className={`wiki-sidebar${menuOpen ? ' wiki-sidebar-open' : ''}`} id="wiki-navigation" aria-label="Wiki navigation">
        <a className="wiki-sidebar-brand" href={wikiUrl()}><span className="wiki-brand-icon"><BerryMark size={32} /></span><span>BeriGame Wiki<small>The island encyclopedia</small></span></a>
        <nav aria-label="Wiki articles">
          <a href={wikiUrl()} className={`wiki-nav-home${!slug && !normalizedQuery ? ' wiki-nav-current' : ''}`} aria-current={!slug && !normalizedQuery ? 'page' : undefined}>Wiki home<ArrowIcon /></a>
          <div className="wiki-nav-group wiki-nav-agents">
            <h2>For agents</h2>
            <WikiDocumentLink href={wikiResourceUrl('llms.txt')} title="llms.txt">Start here · llms.txt</WikiDocumentLink>
            <WikiDocumentLink href={wikiResourceUrl('wiki-index.json')} title="JSON article index">Article index · JSON</WikiDocumentLink>
            <WikiDocumentLink href={wikiResourceUrl('llms-full.txt')} title="Complete wiki">Full wiki · Markdown</WikiDocumentLink>
          </div>
          {categories.map(category => <div className="wiki-nav-group" key={category}>
            <h2>{category}</h2>
            {guides.filter(item => item.category === category).map(item => <a key={item.slug} href={articleHref(item.slug)} className={item.slug === slug && !normalizedQuery ? 'wiki-nav-current' : undefined} aria-current={item.slug === slug && !normalizedQuery ? 'page' : undefined}>{item.title}</a>)}
          </div>)}
          {!!itemArticles.length && <details className="wiki-nav-items" open={article?.itemId ? true : undefined}><summary>Item encyclopedia <span>{itemArticles.length}</span></summary><div className="wiki-nav-group">{itemArticles.map(item => <a key={item.slug} href={articleHref(item.slug)} className={item.slug === slug && !normalizedQuery ? 'wiki-nav-current' : undefined} aria-current={item.slug === slug && !normalizedQuery ? 'page' : undefined}><img src={item.icon} width="23" height="23" alt="" loading="lazy" />{item.title}</a>)}</div></details>}
        </nav>
        <div className="wiki-sidebar-note"><BookIcon size={17} /><span>{articles.length} articles · {tableCount} reference tables</span><p>Game rules, recipes and numbers for your next adventure.</p></div>
      </aside>

      <main className="wiki-main" id="wiki-content" tabIndex={-1}>
        <div className="wiki-toolbar">
          <nav className="wiki-breadcrumbs" aria-label="Breadcrumb"><a href={homeUrl()}>BeriGame</a><span aria-hidden="true">/</span>{slug || normalizedQuery ? <><a href={wikiUrl()}>Wiki</a><span aria-hidden="true">/</span><span>{normalizedQuery ? 'Search' : article?.title || 'Page not found'}</span></> : <span>Wiki home</span>}</nav>
          <form className="wiki-search" role="search" onSubmit={event => event.preventDefault()}>
            <SearchIcon /><input ref={primarySearch} id="wiki-search-input" value={query} onChange={event => updateQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && query) { event.preventDefault(); updateQuery('') } }} placeholder="Search items, recipes, skills, places…" aria-label="Search all wiki articles" aria-controls={normalizedQuery ? 'wiki-search-results' : undefined} type="search" autoComplete="off" />
            {query ? <button className="wiki-search-clear" type="button" aria-label="Clear search" onClick={() => { updateQuery(''); primarySearch.current?.focus() }}>×</button> : <kbd aria-hidden="true">/</kbd>}
          </form>
        </div>

        {normalizedQuery ? <section className="wiki-search-results" id="wiki-search-results" aria-labelledby="wiki-search-title">
          <div className="wiki-eyebrow">ITEMS, GUIDES & REFERENCE</div>
          <h1 id="wiki-search-title">Search the wiki</h1>
          <p className="wiki-search-count" role="status">{results.length} {results.length === 1 ? 'article' : 'articles'} found for <strong>“{query.trim()}”</strong></p>
          {results.length ? <div className="wiki-result-list">{results.map(({ article: item, snippet, sectionId, sectionTitle }) => <a className="wiki-search-result" key={item.slug} href={`${articleHref(item.slug)}${sectionId ? `#${encodeURIComponent(sectionId)}` : ''}`}>
            <span className="wiki-result-icon">{item.icon ? <img src={item.icon} alt="" width="52" height="52" loading="lazy" /> : <BookIcon size={25} />}</span>
            <span className="wiki-result-copy"><span className="wiki-result-category">{item.category}{item.itemId ? ' · Item reference' : ` · ${item.sections.length} sections`}</span><span className="wiki-result-title"><span><Highlight text={item.title} query={query} /></span><ArrowIcon /></span><span className="wiki-result-snippet"><Highlight text={snippet} query={query} /></span>{sectionTitle && <span className="wiki-result-section">Jump to: {sectionTitle}<ArrowIcon /></span>}</span>
          </a>)}</div> : <div className="wiki-empty"><SearchIcon /><h2>No matching articles.</h2><p>Try an item name such as “Stone Club”, a skill, or a place. Shorter searches can help you find the right guide.</p><button type="button" className="wiki-text-button" onClick={() => updateQuery('')}>Browse the encyclopedia <ArrowIcon /></button></div>}
        </section> : !slug ? <>
          <section className="wiki-welcome" aria-labelledby="wiki-home-title">
            <div className="wiki-eyebrow">THE ISLAND ENCYCLOPEDIA</div>
            <h1 id="wiki-home-title">Know the island.<br /><em>Find your next adventure.</em></h1>
            <p>Every item, every recipe, every route. Your field guide to gathering, growing and going a little further.</p>
            <div className="wiki-welcome-bottom"><span><strong>{guides.length}</strong> in-depth guides</span><span><strong>{itemDefinitions.length}</strong> items</span><span><strong>{tableCount}</strong> reference tables</span></div>
            <div className="wiki-welcome-art" aria-hidden="true"><span className="wiki-art-orbit" /><span className="wiki-art-orbit wiki-art-orbit-two" /><img className="wiki-hero-club" src="/items/stone_club.png" alt="" /><img className="wiki-hero-berry" src="/items/blueberry.png" alt="" /><img className="wiki-hero-gold" src="/items/goldberry.png" alt="" /><span className="wiki-art-star wiki-art-star-one">✦</span><span className="wiki-art-star wiki-art-star-two">✧</span><span className="wiki-art-caption">PACK A LITTLE KNOWLEDGE.</span></div>
          </section>

          <a className="wiki-latest-update" href={`${articleHref('changelog')}#${latestUpdate.id}`}><span className="wiki-update-label">What’s new <time dateTime={latestUpdate.date}>{latestUpdate.period}</time></span><strong>{latestUpdate.title}</strong><span className="wiki-update-link">Read the changelog <ArrowIcon /></span></a>

          <section className="wiki-agent-resources" aria-labelledby="wiki-agents-title">
            <div><h2 id="wiki-agents-title">For agents</h2><p>Read Markdown or JSON generated from this wiki. Use the live API guide and schema for requests, and live game state for current IDs, availability and action results.</p></div>
            <nav aria-label="Agent resources">
              <WikiDocumentLink href={wikiResourceUrl('llms.txt')} title="llms.txt">Start here <ArrowIcon /></WikiDocumentLink>
              <WikiDocumentLink href={wikiResourceUrl('wiki-index.json')} title="JSON article index">JSON index</WikiDocumentLink>
              <WikiDocumentLink href={wikiResourceUrl('llms-full.txt')} title="Complete wiki">Full wiki</WikiDocumentLink>
              <a href="https://beta.berigame.com/agent.md">Live API guide</a>
              <a href="https://beta.berigame.com/api/agent/v1/openapi.json">API schema</a>
            </nav>
          </section>

          <nav className="wiki-quick-links" aria-label="Start exploring">{topicLinks.map(topic => <a href={articleHref(topic.slug)} key={topic.slug}><span className="wiki-topic-icon"><img src={topic.icon} alt="" width="50" height="50" /></span><span><strong>{topic.title}</strong><small>{topic.description}</small></span><ArrowIcon /></a>)}</nav>

          <section className="wiki-item-browser" aria-labelledby="wiki-items-title">
            <div className="wiki-section-heading"><div><span className="wiki-eyebrow">THE THINGS YOU CARRY</span><h2 id="wiki-items-title">Item encyclopedia</h2></div><a className="wiki-section-link" href={wikiUrl('inventory-items#item-table')}>Compare all stats <ArrowIcon /></a></div>
            <div className="wiki-item-browser-tools"><div className="wiki-item-filters" role="group" aria-label="Filter items">{['All items', 'Food', 'Weapons', 'Materials'].map(filter => <button key={filter} type="button" aria-pressed={itemFilter === filter} onClick={() => setItemFilter(filter)}>{filter}</button>)}</div><span className="wiki-item-count" role="status">{visibleItems.length} items</span></div>
            <div className="wiki-item-grid">{visibleItems.map(item => {
              const itemArticle = itemArticles.find(entry => entry.itemId === item.id)
              return <a className="wiki-item-tile" href={itemArticle ? articleHref(itemArticle.slug) : wikiUrl('inventory-items#item-table')} key={item.id}><span className="wiki-item-image"><img src={item.icon} alt="" width="65" height="65" loading="lazy" /></span><strong>{item.name}</strong><span>{item.healthRestore ? `+${item.healthRestore} HP` : item.weaponDamage ? `${item.weaponDamage} damage` : 'Material'}</span></a>
            })}</div>
          </section>

          <section className="wiki-directory" aria-labelledby="wiki-directory-title">
            <div className="wiki-section-heading"><div><span className="wiki-eyebrow">FROM FIRST STEPS TO THE FAR COAST</span><h2 id="wiki-directory-title">Explore the guides</h2></div><span className="wiki-section-meta">{guides.length} guides, organised by topic</span></div>
            <div className="wiki-category-grid">{categories.map((category, index) => <section className="wiki-category" key={category} aria-labelledby={`wiki-category-${index}`}>
              <div className="wiki-category-heading"><span className="wiki-category-icon">{categoryIcons[category] ? <img src={categoryIcons[category]} alt="" width="34" height="34" loading="lazy" /> : <BookIcon size={23} />}</span><h3 id={`wiki-category-${index}`}>{category}</h3><span className="wiki-category-count">{guides.filter(item => item.category === category).length}</span></div>
              {guides.filter(item => item.category === category).map(item => <ArticleCard key={item.slug} article={item} compact />)}
            </section>)}</div>
          </section>
          <div className="wiki-bottom-note"><BookIcon size={23} /><p>Looking for something specific? Search item names, ingredients, skills or places with the <kbd>/</kbd> shortcut.</p><a href="#wiki-content">Back to top ↑</a></div>
        </> : article ? <article className={`wiki-article${article.itemId ? ' wiki-item-article' : ''}${article.slug === 'changelog' ? ' wiki-changelog' : ''}`}>
          <header className="wiki-article-header"><div className="wiki-eyebrow">{article.category} / {article.itemId ? 'ITEM REFERENCE' : article.slug === 'changelog' ? 'ISLAND HISTORY' : 'FIELD GUIDE'}</div><h1>{article.title}</h1><p className="wiki-article-summary">{article.summary}</p><div className="wiki-article-meta"><span><BookIcon size={16} /> {readingMinutes} min read</span><span>{articleHeadings.length} sections</span><div className="wiki-article-tools"><WikiDocumentLink className="wiki-markdown-link" href={wikiResourceUrl(`wiki/${encodeURIComponent(article.slug)}.md`)} title={`${article.title} · Markdown`}>Read Markdown</WikiDocumentLink><button className="wiki-copy-article" type="button" onClick={() => reading.copyLink()}><LinkIcon copied={reading.copiedId === 'article'} />{reading.copiedId === 'article' ? 'Copied!' : 'Copy link'}</button></div></div></header>
          <span className="wiki-copy-status" role="status">{reading.copyMessage}</span>
          <div className="wiki-reading-bar"><label htmlFor="wiki-section-jump"><span>On this page</span><select id="wiki-section-jump" aria-label="Jump to article section" value={reading.activeId} onChange={event => reading.jumpTo(event.target.value)}><option value="">Introduction</option>{articleHeadings.map(section => <option key={section.id} value={section.id}>{section.title}</option>)}</select></label><span className="wiki-reading-percent" aria-hidden="true">{reading.progress}%</span><div className="wiki-reading-track" aria-hidden="true"><span style={{ width: `${reading.progress}%` }} /></div></div>
          <div className="wiki-article-layout">
            <div className="wiki-article-body" ref={reading.bodyRef}><p className="wiki-article-lead" id="article-introduction" tabIndex={-1}><LinkedText text={article.lead} currentSlug={article.slug} /></p>
              {article.slug === 'crafting' && <section className="wiki-content-section wiki-planner-section" id="recipe-planner" aria-labelledby="wiki-heading-recipe-planner"><RecipePlanner /></section>}
              {article.sections.map(section => <section className="wiki-content-section" id={section.id} key={section.id} aria-labelledby={`wiki-heading-${section.id}`}>
                <h2 id={`wiki-heading-${section.id}`} tabIndex={-1}><a href={`#${section.id}`}>{section.title}</a><button className="wiki-copy-section" type="button" aria-label={`Copy link to ${section.title}`} title={reading.copiedId === section.id ? 'Link copied' : 'Copy section link'} onClick={() => reading.copyLink(section.id)}><LinkIcon copied={reading.copiedId === section.id} /></button></h2>
                {section.paragraphs?.map((paragraph, index) => <p key={index}><LinkedText text={paragraph} currentSlug={article.slug} /></p>)}
                {!!section.bullets?.length && <ul>{section.bullets.map((bullet, index) => <li key={index}><LinkedText text={bullet} currentSlug={article.slug} /></li>)}</ul>}
                {section.table && <div className="wiki-table-scroll" role="region" aria-label={`${section.title} table`} tabIndex={0}><table><thead><tr>{section.table.headers.map((header, index) => <th key={index} scope="col">{header}</th>)}</tr></thead><tbody>{section.table.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => cellIndex === 0 ? <th scope="row" key={cellIndex}><LinkedText text={cell} currentSlug={article.slug} withIcon /></th> : <td key={cellIndex}><LinkedText text={cell} currentSlug={article.slug} /></td>)}</tr>)}</tbody></table></div>}
              </section>)}
            </div>
            <aside className="wiki-article-aside" aria-label="Article overview">
              <nav className="wiki-toc" id="article-contents" aria-label="On this page"><div className="wiki-toc-heading"><h2>On this page</h2><span aria-hidden="true">{reading.progress}%</span></div><div className="wiki-reading-track" aria-hidden="true"><span style={{ width: `${reading.progress}%` }} /></div><ol><li><a href="#article-introduction" aria-current={!reading.activeId ? 'location' : undefined}><span aria-hidden="true">—</span>Introduction</a></li>{articleHeadings.map((section, index) => <li key={section.id}><a href={`#${section.id}`} aria-current={reading.activeId === section.id ? 'location' : undefined}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{section.title}</a></li>)}</ol><a className="wiki-toc-top" href="#wiki-content">Back to top ↑</a></nav>
              {!!article.facts?.length && <div className="wiki-infobox"><div className="wiki-infobox-heading">{article.icon ? <h2>{article.title}</h2> : <><BookIcon size={21} /><h2>At a glance</h2></>}</div>{article.icon && <div className="wiki-infobox-illustration"><img src={article.icon} alt={article.title} width="112" height="112" /><span>Item encyclopedia</span></div>}<dl>{article.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd><LinkedText text={fact.value} currentSlug={article.slug} /></dd></div>)}</dl></div>}
            </aside>
          </div>
          {!!article.related?.filter(relatedSlug => articles.some(item => item.slug === relatedSlug)).length && <section className="wiki-related" aria-labelledby="wiki-related-title"><div className="wiki-section-heading"><div><span className="wiki-eyebrow">KEEP EXPLORING</span><h2 id="wiki-related-title">Related articles</h2></div></div><div className="wiki-related-grid">{article.related.map(relatedSlug => articles.find(item => item.slug === relatedSlug)).filter((item): item is WikiArticle => !!item).map(item => <ArticleCard key={item.slug} article={item} />)}</div></section>}
        </article> : <section className="wiki-not-found"><div className="wiki-eyebrow">404 · AN UNCHARTED PATH</div><BookIcon size={56} /><h1>This page is still off the map.</h1><p>We couldn’t find that wiki article. Explore the guide or use the search above to find your way.</p><a className="wiki-start-cta" href={wikiUrl()}>Return to the wiki <ArrowIcon /></a></section>}
      </main>
    </div>
  </div>
}
