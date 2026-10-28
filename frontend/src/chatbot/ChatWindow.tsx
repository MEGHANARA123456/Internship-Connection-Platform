import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, Bot, Trash2, X } from 'lucide-react'
import { useAuthStore } from '../store/auth'
import { MessageList } from './MessageList'
import { greetingForRole, suggestedQuestionsForPage } from './suggestions'
import type { ChatMessage, ChatPage, ChatSourceType } from './types'
import { routes } from '../lib/routes'

interface ChatWindowProps {
  messages: ChatMessage[]
  typing: boolean
  error: string
  role?: 'STUDENT' | 'COMPANY' | 'ADMIN'
  page: ChatPage
  mode?: 'retrieval' | 'llm'
  online: boolean
  statusDisabled: boolean
  statusError: boolean
  statusChecking: boolean
  summaryLoading: boolean
  onSend: (message: string) => Promise<boolean>
  onSummary: () => void
  onRetry: () => void
  onFeedback: (turnId: string, rating: 'up' | 'down', sourceType: ChatSourceType) => Promise<boolean>
  onClear: () => void
  onClose: () => void
}

export function ChatWindow({ messages, typing, error, role, page, mode, online, statusDisabled, statusError, statusChecking, summaryLoading, onSend, onSummary, onRetry, onFeedback, onClear, onClose }: ChatWindowProps) {
  const session = useAuthStore((state) => state.session)
  const [draft, setDraft] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    inputRef.current?.focus()
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus.current?.focus()
    }
  }, [onClose])

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`
  }, [draft])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft.trim() || typing) return
    const submittedDraft = draft
    void onSend(submittedDraft).then((sent) => {
      if (sent) setDraft((current) => current === submittedDraft ? '' : current)
    })
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <section
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="chatbot-title"
      className="chatbot-window-enter fixed inset-x-0 bottom-[env(safe-area-inset-bottom)] z-[70] flex h-[calc(100dvh-env(safe-area-inset-bottom))] flex-col bg-white pb-[env(safe-area-inset-bottom)] text-slate-900 shadow-2xl dark:bg-slate-950 dark:text-white sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(38rem,calc(100dvh-3rem))] sm:w-[min(24rem,calc(100vw-3rem))] sm:rounded-2xl sm:border sm:border-slate-200 sm:pb-0 sm:dark:border-slate-800"
    >
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className="rounded-xl bg-indigo-100 p-2 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"><Bot className="h-5 w-5" /></span>
          <div>
            <h2 id="chatbot-title" className="text-sm font-bold">InternSphere AI</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {role === 'STUDENT' ? 'Internship and career help' : role === 'COMPANY' ? 'Recruiting workflow help' : 'Platform administration help'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200" aria-label={!online ? 'Chat connection unavailable' : statusDisabled ? 'Chatbot disabled by backend configuration' : statusError ? 'Chat connection could not be checked' : statusChecking ? 'Checking chat connection' : 'Chat connection online'}>
            <span className={`h-1.5 w-1.5 rounded-full ${!online || statusError || statusDisabled ? 'bg-rose-500' : statusChecking ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            {!online ? 'Offline' : statusDisabled ? 'Disabled' : statusError ? 'Unavailable' : statusChecking ? 'Checking' : mode === 'retrieval' ? 'Help online' : 'Online'}
          </span>
          <button type="button" onClick={onClear} aria-label="Start a new conversation" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-slate-800"><Trash2 className="h-4 w-4" /></button>
          <button type="button" onClick={onClose} aria-label="Minimize chat" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-slate-800"><ArrowDown className="h-4 w-4" /></button>
          <button type="button" onClick={onClose} aria-label="Close chat" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
        </div>
      </header>

      <p className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-[10px] leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        Please don’t share passwords or personal data. Chats are kept only in this page session.
      </p>
      {statusDisabled && <p role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100">The help assistant is disabled by the backend. Set <code className="font-semibold">CHATBOT_ENABLED=true</code> in the backend environment and restart the backend to enable it.</p>}
      {statusError && <p role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100">Chat connection could not be checked. You can still try sending a message.</p>}
      {!online && <p role="status" className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-100">You are offline. Reconnect to send messages.</p>}

      {messages.length === 0 && (
        <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <p className="mb-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200">{greetingForRole(role)}</p>
          <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">Suggested questions</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestedQuestionsForPage(role, page).map((question) => (
              <button key={question} type="button" onClick={() => void onSend(question)} disabled={typing || !online || statusDisabled} className="rounded-full border border-indigo-200 px-2.5 py-1 text-[10px] font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950">
                {question}
              </button>
            ))}
          </div>
          {role && (
            <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
              <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">Private dashboard summary</p>
              <button
                type="button"
                onClick={onSummary}
                disabled={typing || summaryLoading || !online || statusDisabled}
                className="rounded-full border border-emerald-200 px-2.5 py-1.5 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-900 dark:text-emerald-200 dark:hover:bg-emerald-950"
              >
                {summaryLoading ? 'Loading summary…' : role === 'STUDENT'
                  ? 'Show my application status summary'
                  : role === 'COMPANY'
                    ? 'Show my open roles and new applicants'
                    : 'Show pending approvals'}
              </button>
              <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Fetched directly from your dashboard and kept out of chat requests.</p>
            </div>
          )}
        </div>
      )}

      <MessageList messages={messages} typing={typing} onSend={onSend} onFeedback={onFeedback} />

      {error && (
        <div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
          <p role="alert">{error}</p>
          <button type="button" onClick={onRetry} className="shrink-0 font-bold underline">Retry</button>
        </div>
      )}
      <form onSubmit={submit} className="border-t border-slate-200 p-3 dark:border-slate-800">
        <div className="flex items-end gap-2">
          <label className="sr-only" htmlFor="chatbot-message">Ask a question about InternSphere</label>
          <textarea
            ref={inputRef}
            id="chatbot-message"
            value={draft}
            rows={1}
            maxLength={500}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Ask about using InternSphere…"
            disabled={typing || !online || statusDisabled}
            className="max-h-[120px] min-h-11 min-w-0 flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-indigo-900"
          />
          <button type="submit" disabled={!draft.trim() || typing || !online || statusDisabled} aria-label="Send question" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"><ArrowUp className="h-4 w-4" /></button>
        </div>
        <div className="mt-1 flex justify-between px-1 text-[10px] text-slate-400">
          <span>Never include passwords, codes, or personal details.</span><span>{draft.length}/500</span>
        </div>
        {!session && <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">Sign in for role-specific help. <Link to={routes.login()} className="font-semibold text-indigo-600 underline dark:text-indigo-300">Sign in</Link></p>}
      </form>
    </section>
  )
}
