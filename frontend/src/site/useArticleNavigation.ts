import { useCallback, useEffect, useRef, useState } from 'react'

export interface ArticleHeading { id: string; title: string }

/** Keep navigation in sync with the actual reading position, including table resizes. */
export function useArticleNavigation(articleKey: string, headings: ArticleHeading[]) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState('')
  const [progress, setProgress] = useState(0)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copyMessage, setCopyMessage] = useState('')
  const copyTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    setActiveId('')
    setProgress(0)
    let frame = 0
    const update = () => {
      frame = 0
      const body = bodyRef.current
      if (!body) return
      const threshold = window.innerWidth <= 960 ? 84 : 48
      const rect = body.getBoundingClientRect()
      const distance = Math.max(1, body.offsetHeight - window.innerHeight + threshold)
      setProgress(Math.round(Math.max(0, Math.min(1, (threshold - rect.top) / distance)) * 100))
      let current = ''
      for (const heading of headings) {
        if ((document.getElementById(heading.id)?.getBoundingClientRect().top ?? Infinity) <= threshold) current = heading.id
      }
      // A short final section may never reach the top before the document ends.
      if (rect.top < threshold && rect.bottom <= window.innerHeight && headings.length) current = headings[headings.length - 1].id
      setActiveId(current)
    }
    const scheduleUpdate = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(scheduleUpdate)
    if (bodyRef.current) observer?.observe(bodyRef.current)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
    }
  }, [articleKey, headings])

  useEffect(() => () => { clearTimeout(copyTimer.current) }, [])

  const jumpTo = useCallback((id: string) => {
    const targetId = id || 'article-introduction'
    const target = document.getElementById(targetId)
    if (!target) return
    window.history.pushState(null, '', `#${encodeURIComponent(targetId)}`)
    target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
    const heading = target.querySelector<HTMLElement>('h2') || target
    if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1
    heading.focus({ preventScroll: true })
  }, [])

  const copyLink = useCallback(async (sectionId?: string) => {
    const url = new URL(window.location.href)
    url.search = ''
    url.hash = sectionId || ''
    let copied = false
    try {
      await navigator.clipboard.writeText(url.href)
      copied = true
    } catch {
      const previousFocus = document.activeElement as HTMLElement | null
      const field = document.createElement('textarea')
      field.value = url.href
      field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;'
      field.setAttribute('aria-label', 'Article link')
      document.body.appendChild(field)
      field.select()
      try { copied = document.execCommand('copy') } catch { /* Clipboard access can be unavailable. */ }
      field.remove()
      previousFocus?.focus({ preventScroll: true })
    }
    clearTimeout(copyTimer.current)
    setCopiedId(copied ? sectionId || 'article' : null)
    setCopyMessage(copied ? `${sectionId ? 'Section' : 'Article'} link copied.` : 'Link copying is unavailable in this browser.')
    copyTimer.current = setTimeout(() => { setCopiedId(null); setCopyMessage('') }, 2500)
  }, [])

  return { bodyRef, activeId, progress, copiedId, copyMessage, jumpTo, copyLink }
}
