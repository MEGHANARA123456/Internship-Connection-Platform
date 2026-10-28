import axios from 'axios'
import { api } from '../api/client'
import type { ChatPage, ChatResponse, ChatRole, ChatSourceType, ChatbotStatus } from './types'

class InvalidChatbotResponseError extends Error {}

function isChatResponse(value: unknown): value is ChatResponse {
  return typeof value === 'object'
    && value !== null
    && 'answer' in value
    && typeof value.answer === 'string'
    && Boolean(value.answer.trim())
    && 'links' in value
    && Array.isArray(value.links)
    && value.links.every((link) => (
      typeof link === 'object'
      && link !== null
      && 'label' in link
      && typeof link.label === 'string'
      && 'route' in link
      && typeof link.route === 'string'
    ))
    && 'sources' in value
    && Array.isArray(value.sources)
    && value.sources.every((source) => (
      typeof source === 'object'
      && source !== null
      && 'id' in source
      && typeof source.id === 'string'
      && 'title' in source
      && typeof source.title === 'string'
      && 'route' in source
      && typeof source.route === 'string'
    ))
    && 'source_type' in value
    && (value.source_type === 'docs' || value.source_type === 'live data' || value.source_type === 'docs + live data')
    && 'suggested_followups' in value
    && Array.isArray(value.suggested_followups)
    && value.suggested_followups.every((item) => typeof item === 'string')
    && 'category' in value
    && typeof value.category === 'string'
    && 'refused' in value
    && typeof value.refused === 'boolean'
}

function isChatbotStatus(value: unknown): value is ChatbotStatus {
  return typeof value === 'object'
    && value !== null
    && 'enabled' in value
    && typeof value.enabled === 'boolean'
    && 'mode' in value
    && (value.mode === 'retrieval' || value.mode === 'llm')
    && 'provider_configured' in value
    && typeof value.provider_configured === 'boolean'
    && 'rag_enabled' in value
    && typeof value.rag_enabled === 'boolean'
    && 'indexed_chunk_count' in value
    && typeof value.indexed_chunk_count === 'number'
    && 'last_indexed_at' in value
    && (typeof value.last_indexed_at === 'string' || value.last_indexed_at === null)
}

export interface ChatTurn {
  role: ChatRole
  content: string
}

export async function askChatbot(message: string, history: ChatTurn[], page: ChatPage): Promise<ChatResponse> {
  const response = await api.post<ChatResponse>(
    '/chatbot/ask',
    { message, history, page },
    { timeout: 20_000 },
  )
  const result: unknown = response.data
  if (!isChatResponse(result)) throw new InvalidChatbotResponseError()
  return result
}

export async function getChatbotStatus(): Promise<ChatbotStatus> {
  const response = await api.get<ChatbotStatus>('/chatbot/status')
  const result: unknown = response.data
  if (!isChatbotStatus(result)) throw new InvalidChatbotResponseError()
  return result
}

export async function sendChatbotFeedback(
  turnId: string,
  rating: 'up' | 'down',
  sourceType: ChatSourceType,
): Promise<void> {
  await api.post('/chatbot/feedback', {
    turn_id: turnId,
    rating,
    source_type: sourceType,
  })
}

export function chatbotError(error: unknown): { message: string; retryAfter?: number } {
  if (!axios.isAxiosError(error)) {
    return error instanceof InvalidChatbotResponseError
      ? { message: 'The help assistant returned an invalid response. Please retry.' }
      : { message: 'You appear to be offline. Check your connection, then retry.' }
  }
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return { message: 'The help assistant took too long to respond. Please retry.' }
  }
  const response = error.response
  if (response?.status === 429) {
    const retryAfter = Number(response.headers?.['retry-after'])
    return {
      message: `You’ve reached the help-chat limit. Please retry${Number.isFinite(retryAfter) && retryAfter > 0 ? ` in ${retryAfter} seconds` : ' shortly'}.`,
      retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
    }
  }
  if (response?.status === 401) {
    return { message: 'Please sign in again to continue.' }
  }
  if (response?.status === 422) {
    const details = response.data && typeof response.data === 'object'
      && 'detail' in response.data
      ? response.data.detail
      : undefined
    const fields = Array.isArray(details)
      ? [...new Set(details.flatMap((item) => {
        if (!item || typeof item !== 'object' || !('loc' in item) || !Array.isArray(item.loc)) return []
        const field = item.loc.at(-1)
        return typeof field === 'string' && field !== 'body' ? [field] : []
      }))]
      : []
    return {
      message: fields.length
        ? `The chat request has an invalid ${fields.join(', ')} field. Refresh and try again.`
        : 'The chat request was invalid. Refresh and try again.',
    }
  }
  if (response?.status === 403) {
    return { message: 'Your account is not permitted to use the help assistant.' }
  }
  if (!response) return { message: 'You appear to be offline. Check your connection, then retry.' }
  return { message: 'The help assistant is temporarily unavailable. Please retry.' }
}
