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

  it('shows the character limit only for an over-limit user message', () => {
    const error = new axios.AxiosError('unprocessable entity')
    Object.assign(error, {
      response: {
        status: 422,
        data: {
          detail: [{
            loc: ['body', 'message'],
            msg: 'String should have at most 500 characters',
            type: 'string_too_long',
          }],
        },
      },
    })
    expect(chatbotError(error).message).toBe('Message too long (max 500 characters)')
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

  it('sends only recent, non-empty, plain-text history within the schema limit', async () => {
    const response = {
      answer: 'Done.',
      links: [],
      sources: [],
      source_type: 'docs',
      suggested_followups: [],
      category: 'in_scope',
      refused: false,
    }
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: response } as never)
    const longAnswer = `[guide](/applications) [1] 【source】 ${'a'.repeat(1600)}`

    await askChatbot('Follow up', [
      { role: 'user', content: 'old turn 1' },
      { role: 'assistant', content: 'old turn 2' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'https://example.test/linked-chip' },
      { role: 'assistant', content: longAnswer },
    ], 'home')

    const sentHistory = (post.mock.calls[0][1] as { history: Array<{ role: string; content: string }> }).history
    expect(sentHistory).toHaveLength(2)
    expect(sentHistory[0]).toEqual({ role: 'assistant', content: 'old turn 2' })
    expect(sentHistory[1].content).toHaveLength(1500)
    expect(sentHistory[1].content).not.toContain('/applications')
    expect(sentHistory[1].content).not.toContain('[1]')
    expect(sentHistory[1].content).not.toContain('【source】')
  })

  it('retries a history validation error once with shorter history', async () => {
    const response = {
      answer: 'Done.',
      links: [],
      sources: [],
      source_type: 'docs',
      suggested_followups: [],
      category: 'in_scope',
      refused: false,
    }
    const error = new axios.AxiosError('unprocessable entity')
    Object.assign(error, {
      response: {
        status: 422,
        data: {
          detail: [{
            loc: ['body', 'history', 0, 'content'],
            msg: 'String should have at most 500 characters',
            type: 'string_too_long',
          }],
        },
      },
    })
    const post = vi.spyOn(api, 'post')
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ data: response } as never)

    await expect(askChatbot('Follow up', [
      { role: 'assistant', content: 'a'.repeat(1400) },
    ], 'home')).resolves.toEqual(response)

    expect(post).toHaveBeenCalledTimes(2)
    const retriedHistory = (post.mock.calls[1][1] as { history: Array<{ content: string }> }).history
    expect(retriedHistory[0].content).toHaveLength(500)
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
