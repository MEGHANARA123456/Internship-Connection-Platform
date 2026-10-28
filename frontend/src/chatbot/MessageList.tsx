import { useEffect, useRef, useState } from 'react'
import { Check, Copy, ThumbsDown, ThumbsUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import { isKnownInternalRoute } from './safeRoutes'
import { SafeText } from './safeText'
import { PersonalSummaryCard } from './PersonalSummaryCard'
import type { ChatMessage, ChatSourceType } from './types'

interface MessageListProps {
  messages: ChatMessage[]
  typing: boolean
  onSend: (question: string) => Promise<boolean>
  onFeedback: (turnId: string, rating: 'up' | 'down', sourceType: ChatSourceType) => Promise<boolean>
}

export function MessageList({ messages, typing, onSend, onFeedback }: MessageListProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const shouldFollowLatest = useRef(true)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [copyError, setCopyError] = useState('')
  const [feedback, setFeedback] = useState<Record<string, 'up' | 'down' | 'error'>>({})

  useEffect(() => {
    const list = listRef.current
    if (list && shouldFollowLatest.current) list.scrollTop = list.scrollHeight
  }, [messages, typing])

  const copyResponse = async (message: ChatMessage) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard is unavailable')
      await navigator.clipboard.writeText(message.content)
      setCopiedMessageId(message.id)
      setCopyError('')
    } catch {
      setCopyError('Could not copy this response. Select and copy the text instead.')
    }
  }

  const submitFeedback = async (
    messageId: string,
    rating: 'up' | 'down',
    sourceType: ChatSourceType,
  ) => {
    const sent = await onFeedback(messageId, rating, sourceType)
    setFeedback((current) => ({ ...current, [messageId]: sent ? rating : 'error' }))
  }

  return (
    <div
      ref={listRef}
      onScroll={(event) => {
        const list = event.currentTarget
        shouldFollowLatest.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48
      }}
      aria-live="polite"
      aria-relevant="additions text"
      aria-label="Chat messages"
      className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
    >
      {messages.map((message) => (
        <article key={message.id} className={`max-w-[92%] rounded-2xl px-3 py-2.5 ${message.role === 'user' ? 'ml-auto bg-indigo-600 text-white' : 'mr-auto border border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'}`}>
          <SafeText text={message.content} />
          {message.summary && <PersonalSummaryCard summary={message.summary} />}
          {message.links?.filter((link) => isKnownInternalRoute(link.route)).map((link) => (
            <Link key={`${link.route}-${link.label}`} to={link.route} className="mt-2 inline-flex rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-200 dark:hover:bg-indigo-900">
              {link.label} →
            </Link>
          ))}
          {message.sourceType && (
            <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100">
              {message.sourceType === 'docs' ? 'Help docs' : message.sourceType === 'live data' ? 'Your live data' : 'Help docs + your live data'}
            </span>
          )}
          {message.noEvidence && (
            <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
              <p>Couldn’t find this in the help docs. Try asking about one of these topics:</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {message.suggestedFollowups?.map((question) => (
                  <button key={question} type="button" disabled={typing} onClick={() => void onSend(question)} className="rounded-full border border-amber-300 px-2 py-1 text-[10px] font-medium hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:hover:bg-amber-900">
                    {question}
                  </button>
                ))}
              </div>
            </div>
          )}
          {message.sources?.filter((source) => isKnownInternalRoute(source.route)).length ? (
            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-200/70 pt-2 text-[10px] dark:border-slate-600">
              {message.sources.filter((source) => isKnownInternalRoute(source.route)).map((source) => (
                <Link key={source.id} to={source.route} className="rounded-full bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-200 dark:hover:bg-indigo-900">
                  {source.title}
                </Link>
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex items-center justify-between gap-3 text-[10px] opacity-70">
            <time dateTime={new Date(message.createdAt).toISOString()}>{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
            {message.role === 'assistant' && (
              <button type="button" onClick={() => void copyResponse(message)} aria-label="Copy response" className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-200/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-slate-700">
                {copiedMessageId === message.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copiedMessageId === message.id ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
          {message.role === 'assistant' && message.sourceType && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {message.suggestedFollowups?.filter(() => !message.noEvidence).map((question) => (
                <button key={question} type="button" disabled={typing} onClick={() => void onSend(question)} className="rounded-full border border-slate-300 px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                  {question}
                </button>
              ))}
              <button
                type="button"
                aria-label="Helpful response"
                title="Helpful"
                disabled={feedback[message.id] === 'up' || feedback[message.id] === 'down'}
                onClick={() => {
                  if (message.sourceType) void submitFeedback(message.id, 'up', message.sourceType)
                }}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <ThumbsUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Not helpful response"
                title="Not helpful"
                disabled={feedback[message.id] === 'up' || feedback[message.id] === 'down'}
                onClick={() => {
                  if (message.sourceType) void submitFeedback(message.id, 'down', message.sourceType)
                }}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <ThumbsDown className="h-3.5 w-3.5" />
              </button>
              {feedback[message.id] === 'up' || feedback[message.id] === 'down'
                ? <span role="status" className="text-[10px] text-slate-500 dark:text-slate-400">Thanks for your feedback.</span>
                : feedback[message.id] === 'error'
                  ? <span role="alert" className="text-[10px] text-rose-700 dark:text-rose-300">Feedback could not be sent. Try again.</span>
                  : null}
            </div>
          )}
        </article>
      ))}
      {copyError && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{copyError}</p>}
      {typing && (
        <div role="status" aria-label="Assistant is typing" className="mr-auto flex gap-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500 [animation-delay:120ms]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500 [animation-delay:240ms]" />
        </div>
      )}
    </div>
  )
}
