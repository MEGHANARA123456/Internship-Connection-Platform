import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { refreshSession, getAccessTokenExpirationMs } from '../../api/client'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { useAuthStore } from '../../store/auth'

const IDLE_TIMEOUT_MS = 30 * 60 * 1000
const WARNING_LEAD_MS = 60 * 1000
const REFRESH_LEAD_MS = 5 * 60 * 1000

export function SessionTimeoutManager() {
  const session = useAuthStore((state) => state.session)
  const logout = useAuthStore((state) => state.logout)
  const location = useLocation()
  const lastActivityAt = useRef(Date.now())
  const activityThrottleAt = useRef(0)
  const identityRef = useRef<string | null>(null)
  const rescheduleIdleTimers = useRef<() => void>(() => undefined)
  const [warningOpen, setWarningOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')

  const recordActivity = useCallback(() => {
    lastActivityAt.current = Date.now()
    setWarningOpen(false)
    setRefreshError('')
    rescheduleIdleTimers.current()
  }, [])

  useEffect(() => {
    if (!session) {
      identityRef.current = null
      setWarningOpen(false)
      return
    }

    const identity = `${session.userId ?? ''}:${session.role}`
    if (identityRef.current !== identity) {
      identityRef.current = identity
      lastActivityAt.current = Date.now()
    }

    let warningTimer = 0
    let idleTimer = 0
    const scheduleIdleTimers = () => {
      window.clearTimeout(warningTimer)
      window.clearTimeout(idleTimer)
      const remaining = IDLE_TIMEOUT_MS - (Date.now() - lastActivityAt.current)
      if (remaining <= 0) {
        window.sessionStorage.setItem('session_expired_message', 'true')
        logout(false)
        return
      }
      warningTimer = window.setTimeout(
        () => setWarningOpen(true),
        Math.max(0, remaining - WARNING_LEAD_MS),
      )
      idleTimer = window.setTimeout(() => {
        window.sessionStorage.setItem('session_expired_message', 'true')
        logout(false)
      }, remaining)
    }
    rescheduleIdleTimers.current = scheduleIdleTimers

    const onActivity = () => {
      const now = Date.now()
      if (now - activityThrottleAt.current < 750) return
      activityThrottleAt.current = now
      recordActivity()
    }

    const activityEvents: Array<keyof WindowEventMap> = [
      'pointerdown',
      'pointermove',
      'keydown',
      'touchstart',
      'wheel',
      'focus',
    ]
    activityEvents.forEach((event) => window.addEventListener(event, onActivity, { passive: true }))
    scheduleIdleTimers()
    return () => {
      activityEvents.forEach((event) => window.removeEventListener(event, onActivity))
      window.clearTimeout(warningTimer)
      window.clearTimeout(idleTimer)
      rescheduleIdleTimers.current = () => undefined
    }
  }, [session?.role, session?.userId, logout, recordActivity])

  useEffect(() => {
    if (!session) return
    recordActivity()
  }, [location.pathname, location.search, location.hash, recordActivity, session?.userId])

  useEffect(() => {
    if (!session) return
    const expiresAt = getAccessTokenExpirationMs(session)
    if (expiresAt === null) return

    let timer = 0
    let active = true
    const refreshWhileActive = async () => {
      if (!active || Date.now() - lastActivityAt.current >= IDLE_TIMEOUT_MS) return
      try {
        await refreshSession()
      } catch {
        if (active && useAuthStore.getState().session) {
          timer = window.setTimeout(() => void refreshWhileActive(), 60_000)
        }
      }
    }
    timer = window.setTimeout(
      () => void refreshWhileActive(),
      Math.max(0, expiresAt - Date.now() - REFRESH_LEAD_MS),
    )
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [session?.accessToken, session?.accessTokenExpiresAt, session?.userId])

  const staySignedIn = async () => {
    setRefreshing(true)
    setRefreshError('')
    try {
      await refreshSession()
      recordActivity()
    } catch {
      setRefreshError('Could not refresh your session. Check your connection and try again.')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Modal
      isOpen={warningOpen && Boolean(session)}
      onClose={() => undefined}
      title="Still there?"
      description="Your session will end after 30 minutes without activity."
      dismissible={false}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => logout()} disabled={refreshing}>Sign out</Button>
          <Button onClick={() => void staySignedIn()} isLoading={refreshing}>Stay signed in</Button>
        </div>
      )}
    >
      <p className="text-sm text-slate-600 dark:text-slate-300">
        We&apos;ll sign you out in one minute to protect your account.
      </p>
      {refreshError && <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">{refreshError}</p>}
    </Modal>
  )
}
