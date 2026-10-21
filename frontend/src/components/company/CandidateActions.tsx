import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
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

export interface CandidateActionItem {
  id: number
  student_id: number
  resume_id: number | null
  status?: string
  allowed_actions?: string[]
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
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const allowed = new Set(item.allowed_actions ?? [])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    const closeEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus()
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', closeEscape)
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

  const reject = () => {
    if (!window.confirm('Reject this applicant? They will be notified.')) return
    run(onReject)
  }
  const select = () => {
    if (!window.confirm('Confirm the offer for this candidate?')) return
    run(onSelect)
  }

  const items = [
    menuItem('View profile and resume', <UserRound className="h-4 w-4 shrink-0" />, onReview, true, '', 'normal'),
    menuItem('Move to review', <ArrowRight className="h-4 w-4 shrink-0" />, onMoveToReview, allowed.has('MOVE_TO_REVIEW'), 'Move to review first'),
    menuItem('Shortlist', <ClipboardCheck className="h-4 w-4 shrink-0" />, onShortlist, allowed.has('SHORTLIST'), 'Move to review first'),
    menuItem('Schedule interview', <CalendarDays className="h-4 w-4 shrink-0" />, onSchedule, allowed.has('SCHEDULE_INTERVIEW'), 'Shortlist first'),
    menuItem('Select candidate', <CheckCircle2 className="h-4 w-4 shrink-0" />, select, allowed.has('SELECT'), 'Complete interview first'),
    menuItem('Reject', <XCircle className="h-4 w-4 shrink-0" />, reject, allowed.has('REJECT'), 'Move to review first', 'danger'),
    menuItem('Notes', <StickyNote className="h-4 w-4 shrink-0" />, onNotes, true, ''),
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
      {open && (
        <>
          <button type="button" aria-label="Close applicant actions" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-slate-950/30 md:hidden" />
          <div
            ref={menuRef}
            role="menu"
            aria-label="Applicant actions"
            onKeyDown={handleMenuKeyDown}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col gap-1 overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl dark:border-slate-700 dark:bg-slate-900 md:absolute md:inset-x-auto md:bottom-auto md:right-0 md:top-full md:mt-1 md:max-h-[min(28rem,80vh)] md:w-64 md:rounded-xl"
          >
            <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600 md:hidden" />
            {items}
          </div>
        </>
      )}
    </div>
  )
}
