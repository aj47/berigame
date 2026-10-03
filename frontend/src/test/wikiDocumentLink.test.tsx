import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import WikiDocumentLink from '../site/WikiDocumentLink'

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const fetchDocument = vi.fn<typeof fetch>()
const writeText = vi.fn()

function response(text: string, status = 200, contentType = 'text/plain') {
  return new Response(text, { status, headers: { 'Content-Type': contentType } })
}

function renderLink(href = '/llms.txt') {
  return render(<WikiDocumentLink href={href} title="llms.txt">Start here · llms.txt</WikiDocumentLink>)
}

beforeAll(() => {
  // JSDOM does not implement native modal focus or the dialog close event.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() {
    this.setAttribute('open', '')
    this.querySelector('button')?.focus()
  } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  } })
})

beforeEach(() => {
  fetchDocument.mockReset()
  writeText.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('fetch', fetchDocument)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

afterAll(() => {
  for (const [name, original] of [['showModal', originalShowModal], ['close', originalClose]] as const) {
    if (original) Object.defineProperty(HTMLDialogElement.prototype, name, original)
    else delete HTMLDialogElement.prototype[name]
  }
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else delete (navigator as { clipboard?: Clipboard }).clipboard
})

describe('wiki document links', () => {
  it('keeps the raw href and reads escaped text in a named modal without navigating', async () => {
    fetchDocument.mockResolvedValue(response('# BeriGame\n<script>alert("text")</script>'))
    renderLink()
    const link = screen.getByRole('link', { name: 'Start here · llms.txt' })
    expect(link).toHaveAttribute('href', '/llms.txt')
    expect(fireEvent.click(link)).toBe(false)
    const dialog = screen.getByRole('dialog', { name: 'llms.txt' })
    expect(within(dialog).getByText('Loading document…')).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Copy content' })).toBeDisabled()
    expect(await within(dialog).findByLabelText('Document content')).toHaveTextContent('<script>alert("text")</script>')
    expect(dialog.querySelector('script')).toBeNull()
    expect(fetchDocument).toHaveBeenCalledWith(new URL('/llms.txt', window.location.href).href, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(within(dialog).getByRole('button', { name: 'Close document' })).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close document' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(link).toHaveFocus()
  })

  it.each([
    ['HTTP errors', () => Promise.resolve(response('Unavailable', 503)), 'HTTP 503'],
    ['HTML responses', () => Promise.resolve(response('<main>Wiki</main>', 200, 'text/html')), 'web page instead'],
    ['mislabeled SPA fallbacks', () => Promise.resolve(response(' \n<!doctype html><html><body>Wiki</body></html>')), 'web page instead'],
    ['network errors', () => Promise.reject(new Error('Network unavailable')), 'Network unavailable'],
  ])('shows %s and lets the reader retry', async (_name, failure, message) => {
    fetchDocument.mockImplementationOnce(failure).mockResolvedValueOnce(response('# Recovered document'))
    renderLink()
    fireEvent.click(screen.getByRole('link'))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByLabelText('Document content')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy content' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText('Document content')).toHaveTextContent('# Recovered document')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fetchDocument).toHaveBeenCalledTimes(2)
  })

  it('copies the complete content and raw URL and reports clipboard failures', async () => {
    const content = '# BeriGame\n\nRaw Markdown.'
    fetchDocument.mockResolvedValue(response(content))
    renderLink()
    fireEvent.click(screen.getByRole('link'))
    await screen.findByLabelText('Document content')
    fireEvent.click(screen.getByRole('button', { name: 'Copy content' }))
    await screen.findByText('Content copied.')
    expect(writeText).toHaveBeenLastCalledWith(content)
    fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }))
    await screen.findByText('URL copied.')
    expect(writeText).toHaveBeenLastCalledWith(new URL('/llms.txt', window.location.href).href)
    writeText.mockRejectedValueOnce(new Error('Clipboard permission denied'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy content' }))
    expect(await screen.findByText('Could not copy content. Select and copy the text below.')).toBeVisible()
  })

  it('aborts a closed request and ignores its late result after reopening', async () => {
    let resolveFirst!: (value: Response) => void
    fetchDocument.mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve }))
      .mockResolvedValueOnce(response('# Current document'))
    renderLink()
    fireEvent.click(screen.getByRole('link'))
    const firstSignal = fetchDocument.mock.calls[0][1]?.signal
    fireEvent.click(screen.getByRole('button', { name: 'Close document' }))
    expect(firstSignal?.aborted).toBe(true)
    fireEvent.click(screen.getByRole('link'))
    expect(await screen.findByLabelText('Document content')).toHaveTextContent('# Current document')
    await act(async () => { resolveFirst(response('# Stale document')) })
    expect(screen.getByLabelText('Document content')).toHaveTextContent('# Current document')
    expect(screen.queryByText('# Stale document')).not.toBeInTheDocument()
  })

  it('aborts pending loading and restores scrolling on unmount', () => {
    fetchDocument.mockReturnValue(new Promise(() => {}))
    document.body.style.overflow = 'auto'
    const view = renderLink()
    fireEvent.click(screen.getByRole('link'))
    expect(document.body.style.overflow).toBe('hidden')
    const signal = fetchDocument.mock.calls[0][1]?.signal
    view.unmount()
    expect(signal?.aborted).toBe(true)
    expect(document.body.style.overflow).toBe('auto')
    document.body.style.overflow = ''
  })

  it.each([
    ['/llms.txt', { ctrlKey: true }],
    ['/llms.txt', { metaKey: true }],
    ['/llms.txt', { shiftKey: true }],
    ['/llms.txt', { altKey: true }],
    ['/llms.txt', { button: 1 }],
    ['https://example.com/llms.txt', {}],
  ])('preserves normal navigation for %s with %j', (href, modifiers) => {
    renderLink(href)
    let navigationAllowed = false
    document.addEventListener('click', event => {
      navigationAllowed = !event.defaultPrevented
      event.preventDefault() // Avoid JSDOM attempting the permitted navigation.
    }, { once: true })
    fireEvent.click(screen.getByRole('link'), modifiers)
    expect(navigationAllowed).toBe(true)
    expect(fetchDocument).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
