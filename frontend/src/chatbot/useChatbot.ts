import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuthStore, type UserRole } from '../store/auth'
import {
  askChatbot,
  chatbotError,
  MAX_CHAT_MESSAGE_CHARS,
  sendChatbotFeedback,
  type ChatTurn,
} from './api'
import { fetchPersonalSummary } from './summaryApi'
import type { ChatMessage, ChatPage, ChatResponse, ChatSourceType, PersonalSummary } from './types'

function pageForPath(path: string): ChatPage {
  if (path.startsWith('/student/analytics')) return 'student-dashboard'
  if (path.startsWith('/opportunities')) return 'opportunities'
  if (path.startsWith('/applications')) return 'applications'
  if (path.startsWith('/profile')) return 'profile'
  if (path.startsWith('/interviews')) return 'interviews'
  if (path.startsWith('/messages')) return 'messages'
  if (path.startsWith('/notifications')) return 'notifications'
  if (path.startsWith('/company/shortlisted')) return 'company-shortlisted'
  if (path.startsWith('/company/pipeline')) return 'company-pipeline'
  if (path.startsWith('/company/settings')) return 'company-settings'
  if (path.startsWith('/profile/company')) return 'company-profile'
  if (path.startsWith('/company/applicants') || path.startsWith('/company/jobs/') && path.endsWith('/applicants')) return 'company-applicants'
  if (path.startsWith('/company/analytics')) return 'company-analytics'
  if (path.startsWith('/company/jobs')) return 'company-jobs'
  if (path.startsWith('/company')) return 'company-dashboard'
  if (path.startsWith('/admin/audit-logs')) return 'admin-audit-logs'
  if (path.startsWith('/admin/verifications')) return 'admin-verifications'
  if (path.startsWith('/admin/reports')) return 'admin-reports'
  if (path.startsWith('/admin/companies')) return 'admin-companies'
  if (path.startsWith('/admin/users')) return 'admin-users'
  if (path.startsWith('/admin/moderation')) return 'admin-moderation'
  if (path.startsWith('/admin/skill-assessments')) return 'admin-skills'
  if (path.startsWith('/admin')) return 'admin-dashboard'
  if (path.startsWith('/privacy-center')) return 'privacy-center'
  if (path.startsWith('/privacy-security')) return 'privacy'
  if (path.startsWith('/privacy')) return 'privacy-policy'
  if (path.startsWith('/saved')) return 'saved'
  if (path.startsWith('/login')) return 'login'
  if (path.startsWith('/register-student')) return 'register-student'
  if (path.startsWith('/register-company')) return 'register-company'
  if (path.startsWith('/verify')) return 'verify'
  return 'home'
}

function newMessage(role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    createdAt: Date.now(),
    ...extra,
  }
}

export function useChatbot() {
  const location = useLocation()
  const session = useAuthStore((state) => state.session)
  const role: UserRole | undefined = session?.role
  const identity = session
    ? `${session.userId ?? ''}:${session.email?.trim().toLowerCase() ?? ''}:${session.role}`
    : 'guest'
  const previousIdentity = useRef(identity)
  const generation = useRef(0)
  const requestInFlight = useRef(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [typing, setTyping] = useState(false)
  const [error, setError] = useState('')
  const [pendingQuestion, setPendingQuestion] = useState('')
  const [online, setOnline] = useState(typeof navigator === 'undefined' || navigator.onLine)
  const retryHistory = useRef<ChatTurn[]>([])
  const [summaryLoading, setSummaryLoading] = useState(false)
  const page = pageForPath(location.pathname)

  useEffect(() => {
    if (previousIdentity.current === identity) return
    previousIdentity.current = identity
    generation.current += 1
    setMessages([])
    setError('')
    setPendingQuestion('')
    setTyping(false)
    setSummaryLoading(false)
    retryHistory.current = []
  }, [identity])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const send = useCallback(async (
    question: string,
    historyOverride?: ChatTurn[],
    appendUserMessage = true,
  ): Promise<boolean> => {
    const text = question.trim()
    if (!text) return false
    if (text.length > MAX_CHAT_MESSAGE_CHARS) {
      setError(`Message too long (max ${MAX_CHAT_MESSAGE_CHARS} characters)`)
      return false
    }
    if (typing || summaryLoading || requestInFlight.current) return false
    requestInFlight.current = true
    setPendingQuestion(text)
    setError('')
    setTyping(true)
    const priorMessages = messages.filter((message) => !message.summary)
    const failedMessageIndex = pendingQuestion
      ? priorMessages.findLastIndex((message) => message.role === 'user' && message.content === pendingQuestion)
      : -1
    const turnHistory = historyOverride ?? priorMessages
      .filter((_, index) => index !== failedMessageIndex)
      .slice(-4)
      .map((message) => ({ role: message.role, content: message.content }))
    const requestGeneration = generation.current
    retryHistory.current = turnHistory
    if (appendUserMessage) setMessages((current) => [...current, newMessage('user', text)])
    try {
      const result: ChatResponse = await askChatbot(text, turnHistory, pageForPath(location.pathname))
      if (generation.current === requestGeneration) {
        setMessages((current) => [...current, newMessage('assistant', result.answer, {
          links: result.links,
          sources: result.sources,
          sourceType: result.source_type,
          suggestedFollowups: result.suggested_followups,
          noEvidence: !result.refused && result.category === 'in_scope'
            && result.source_type === 'docs' && result.sources.length === 0,
        })])
        setPendingQuestion('')
        return true
      }
    } catch (requestError) {
      if (generation.current === requestGeneration) setError(chatbotError(requestError).message)
    } finally {
      if (generation.current === requestGeneration) {
        requestInFlight.current = false
        setTyping(false)
      }
    }
    return false
  }, [location.pathname, messages, pendingQuestion, summaryLoading, typing])

  const showSummary = useCallback(async () => {
    if (!role || typing || summaryLoading) return
    const requestGeneration = generation.current
    setSummaryLoading(true)
    setError('')
    try {
      const summary: PersonalSummary = await fetchPersonalSummary(role)
      if (generation.current === requestGeneration) {
        setMessages((current) => [
          ...current,
          newMessage('assistant', 'A private dashboard summary is ready.', { summary }),
        ])
      }
    } catch {
      if (generation.current === requestGeneration) {
        setMessages((current) => [
          ...current,
          newMessage('assistant', 'Your dashboard summary could not be loaded. Please try again later.'),
        ])
      }
    } finally {
      if (generation.current === requestGeneration) setSummaryLoading(false)
    }
  }, [role, summaryLoading, typing])

  const retry = useCallback(() => {
    if (pendingQuestion) {
      void send(pendingQuestion, retryHistory.current, false)
    }
  }, [pendingQuestion, send])

  const sendFeedback = useCallback(async (
    turnId: string,
    rating: 'up' | 'down',
    sourceType: ChatSourceType,
  ): Promise<boolean> => {
    try {
      await sendChatbotFeedback(turnId, rating, sourceType)
      return true
    } catch {
      return false
    }
  }, [])

  const clear = useCallback(() => {
    generation.current += 1
    requestInFlight.current = false
    retryHistory.current = []
    setMessages([])
    setError('')
    setPendingQuestion('')
    setTyping(false)
  }, [])

  useEffect(() => {
    const unsubscribe = useAuthStore.subscribe((state, previous) => {
      const currentIdentity = state.session ? `${state.session.userId ?? ''}:${state.session.email?.trim().toLowerCase() ?? ''}:${state.session.role}` : 'guest'
      const oldIdentity = previous.session ? `${previous.session.userId ?? ''}:${previous.session.email?.trim().toLowerCase() ?? ''}:${previous.session.role}` : 'guest'
      if (currentIdentity !== oldIdentity) clear()
    })
    return unsubscribe
  }, [clear])

  return {
    messages,
    typing,
    summaryLoading,
    error,
    online,
    role,
    page,
    send,
    showSummary,
    retry,
    sendFeedback,
    clear,
  }
}
