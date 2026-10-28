import axios from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { askChatbot, chatbotError, getChatbotStatus } from '../api'

afterEach(() => vi.restoreAllMocks())

describe('chatbot API errors', () => {
  it('uses the server Retry-After value for rate limits', () => {
    const error = new axios.AxiosError('rate limited')
    Object.assign(error, {
      response: {
        status: 429,
        headers: { 'retry-after': '37' },
        data: { detail: 'limit reached' },
      },
    })
    expect(chatbotError(error)).toEqual({
      message: 'You’ve reached the help-chat limit. Please retry in 37 seconds.',
      retryAfter: 37,
    })
  })

  it('shows a helpful offline message without leaking request details', () => {
    expect(chatbotError(new Error('private network detail')).message)
      .toBe('You appear to be offline. Check your connection, then retry.')
  })

  it('explains request validation errors without exposing submitted values', () => {
    const error = new axios.AxiosError('unprocessable entity')
    Object.assign(error, {
      response: {
        status: 422,
        data: {
          detail: [{ loc: ['body', 'page'], msg: 'invalid enum', input: 'private-value' }],
        },
      },
    })
    expect(chatbotError(error).message).toContain('invalid page field')
    expect(chatbotError(error).message).not.toContain('private-value')
  })

  it('asks the user to sign in again after an expired session', () => {
    const error = new axios.AxiosError('unauthorized')
    Object.assign(error, { response: { status: 401, data: { detail: 'expired' } } })
    expect(chatbotError(error).message).toBe('Please sign in again to continue.')
  })

  it('reads chatbot mode without exposing provider credentials', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        enabled: true,
        mode: 'llm',
        provider_configured: true,
        rag_enabled: true,
        indexed_chunk_count: 38,
        last_indexed_at: null,
      },
    } as never)
    await expect(getChatbotStatus()).resolves.toEqual({
      enabled: true,
      mode: 'llm',
      provider_configured: true,
      rag_enabled: true,
      indexed_chunk_count: 38,
      last_indexed_at: null,
    })
    expect(api.get).toHaveBeenCalledWith('/chatbot/status')
  })

  it('sends messages through the implemented chatbot API contract', async () => {
    const response = {
      answer: 'Review your application timeline.',
      links: [{ label: 'Applications', route: '/applications' }],
      sources: [{ id: 'applications', title: 'Applications guide', route: '/applications' }],
      source_type: 'docs',
      suggested_followups: ['How do I withdraw an application?'],
      category: 'in_scope',
      refused: false,
    }
    vi.spyOn(api, 'post').mockResolvedValue({ data: response } as never)

    await expect(askChatbot('Where is my application?', [], 'applications')).resolves.toEqual(response)
    expect(api.post).toHaveBeenCalledWith(
      '/chatbot/ask',
      { message: 'Where is my application?', history: [], page: 'applications' },
      { timeout: 20_000 },
    )
  })

  it('sends feedback metadata without the message content', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: null } as never)
    const { sendChatbotFeedback } = await import('../api')

    await sendChatbotFeedback('turn-4', 'down', 'live data')

    expect(post).toHaveBeenCalledWith('/chatbot/feedback', {
      turn_id: 'turn-4',
      rating: 'down',
      source_type: 'live data',
    })
  })

  it('rejects an empty or malformed chatbot response', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ data: { answer: '', links: [], sources: [] } } as never)

    await expect(askChatbot('Help', [], 'home')).rejects.toThrow()
  })
})
