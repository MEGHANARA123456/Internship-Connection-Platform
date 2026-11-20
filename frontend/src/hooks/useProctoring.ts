import { useCallback, useEffect, useRef, useState } from 'react'
import {
  recordInterviewProctoringEvent,
} from '../services/interviewService'
import type { InterviewProctoringEventType } from '../types/interview'
import { showToast } from '../lib/feedback'

interface UseProctoringOptions {
  enabled: boolean
  sessionId: number
  questionIndex: number | null
  maxViolations: number
  onTerminated?: () => void
}

export function useProctoring({
  enabled,
  sessionId,
  questionIndex,
  maxViolations,
  onTerminated,
}: UseProctoringOptions) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const awaySinceRef = useRef<number | null>(null)
  const fullscreenExpectedRef = useRef(false)
  const eventQueueRef = useRef<Promise<void>>(Promise.resolve())
  const onTerminatedRef = useRef(onTerminated)
  const terminatedRef = useRef(false)
  const [warningCount, setWarningCount] = useState(0)
  const [warningOpen, setWarningOpen] = useState(false)
  const [warningType, setWarningType] = useState<InterviewProctoringEventType | null>(null)
  const [logError, setLogError] = useState('')
  const [fullscreenSupported, setFullscreenSupported] = useState(false)
  const [fullscreenActive, setFullscreenActive] = useState(false)

  useEffect(() => {
    onTerminatedRef.current = onTerminated
  }, [onTerminated])

  const recordEvent = useCallback((
    eventType: InterviewProctoringEventType,
    occurredAt = new Date(),
    durationAwayMs: number | null = null,
  ) => {
    if (!enabled) return
    eventQueueRef.current = eventQueueRef.current.then(async () => {
      try {
        const result = await recordInterviewProctoringEvent(sessionId, {
          event_type: eventType,
          occurred_at: occurredAt.toISOString(),
          question_index: questionIndex,
          duration_away_ms: durationAwayMs,
        })
        if (eventType !== 'FOCUS_RETURN') {
          setWarningCount(result.violation_count)
        }
        setLogError('')
        if (result.terminated || result.violation_count >= maxViolations) {
          if (awaySinceRef.current !== null) {
            return
          } else {
            if (!terminatedRef.current) {
              terminatedRef.current = true
              onTerminatedRef.current?.()
            }
          }
        }
      } catch {
        setLogError('A proctoring event could not be recorded. Check your connection before continuing.')
        showToast('A proctoring event could not be recorded. Check your connection.', 'error')
      }
    })
  }, [enabled, maxViolations, questionIndex, sessionId])

  const flagViolation = useCallback((eventType: InterviewProctoringEventType) => {
    setWarningType(eventType)
    setWarningOpen(true)
    setWarningCount((count) => count + 1)
    recordEvent(eventType)
  }, [recordEvent])

  const requestFullscreen = useCallback(async () => {
    if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen) {
      setFullscreenSupported(false)
      showToast('Fullscreen is not supported here; the interview will continue with other proctoring checks.', 'info')
      return
    }
    setFullscreenSupported(true)
    try {
      await document.documentElement.requestFullscreen()
      fullscreenExpectedRef.current = true
      setFullscreenActive(true)
    } catch {
      fullscreenExpectedRef.current = false
      showToast('Fullscreen was unavailable; the interview will continue with other proctoring checks.', 'info')
    }
  }, [])

  useEffect(() => {
    if (!enabled || !sessionId) return

    setFullscreenSupported(Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen))
    fullscreenExpectedRef.current = Boolean(document.fullscreenElement)
    setFullscreenActive(Boolean(document.fullscreenElement))

    const leaveFocus = (eventType: 'TAB_HIDDEN' | 'WINDOW_BLUR') => {
      if (awaySinceRef.current !== null) return
      awaySinceRef.current = Date.now()
      flagViolation(eventType)
    }
    const returnToFocus = () => {
      const awaySince = awaySinceRef.current
      if (awaySince === null || document.hidden) return
      awaySinceRef.current = null
      recordEvent('FOCUS_RETURN', new Date(), Math.max(0, Date.now() - awaySince))
    }
    const onVisibilityChange = () => {
      if (document.hidden) leaveFocus('TAB_HIDDEN')
      else returnToFocus()
    }
    const onWindowBlur = () => leaveFocus('WINDOW_BLUR')
    const onWindowFocus = () => returnToFocus()
    const onFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement)
      setFullscreenActive(active)
      if (active) fullscreenExpectedRef.current = true
      else if (fullscreenExpectedRef.current) {
        fullscreenExpectedRef.current = false
        flagViolation('FULLSCREEN_EXIT')
      }
    }
    const onShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const command = event.ctrlKey || event.metaKey
      const blockedCommand = command && ['a', 'c', 'p', 's', 'u', 'v', 'x'].includes(key)
      const devToolsShortcut = command && event.shiftKey && key === 'i'
      const blocked = blockedCommand || devToolsShortcut || key === 'f12' || key === 'printscreen'
      if (!blocked) return
      event.preventDefault()
      event.stopImmediatePropagation()
      showToast('Copy and paste are disabled during the interview.', 'info')
      flagViolation('SHORTCUT_ATTEMPT')
    }
    const root = rootRef.current
    const blockedEvents: Array<[string, InterviewProctoringEventType]> = [
      ['copy', 'COPY_ATTEMPT'],
      ['cut', 'CUT_ATTEMPT'],
      ['paste', 'PASTE_ATTEMPT'],
      ['contextmenu', 'CONTEXT_MENU'],
      ['dragstart', 'DRAG_ATTEMPT'],
      ['drop', 'DROP_ATTEMPT'],
    ]
    const handlers = blockedEvents.map(([name, eventType]) => {
      const handler = (event: Event) => {
        event.preventDefault()
        event.stopPropagation()
        showToast('Copy and paste are disabled during the interview.', 'info')
        flagViolation(eventType)
      }
      root?.addEventListener(name, handler, true)
      return [name, handler] as const
    })

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('blur', onWindowBlur)
    window.addEventListener('focus', onWindowFocus)
    window.addEventListener('keydown', onShortcut, true)
    document.addEventListener('fullscreenchange', onFullscreenChange)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('blur', onWindowBlur)
      window.removeEventListener('focus', onWindowFocus)
      window.removeEventListener('keydown', onShortcut, true)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      handlers.forEach(([name, handler]) => root?.removeEventListener(name, handler, true))
    }
  }, [enabled, flagViolation, recordEvent, sessionId])

  const acknowledgeWarning = useCallback(() => setWarningOpen(false), [])

  return {
    rootRef,
    warningCount,
    warningOpen,
    warningType,
    logError,
    fullscreenSupported,
    fullscreenActive,
    requestFullscreen,
    acknowledgeWarning,
  }
}
