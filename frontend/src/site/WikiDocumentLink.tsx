import React, { useEffect, useId, useRef, useState } from 'react'
import './wikiDocument.css'

type WikiDocumentLinkProps = {
  href: string
  title: string
  children: React.ReactNode
  className?: string
}

type DocumentState =
  | { status: 'loading' }
  | { status: 'loaded'; text: string }
  | { status: 'error'; message: string }

/** Keep raw URLs discoverable while reading documents without leaving the wiki. */
export default function WikiDocumentLink({ href, title, children, className }: WikiDocumentLinkProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLAnchorElement>(null)
  const request = useRef<AbortController | null>(null)
  const copyAttempt = useRef(0)
  const titleId = useId()
  const sourceId = useId()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [documentState, setDocumentState] = useState<DocumentState>({ status: 'loading' })
  const [copyMessage, setCopyMessage] = useState('')

  useEffect(() => {
    const element = dialog.current
    if (!open || !element) return
    element.showModal()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
      copyAttempt.current += 1
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    request.current = controller
    setDocumentState({ status: 'loading' })
    async function load() {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: 'text/plain, text/markdown, application/json' },
        })
        if (!response.ok) throw new Error(`The document could not be loaded (HTTP ${response.status}).`)
        const contentType = response.headers.get('content-type') || ''
        const text = await response.text()
        if (/text\/html|application\/xhtml\+xml/i.test(contentType) || /^\s*(?:<!doctype\s+html\b|<html(?:\s|>))/i.test(text)) {
          throw new Error('The server returned a web page instead of the requested document.')
        }
        if (!controller.signal.aborted) setDocumentState({ status: 'loaded', text })
      } catch (error) {
        if (!controller.signal.aborted) {
          setDocumentState({ status: 'error', message: error instanceof Error ? error.message : 'The document could not be loaded. Please try again.' })
        }
      }
    }
    void load()
    return () => controller.abort()
  }, [open, url, attempt])

  function openDocument(event: React.MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const destination = new URL(href, window.location.href)
    if (destination.origin !== window.location.origin) return
    event.preventDefault()
    setUrl(destination.href)
    setCopyMessage('')
    setDocumentState({ status: 'loading' })
    setOpen(true)
  }

  function finishClosing() {
    request.current?.abort()
    copyAttempt.current += 1
    setOpen(false)
    opener.current?.focus()
  }

  async function copy(text: string, label: string) {
    const currentAttempt = ++copyAttempt.current
    setCopyMessage('')
    try {
      await navigator.clipboard.writeText(text)
      if (currentAttempt === copyAttempt.current) setCopyMessage(`${label} copied.`)
    } catch {
      if (currentAttempt === copyAttempt.current) setCopyMessage(`Could not copy ${label.toLowerCase()}. Select and copy the text below.`)
    }
  }

  return <>
    <a ref={opener} href={href} className={className} aria-haspopup="dialog" onClick={openDocument}>{children}</a>
    <dialog ref={dialog} className="wiki-document-dialog" aria-labelledby={titleId} aria-describedby={sourceId} onClose={finishClosing}>
      <header className="wiki-document-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="wiki-document-close" autoFocus onClick={() => dialog.current?.close()} aria-label="Close document">Close <span aria-hidden="true">×</span></button>
      </header>
      <p id={sourceId} className="wiki-document-source">Document URL: <span>{url}</span></p>
      <div className="wiki-document-actions">
        <button type="button" onClick={() => void copy(url, 'URL')}>Copy URL</button>
        <button type="button" disabled={documentState.status !== 'loaded'} onClick={() => documentState.status === 'loaded' && void copy(documentState.text, 'Content')}>Copy content</button>
        <span className="wiki-document-copy-status" role="status">{copyMessage}</span>
      </div>
      <div className="wiki-document-body" aria-busy={documentState.status === 'loading'}>
        {documentState.status === 'loading' && <p role="status">Loading document…</p>}
        {documentState.status === 'error' && <div className="wiki-document-error"><p role="alert">{documentState.message}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}
        {documentState.status === 'loaded' && <pre tabIndex={0} aria-label="Document content">{documentState.text}</pre>}
      </div>
    </dialog>
  </>
}
