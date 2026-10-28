import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { ChatbotWidget } from '../ChatbotWidget'

const status = {
  enabled: true,
  mode: 'retrieval',
  provider_configured: false,
  rag_enabled: true,
  indexed_chunk_count: 38,
  last_indexed_at: null,
}

afterEach(() => {
  useAuthStore.getState().logout()
  vi.restoreAllMocks()
})

describe('chatbot launcher availability', () => {
  it.each([
    ['STUDENT', '/opportunities'],
    ['COMPANY', '/company'],
    ['ADMIN', '/admin'],
  ] as const)('mounts for %s dashboards', async (role, path) => {
    useAuthStore.getState().setSession({
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
      role,
      userId: 5,
      email: 'dashboard@example.test',
    }, 'session')
    vi.spyOn(api, 'get').mockResolvedValue({
      data: status,
    } as never)

    render(<MemoryRouter initialEntries={[path]}><ChatbotWidget /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Chat with InternSphere AI' })).toBeInTheDocument()
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/chatbot/status'))
    fireEvent.click(screen.getByRole('button', { name: 'Chat with InternSphere AI' }))
    expect(await screen.findByText('Help online')).toBeInTheDocument()
  })

  it.each(['/login', '/register-student', '/register-company', '/forgot-password', '/reset-password', '/verify', '/verify/token'])(
    'hides on public authentication page %s',
    async (path) => {
      useAuthStore.getState().setSession({
        accessToken: 'test-access',
        refreshToken: 'test-refresh',
        role: 'STUDENT',
        userId: 5,
      }, 'session')
      const get = vi.spyOn(api, 'get')
      render(<MemoryRouter initialEntries={[path]}><ChatbotWidget /></MemoryRouter>)

      expect(screen.queryByRole('button', { name: 'Chat with InternSphere AI' })).not.toBeInTheDocument()
      await waitFor(() => expect(get).not.toHaveBeenCalled())
    },
  )

  it('does not render or contact the chatbot for a signed-out visitor', async () => {
    const get = vi.spyOn(api, 'get')
    render(<MemoryRouter initialEntries={['/opportunities']}><ChatbotWidget /></MemoryRouter>)

    expect(screen.queryByRole('button', { name: 'Chat with InternSphere AI' })).not.toBeInTheDocument()
    await waitFor(() => expect(get).not.toHaveBeenCalled())
  })

  it('keeps one launcher instance mounted across authenticated route changes', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
      role: 'STUDENT',
      userId: 5,
    }, 'session')
    vi.spyOn(api, 'get').mockResolvedValue({
      data: status,
    } as never)

    function Navigation() {
      const navigate = useNavigate()
      return <button type="button" onClick={() => navigate('/company')}>Navigate</button>
    }
    render(<MemoryRouter initialEntries={['/opportunities']}>
      <Navigation />
      <Routes>
        <Route path="/opportunities" element={<p>Opportunities page</p>} />
        <Route path="/company" element={<p>Company page</p>} />
      </Routes>
      <ChatbotWidget />
    </MemoryRouter>)

    expect(screen.getAllByRole('button', { name: 'Chat with InternSphere AI' })).toHaveLength(1)
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Chat with InternSphere AI' }))
    expect(await screen.findByText('Help online')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Navigate' }))
    expect(await screen.findByText('Company page')).toBeInTheDocument()
    expect(screen.getAllByRole('dialog', { name: 'InternSphere AI' })).toHaveLength(1)
    expect(api.get).toHaveBeenCalledTimes(1)
  })

  it('minimizes and reopens without clearing the current conversation', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
      role: 'COMPANY',
      userId: 9,
    }, 'session')
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { ...status, mode: 'llm' },
    } as never)

    render(<MemoryRouter initialEntries={['/company']}><ChatbotWidget /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Chat with InternSphere AI' }))
    expect(await screen.findByRole('dialog', { name: 'InternSphere AI' })).toBeInTheDocument()
    expect(await screen.findByText('Online')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Minimize chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Chat with InternSphere AI' }))
    expect(await screen.findByRole('dialog', { name: 'InternSphere AI' })).toBeInTheDocument()
  })

  it('reports status failures without pretending the backend is configured', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
      role: 'STUDENT',
      userId: 10,
    }, 'session')
    vi.spyOn(api, 'get').mockRejectedValue(new Error('service unavailable'))

    render(<MemoryRouter initialEntries={['/opportunities']}><ChatbotWidget /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Chat with InternSphere AI' }))

    expect(await screen.findByText(/Chat connection could not be checked/)).toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
  })

  it('keeps the launcher visible and explains when the backend has disabled the chatbot', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
      role: 'ADMIN',
      userId: 11,
    }, 'session')
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { ...status, enabled: false },
    } as never)

    render(<MemoryRouter initialEntries={['/admin']}><ChatbotWidget /></MemoryRouter>)
    expect(await screen.findByRole('button', { name: 'Chat with InternSphere AI' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Chat with InternSphere AI' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Set CHATBOT_ENABLED=true')
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled()
  })
})
