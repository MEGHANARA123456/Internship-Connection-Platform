import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { MessageList } from '../MessageList'
import { isKnownInternalRoute } from '../safeRoutes'

describe('safe chatbot rendering', () => {
  it('renders only known internal destinations as links', () => {
    render(
      <MemoryRouter>
        <MessageList
          typing={false}
          onSend={async () => true}
          onFeedback={async () => true}
          messages={[{
            id: 'answer',
            role: 'assistant',
            content: 'See [Applications](/applications), [external](https://example.test), and [unknown](/admin/users).',
            createdAt: 0,
            links: [
              { label: 'Review applications', route: '/applications' },
              { label: 'External', route: 'https://example.test' },
            ],
          }]}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Applications' })).toHaveAttribute('href', '/applications')
    expect(screen.getByRole('link', { name: 'Review applications →' })).toHaveAttribute('href', '/applications')
    expect(screen.queryByRole('link', { name: 'external' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'unknown' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'External →' })).not.toBeInTheDocument()
  })

  it('treats markup and executable URL schemes as plain text', () => {
    const { container } = render(
      <MemoryRouter>
        <MessageList
          typing={false}
          onSend={async () => true}
          onFeedback={async () => true}
          messages={[{
            id: 'untrusted',
            role: 'assistant',
            content: '<img src=x onerror=alert(1)> [click](javascript:alert(1))',
            createdAt: 0,
          }]}
        />
      </MemoryRouter>,
    )

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument()
  })

  it('rejects protocol-relative and traversal-like destinations', () => {
    expect(isKnownInternalRoute('//evil.example')).toBe(false)
    expect(isKnownInternalRoute('/applications/../admin/users')).toBe(false)
    expect(isKnownInternalRoute('/applications/42')).toBe(true)
    expect(isKnownInternalRoute('/opportunities/42')).toBe(true)
  })
})
