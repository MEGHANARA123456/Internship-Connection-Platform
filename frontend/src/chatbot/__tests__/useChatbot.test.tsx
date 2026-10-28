import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../../store/auth'
import { api } from '../../api/client'
import { useChatbot } from '../useChatbot'
import type { ChatResponse } from '../types'
import { askChatbot } from '../api'

vi.mock('../api', () => ({
  askChatbot: vi.fn(),
  chatbotError: vi.fn(() => ({ message: 'Temporary help service error.' })),
}))

const answer: ChatResponse = {
  answer: 'Open Applications to review your timeline.',
  links: [],
  sources: [],
  source_type: 'docs',
  suggested_followups: ['How do I withdraw an application?'],
  category: 'in_scope',
  refused: false,
}

function Harness() {
  const chat = useChatbot()
  return (
    <div>
      {chat.messages.map((message) => <p key={message.id}>{message.content}</p>)}
      <button type="button" onClick={() => void chat.send('How do I apply?')}>Send question</button>
      <button type="button" onClick={() => void chat.showSummary()}>Show summary</button>
      <button type="button" onClick={chat.retry}>Retry question</button>
      <span role="status">{chat.error}</span>
    </div>
  )
}

const student = {
  accessToken: 'access-student',
  refreshToken: 'refresh-student',
  role: 'STUDENT' as const,
  userId: 1,
  email: 'student@example.test',
}

const company = {
  accessToken: 'access-company',
  refreshToken: 'refresh-company',
  role: 'COMPANY' as const,
  userId: 2,
  email: 'company@example.test',
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  useAuthStore.setState({ session: null, persistence: 'session', sessionChangedInAnotherTab: false })
  vi.mocked(askChatbot).mockReset()
})

afterEach(() => {
  useAuthStore.getState().logout()
  localStorage.clear()
  sessionStorage.clear()
})

describe('transient chatbot state', () => {
  it('does not persist conversations and clears them on sign-out and account switch', async () => {
    useAuthStore.getState().setSession(student, 'session')
    vi.mocked(askChatbot).mockResolvedValue(answer)
    const { unmount } = render(<MemoryRouter><Harness /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
    expect(await screen.findByText(answer.answer)).toBeInTheDocument()
    expect(localStorage.getItem('chatbot_history')).toBeNull()
    expect(sessionStorage.getItem('chatbot_history')).toBeNull()

    useAuthStore.getState().setSession(company, 'session')
    await waitFor(() => expect(screen.queryByText(answer.answer)).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
    expect(await screen.findByText(answer.answer)).toBeInTheDocument()

    useAuthStore.getState().logout()
    await waitFor(() => expect(screen.queryByText(answer.answer)).not.toBeInTheDocument())
    unmount()
  })

  it('starts with an empty conversation after unmount and remount', async () => {
    vi.mocked(askChatbot).mockResolvedValue(answer)
    const first = render(<MemoryRouter><Harness /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
    expect(await screen.findByText(answer.answer)).toBeInTheDocument()
    first.unmount()

    render(<MemoryRouter><Harness /></MemoryRouter>)
    expect(screen.queryByText(answer.answer)).not.toBeInTheDocument()
    expect(localStorage.getItem('chatbot_history')).toBeNull()
    expect(sessionStorage.getItem('chatbot_history')).toBeNull()
  })

  it('retries the failed question without duplicating it in conversation history', async () => {
    vi.mocked(askChatbot)
      .mockRejectedValueOnce(new Error('network failure'))
      .mockResolvedValueOnce(answer)
    render(<MemoryRouter><Harness /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
    expect(await screen.findByText('Temporary help service error.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry question' }))
    expect(await screen.findByText(answer.answer)).toBeInTheDocument()
    expect(askChatbot).toHaveBeenNthCalledWith(1, 'How do I apply?', [], 'home')
    expect(askChatbot).toHaveBeenNthCalledWith(2, 'How do I apply?', [], 'home')
  })

  it('fetches summaries from the role endpoint and excludes their data from chatbot requests', async () => {
    useAuthStore.getState().setSession(student, 'session')
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        kpis: {
          applications_submitted: { value: 12 },
          under_review: { value: 4 },
          shortlisted: { value: 3 },
          offers: { value: 1 },
        },
      },
    } as never)
    vi.mocked(askChatbot).mockResolvedValue(answer)
    render(<MemoryRouter><Harness /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: 'Show summary' }))
    expect(await screen.findByText('A private dashboard summary is ready.')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/students/me/insights?range=30')
    expect(askChatbot).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
    await screen.findByText(answer.answer)
    expect(askChatbot).toHaveBeenCalledWith('How do I apply?', [], 'home')
  })
})
