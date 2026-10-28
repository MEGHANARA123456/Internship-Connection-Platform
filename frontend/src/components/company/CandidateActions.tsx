import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  CheckCircle2,
  ClipboardCheck,
  MessageSquare,
  StickyNote,
  UserRound,
  XCircle,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { routes } from '../../lib/routes'
import { confirmAction } from '../../lib/feedback'

export interface CandidateActionItem {
  id: number
  student_id: number
  resume_id: number | null
  status?: string
  allowed_actions?: string[]
  allowed_next?: string[]
}

interface CandidateActionsProps {
  item: CandidateActionItem
  variant?: 'stacked' | 'icons'
  onSchedule?: () => void
  onReview: () => void
  onNotes: () => void
  onMoveToReview?: () => void
  onShortlist?: () => void
  onSelect?: () => void
  onReject?: () => void
  disabled?: boolean
}

export function CandidateActions({
  item,
  onSchedule,
  onReview,
  onNotes,
  onMoveToReview,
  onShortlist,
  onSelect,
  onReject,
  disabled = false,
}: CandidateActionsProps) {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<'above' | 'below'>('below')
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const allowed = new Set(item.allowed_next ?? [])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) setOpen(false)
    }
    const closeEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', closeEscape)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const gap = 4
      const viewportPadding = 8
      const width = Math.min(256, window.innerWidth - viewportPadding * 2)
      const belowSpace = window.innerHeight - rect.bottom - gap - viewportPadding
      const aboveSpace = rect.top - gap - viewportPadding
      const flipUp = belowSpace < Math.min(280, aboveSpace) && aboveSpace > belowSpace
      const availableHeight = Math.max(120, flipUp ? aboveSpace : belowSpace)
      const left = Math.max(viewportPadding, Math.min(rect.right - width, window.innerWidth - width - viewportPadding))
      setPlacement(flipUp ? 'above' : 'below')
      setMenuStyle({
        position: 'fixed',
        left,
        width,
        maxHeight: Math.min(448, availableHeight),
        ...(flipUp
          ? { bottom: window.innerHeight - rect.top + gap, top: 'auto' }
          : { top: rect.bottom + gap, bottom: 'auto' }),
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const options = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])
    const currentIndex = options.indexOf(document.activeElement as HTMLElement)
    const nextIndex = event.key === 'ArrowDown'
      ? (currentIndex + 1) % options.length
      : event.key === 'ArrowUp'
        ? (currentIndex - 1 + options.length) % options.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? options.length - 1
            : -1
    if (nextIndex >= 0) {
      event.preventDefault()
      options[nextIndex]?.focus()
    }
  }

  const run = (action: (() => void) | undefined) => {
    if (!action) return
    setOpen(false)
    action()
  }

  const menuItem = (
    label: string,
    icon: React.ReactNode,
    action: (() => void) | undefined,
    enabled: boolean,
    hint: string,
    intent: 'normal' | 'danger' = 'normal',
  ) => (
    <button
      key={label}
      type="button"
      role="menuitem"
      aria-disabled={!enabled}
      title={!enabled ? hint : undefined}
      tabIndex={enabled ? 0 : -1}
      disabled={!enabled}
      onClick={() => run(action)}
      className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 ${intent === 'danger' ? 'text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'}`}
    >
      {icon}
      <span className="min-w-0 flex-1">{label}</span>
      {!enabled && <span className="sr-only">{hint}</span>}
    </button>
  )

  const reject = async () => {
    if (!await confirmAction({ title: 'Reject applicant?', message: 'They will be notified.', confirmLabel: 'Reject applicant', destructive: true })) return
    run(onReject)
  }
  const select = async () => {
    if (!await confirmAction({ title: 'Confirm offer?', message: 'Confirm the offer for this candidate?', confirmLabel: 'Confirm offer' })) return
    run(onSelect)
  }

  const items = [
    menuItem('View profile and resume', <UserRound className="h-4 w-4 shrink-0" />, onReview, true, ''),
    ...(allowed.has('UNDER_REVIEW') ? [menuItem('Move to review', <ArrowRight className="h-4 w-4 shrink-0" />, onMoveToReview, true, '')] : []),
    ...(allowed.has('SHORTLISTED') ? [menuItem('Shortlist', <ClipboardCheck className="h-4 w-4 shrink-0" />, onShortlist, true, '')] : []),
    ...(allowed.has('INTERVIEW_SCHEDULED') && ['SHORTLISTED', 'INTERVIEW_SCHEDULED'].includes(item.status ?? '')
      ? [menuItem('Schedule interview', <CalendarDays className="h-4 w-4 shrink-0" />, onSchedule, true, '')]
      : []),
    ...(allowed.has('SELECTED') ? [menuItem('Select candidate', <CheckCircle2 className="h-4 w-4 shrink-0" />, select, true, '')] : []),
    ...(allowed.has('REJECTED') ? [menuItem('Reject', <XCircle className="h-4 w-4 shrink-0" />, reject, true, '', 'danger')] : []),
    <Link
      key="Message"
      role="menuitem"
      tabIndex={0}
      to={routes.messages({ contactId: item.student_id })}
      onClick={() => setOpen(false)}
      className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      <MessageSquare className="h-4 w-4 shrink-0" />
      <span>Message</span>
    </Link>,
    menuItem('Notes', <StickyNote className="h-4 w-4 shrink-0" />, onNotes, true, ''),
  ]

  return (
    <div ref={rootRef} className="relative flex justify-end">
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="h-10 w-28 shrink-0 justify-center gap-2 whitespace-nowrap px-2 text-xs"
      >
        Actions <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Applicant actions"
          data-placement={placement}
          onKeyDown={handleMenuKeyDown}
          style={menuStyle}
          className="z-[60] flex flex-col gap-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        >
          {items}
        </div>,
        document.body,
      )}
    </div>
  )
}
