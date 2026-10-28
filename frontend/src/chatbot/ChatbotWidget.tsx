import { useCallback, useEffect, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { useChatbot } from './useChatbot'
import { ChatWindow } from './ChatWindow'
import { getChatbotStatus } from './api'
import type { ChatbotStatus } from './types'

const AUTHENTICATION_PATHS = [
  '/login',
  '/register-student',
  '/register-company',
  '/forgot-password',
  '/reset-password',
  '/verify',
]

function isAuthenticationPage(pathname: string): boolean {
  return AUTHENTICATION_PATHS.some((path) =>
    pathname === path || (path === '/verify' && pathname.startsWith('/verify/')),
  )
}

export function ChatbotWidget() {
  const [open, setOpen] = useState(false)
  const session = useAuthStore((state) => state.session)
  const location = useLocation()
  const chat = useChatbot()
  const authenticated = Boolean(session)
  const authenticationPage = isAuthenticationPage(location.pathname)
  const identity = session
    ? `${session.userId ?? ''}:${session.email?.trim().toLowerCase() ?? ''}`
    : 'guest'
  const [statusResult, setStatusResult] = useState<{
    identity: string
    status: ChatbotStatus | null
    failed: boolean
  }>({ identity: '', status: null, failed: false })
  useEffect(() => {
    if (!authenticated || authenticationPage) return
    let active = true
    getChatbotStatus()
      .then((currentStatus) => {
        if (active) setStatusResult({ identity, status: currentStatus, failed: false })
      })
      .catch(() => {
        if (active) setStatusResult({ identity, status: null, failed: true })
      })
    return () => { active = false }
  }, [authenticated, authenticationPage, identity])
  const status = statusResult.identity === identity ? statusResult.status : null
  const statusError = statusResult.identity === identity && statusResult.failed
  const statusDisabled = status?.enabled === false
  const statusChecking = !status && !statusError
  const close = useCallback(() => {
    setOpen(false)
  }, [])
  if (!authenticated || authenticationPage) return null
  return (
    <>
      {!open && (
        <button
          type="button"
          aria-label="Chat with InternSphere AI"
          title="Chat with InternSphere AI"
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-700 text-white shadow-xl transition duration-200 hover:scale-105 hover:shadow-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-950"
        >
          <MessageCircle className="h-6 w-6" />
          <span className={`absolute right-0 top-0 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-slate-950 ${!chat.online || statusError || statusDisabled ? 'bg-rose-400' : statusChecking ? 'bg-amber-400' : 'bg-emerald-400'}`} aria-label={!chat.online || statusError ? 'Offline' : statusDisabled ? 'Disabled' : statusChecking ? 'Checking connection' : 'Online'} />
          <span className="sr-only">Chat with InternSphere AI</span>
        </button>
      )}
      {open && (
        <ChatWindow
          messages={chat.messages}
          typing={chat.typing}
          error={chat.error}
          role={chat.role}
          page={chat.page}
          mode={status?.mode}
          online={chat.online}
          statusDisabled={statusDisabled}
          statusError={statusError}
          statusChecking={statusChecking}
          summaryLoading={chat.summaryLoading}
          onSend={chat.send}
          onSummary={chat.showSummary}
          onRetry={chat.retry}
          onFeedback={chat.sendFeedback}
          onClear={chat.clear}
          onClose={close}
        />
      )}
    </>
  )
}
