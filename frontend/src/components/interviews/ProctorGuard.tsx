import { useEffect, useRef, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { confirmAction, showToast } from '../../lib/feedback'
import { useProctoring } from '../../hooks/useProctoring'
import type { InterviewProctoringEventType } from '../../types/interview'

const eventLabels: Record<InterviewProctoringEventType, string> = {
  TAB_HIDDEN: 'The interview tab became hidden.',
  WINDOW_BLUR: 'The interview window lost focus.',
  FULLSCREEN_EXIT: 'Fullscreen mode was exited.',
  COPY_ATTEMPT: 'A copy action was blocked.',
  CUT_ATTEMPT: 'A cut action was blocked.',
  PASTE_ATTEMPT: 'A paste action was blocked.',
  CONTEXT_MENU: 'The context menu was blocked.',
  DRAG_ATTEMPT: 'Dragging content was blocked.',
  DROP_ATTEMPT: 'Dropping content was blocked.',
  SHORTCUT_ATTEMPT: 'A restricted keyboard shortcut was blocked.',
  FOCUS_RETURN: 'Focus returned to the interview.',
}

interface ProctorGuardProps {
  active: boolean
  sessionId: number
  questionIndex: number | null
  maxViolations: number
  onTerminated: () => void
  canExit?: () => boolean
  children: ReactNode
}

export function ProctorGuard({
  active,
  sessionId,
  questionIndex,
  maxViolations,
  onTerminated,
  canExit,
  children,
}: ProctorGuardProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const exitAllowedRef = useRef(false)
  const canExitRef = useRef(canExit)
  const containerRef = useRef<HTMLDivElement | null>(null)
  canExitRef.current = canExit
  const proctoring = useProctoring({
    enabled: active,
    sessionId,
    questionIndex,
    maxViolations,
    onTerminated,
  })

  useEffect(() => {
    if (!active) return
    const currentPath = `${location.pathname}${location.search}${location.hash}`
    const requestExit = async () => confirmAction({
      title: 'Leave this interview?',
      message: 'Your active interview is proctored. Leaving may discard your current answer.',
      confirmLabel: 'Leave interview',
    })
    const onPopState = (event: PopStateEvent) => {
      if (exitAllowedRef.current) {
        exitAllowedRef.current = false
        return
      }
      event.stopImmediatePropagation()
      window.history.pushState({ proctorGuard: true }, '', currentPath)
      if (canExitRef.current && !canExitRef.current()) {
        showToast('Wait for voice transcription or video upload to finish before leaving this session.', 'info')
        return
      }
      void requestExit().then((confirmed) => {
        if (confirmed) {
          exitAllowedRef.current = true
          window.history.back()
        }
      })
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (exitAllowedRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    const onClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest('a[href]')
      if (!anchor || !containerRef.current?.contains(anchor)) return
      if (canExitRef.current && !canExitRef.current()) return
      const destination = new URL((anchor as HTMLAnchorElement).href, window.location.href)
      if (destination.origin !== window.location.origin) return
      event.preventDefault()
      event.stopPropagation()
      void requestExit().then((confirmed) => {
        if (!confirmed) return
        exitAllowedRef.current = true
        navigate(`${destination.pathname}${destination.search}${destination.hash}`)
      })
    }

    window.history.pushState({ proctorGuard: true }, '', currentPath)
    window.addEventListener('popstate', onPopState, true)
    window.addEventListener('beforeunload', onBeforeUnload)
    containerRef.current?.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('popstate', onPopState, true)
      window.removeEventListener('beforeunload', onBeforeUnload)
      containerRef.current?.removeEventListener('click', onClick, true)
    }
  }, [active, location.hash, location.pathname, location.search, navigate])

  return (
    <div ref={(element) => {
      containerRef.current = element
      proctoring.rootRef.current = element
    }}>
      {active && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <span className="font-semibold">Proctored session – tab switches are recorded</span>
          <span aria-live="polite">Warnings: {proctoring.warningCount} of {maxViolations}</span>
          {proctoring.fullscreenSupported && !proctoring.fullscreenActive && (
            <Button size="sm" variant="outline" onClick={() => void proctoring.requestFullscreen()}>
              Enter fullscreen
            </Button>
          )}
        </div>
      )}
      {proctoring.logError && <p role="alert" className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{proctoring.logError}</p>}
      {children}
      <Modal
        isOpen={active && proctoring.warningOpen}
        onClose={proctoring.acknowledgeWarning}
        title={`Warning ${proctoring.warningCount} of ${maxViolations}`}
        dismissible={false}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            {proctoring.warningType ? eventLabels[proctoring.warningType] : 'A proctoring event was recorded.'}
            {' '}Repeated violations will end this interview.
          </p>
          <Button onClick={proctoring.acknowledgeWarning}>Continue interview</Button>
        </div>
      </Modal>
    </div>
  )
}
