import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ChatWindow } from '../ChatWindow'

const props = {
  messages: [],
  typing: false,
  error: '',
  role: 'COMPANY' as const,
  page: 'company-applicants' as const,
  mode: 'llm' as const,
  retrieval: 'bm25' as const,
  online: true,
  statusDisabled: false,
  statusError: false,
  statusChecking: false,
  summaryLoading: false,
  onSend: vi.fn().mockResolvedValue(true),
  onSummary: vi.fn(),
  onRetry: vi.fn(),
  onFeedback: vi.fn().mockResolvedValue(true),
  onClear: vi.fn(),
  onClose: vi.fn(),
}

describe('chatbot dialog accessibility', () => {
  it('opens as a labelled modal dialog, focuses the input, and closes with Escape', () => {
    const onClose = vi.fn()
    render(<MemoryRouter><ChatWindow {...props} onClose={onClose} /></MemoryRouter>)
    const dialog = screen.getByRole('dialog', { name: 'InternSphere AI' })

    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('AI help')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'How do I review applicants?' })).toBeInTheDocument()
    expect(screen.getByLabelText('Ask a question about InternSphere')).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps keyboard focus inside the dialog', () => {
    render(<MemoryRouter><ChatWindow {...props} /></MemoryRouter>)
    const clearButton = screen.getByRole('button', { name: 'Start a new conversation' })
    const signInLink = screen.getByRole('link', { name: 'Sign in' })

    signInLink.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(clearButton).toHaveFocus()

    clearButton.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(signInLink).toHaveFocus()
  })

  it('submits the typed question and disables sending while a request is active', () => {
    const onSend = vi.fn().mockResolvedValue(true)
    const { rerender } = render(
      <MemoryRouter><ChatWindow {...props} onSend={onSend} /></MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText('Ask a question about InternSphere'), {
      target: { value: 'How do I apply?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
    expect(onSend).toHaveBeenCalledWith('How do I apply?')

    rerender(<MemoryRouter><ChatWindow {...props} typing /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled()
  })

  it('clears the composer only after a successful send and supports Shift+Enter', async () => {
    let resolveSend: ((sent: boolean) => void) | undefined
    const onSend = vi.fn(() => new Promise<boolean>((resolve) => { resolveSend = resolve }))
    render(<MemoryRouter><ChatWindow {...props} onSend={onSend} /></MemoryRouter>)
    const composer = screen.getByLabelText('Ask a question about InternSphere')
    fireEvent.change(composer, { target: { value: 'First line' } })
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()

    fireEvent.keyDown(composer, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('First line')
    expect(composer).toHaveValue('First line')
    await act(async () => { resolveSend?.(true) })
    await screen.findByDisplayValue('')
  })

  it('auto-grows the composer, hides its scrollbar, and resets after sending', async () => {
    const composer = render(<MemoryRouter><ChatWindow {...props} /></MemoryRouter>)
      .getByLabelText('Ask a question about InternSphere') as HTMLTextAreaElement
    Object.defineProperty(composer, 'scrollHeight', {
      configurable: true,
      get: () => Math.max(
        composer.value.split('\n').length,
        Math.ceil(composer.value.length / 40),
        1,
      ) * 24,
    })

    fireEvent.change(composer, { target: { value: '' } })
    expect(composer.style.overflowY).toBe('hidden')
    expect(composer).toHaveClass('[scrollbar-width:none]', '[&::-webkit-scrollbar]:hidden')

    fireEvent.change(composer, { target: { value: 'One line' } })
    expect(composer.style.height).toBe('24px')
    expect(composer.style.overflowY).toBe('hidden')

    fireEvent.change(composer, { target: { value: 'Line one\nLine two\nLine three' } })
    expect(composer.style.height).toBe('72px')
    expect(composer.style.overflowY).toBe('hidden')

    fireEvent.change(composer, { target: { value: 'x'.repeat(500) } })
    expect(composer.style.height).toBe('120px')
    expect(composer.style.overflowY).toBe('auto')
    expect(screen.getByText('500/500')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
    await screen.findByDisplayValue('')
    await waitFor(() => {
      expect(composer.style.height).toBe('24px')
      expect(composer.style.overflowY).toBe('hidden')
    })
    expect(screen.getByText('0/500')).toBeInTheDocument()
  })

  it.each([
    ['STUDENT', /discover internships, track applications/i],
    ['COMPANY', /manage internship postings, review applicants/i],
    ['ADMIN', /platform administration, analytics, verification/i],
  ] as const)('shows the role-specific %s greeting', (role, greeting) => {
    render(<MemoryRouter><ChatWindow {...props} role={role} /></MemoryRouter>)
    expect(screen.getByText(greeting)).toBeInTheDocument()
  })

  it('shows source links, source type, follow-up suggestions, and sends metadata-only feedback', async () => {
    const onFeedback = vi.fn().mockResolvedValue(true)
    render(<MemoryRouter><ChatWindow
      {...props}
      messages={[{
        id: 'turn-1',
        role: 'assistant',
        content: 'Use the applications page.',
        createdAt: Date.now(),
        links: [
          { label: 'Applications', route: '/applications' },
          { label: 'Applications details', route: '/applications' },
        ],
        sourceType: 'docs',
        sources: [
          { id: 'applications', title: 'Applications guide', route: '/applications' },
          { id: 'profile', title: 'Profile guide', route: '/profile/student' },
        ],
        suggestedFollowups: ['How do I withdraw an application?'],
      }]}
      onFeedback={onFeedback}
    /></MemoryRouter>)

    expect(screen.getByText('General help')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Applications/ })).toHaveLength(1)
    expect(screen.queryByRole('link', { name: 'Applications guide' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Learn more' })).toHaveAttribute('href', '/profile/student')
    fireEvent.click(screen.getByRole('button', { name: 'How do I withdraw an application?' }))
    expect(props.onSend).toHaveBeenCalledWith('How do I withdraw an application?')
    fireEvent.click(screen.getByRole('button', { name: 'Helpful response' }))
    expect(onFeedback).toHaveBeenCalledWith('turn-1', 'up', 'docs')
    expect(await screen.findByText('Thanks for your feedback.')).toBeInTheDocument()
  })

  it('offers role-specific suggestions when the help docs have no evidence', () => {
    render(<MemoryRouter><ChatWindow
      {...props}
      messages={[{
        id: 'turn-2',
        role: 'assistant',
        content: "I don't have sufficient data to answer this question.",
        createdAt: Date.now(),
        sourceType: 'none',
        suggestedFollowups: ['How do I read my application timeline?'],
        noEvidence: true,
        links: [{ label: 'Help docs', route: '/#faq' }],
      }]}
    /></MemoryRouter>)
    expect(screen.getByText('Here are related questions I can help with:')).toBeInTheDocument()
    expect(screen.queryByText('General help')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'How do I read my application timeline?' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Help docs →' })).toHaveAttribute('href', '/#faq')
  })

  it('renders a clarification response separately from help and live-data answers', () => {
    render(<MemoryRouter><ChatWindow
      {...props}
      messages={[{
        id: 'turn-3',
        role: 'assistant',
        content: 'Which internship should I check?',
        createdAt: Date.now(),
        sourceType: 'none',
        needsClarification: 'Which internship should I check?',
      }]}
    /></MemoryRouter>)
    expect(screen.getByRole('status')).toHaveTextContent('Please clarify')
    expect(screen.getByText('Which internship should I check?')).toBeInTheDocument()
  })

  it('shows an empty hybrid index notice and enforces the API message limit', () => {
    render(<MemoryRouter><ChatWindow
      {...props}
      ragEnabled
      indexedChunkCount={0}
    /></MemoryRouter>)

    expect(screen.getByRole('status')).toHaveTextContent(/knowledge index is empty/i)
    expect(screen.getByLabelText('Ask a question about InternSphere')).toHaveAttribute('maxLength', '500')
    expect(screen.getByText('0/500')).toBeInTheDocument()
  })
})
