import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ExternalLink } from 'lucide-react'
import { api } from '../../api/client'
import { routes } from '../../lib/routes'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

type ApplicationSummary = {
  id: number | string
  status?: string
  display_status?: string
  title?: string
  internship_title?: string
  company_name?: string
  applied_at?: string
  created_at?: string
  application_number?: string | number
  internship_status?: string
  last_reached_status?: string
}

type TimelineStep = {
  key?: string
  label?: string
  state?: string
  timestamp?: string
  date?: string
  description?: string
  interview?: {
    date?: string
    time?: string
  }
}

type ApplicationTimeline = {
  summary?: ApplicationSummary
  application?: ApplicationSummary
  steps?: TimelineStep[]
}

type TrackerStage = {
  key: string
  label: string
  eventKeys: string[]
}

const stages: TrackerStage[] = [
  { key: 'APPLIED', label: 'Applied', eventKeys: ['APPLIED', 'APPLICATION_SUBMITTED'] },
  { key: 'UNDER_REVIEW', label: 'Under review', eventKeys: ['UNDER_REVIEW', 'APPLICATION_VIEWED'] },
  { key: 'SHORTLISTED', label: 'Shortlisted', eventKeys: ['SHORTLISTED'] },
  { key: 'INTERVIEW_SCHEDULED', label: 'Interview', eventKeys: ['INTERVIEW_SCHEDULED', 'INTERVIEW'] },
  { key: 'SELECTED', label: 'Offer', eventKeys: ['SELECTED', 'ACCEPTED', 'OFFER_EXTENDED'] },
]

const stageIndexByStatus: Record<string, number> = {
  APPLIED: 0,
  UNDER_REVIEW: 1,
  SHORTLISTED: 2,
  INTERVIEW_SCHEDULED: 3,
  SELECTED: 4,
  ACCEPTED: 4,
}

const EMPTY_TIMELINE_STEPS: TimelineStep[] = []

function displayStatus(status: string): string {
  if (status === 'ACCEPTED') return 'Offer Accepted'
  if (status === 'EXPIRED') return 'Expired'
  return status
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function eventDate(step: TimelineStep | undefined): string | undefined {
  return step?.timestamp || step?.date
}

function dateLabel(value?: string): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString()
}

function dateTimeLabel(value?: string): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleString()
}

function interviewLine(step?: TimelineStep): string | null {
  if (!step?.interview) return null
  const when = [step.interview.date, step.interview.time].filter(Boolean).join(', ')
  return when ? `Interview on ${when}` : null
}

function statusSentence(status: string, interview?: TimelineStep): string {
  if (status === 'EXPIRED') return 'Interview date has passed. Waiting for the recruiter’s decision.'
  if (status === 'INTERVIEW_SCHEDULED') return interviewLine(interview) || 'Your interview is scheduled.'
  if (status === 'UNDER_REVIEW') return 'Your application is under review.'
  if (status === 'SHORTLISTED') return 'You have been shortlisted.'
  if (status === 'SELECTED') return 'An offer is being prepared for you.'
  if (status === 'ACCEPTED') return 'You accepted the offer.'
  if (status === 'REJECTED') return 'You were not selected for this role.'
  if (status === 'WITHDRAWN') return 'You withdrew this application.'
  return 'Your application has been submitted.'
}

function stageStep(timelineSteps: TimelineStep[], stage: TrackerStage): TimelineStep | undefined {
  return timelineSteps.find((step) => stage.eventKeys.includes((step.key || '').toUpperCase()))
}

function latestReachedStage(timelineSteps: TimelineStep[]): number {
  const reached = stages.reduce((latest, stage, index) => {
    const step = stageStep(timelineSteps, stage)
    return step?.state === 'done' ? index : latest
  }, -1)
  return Math.max(reached, 0)
}

export function ApplicationTrackerModal({
  application,
  isOpen,
  onClose,
}: {
  application: ApplicationSummary
  isOpen: boolean
  onClose: () => void
}) {
  const [timeline, setTimeline] = useState<ApplicationTimeline | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTimeline = useCallback(async () => {
    const response = await api.get(`/applications/${application.id}/timeline`)
    return response.data as ApplicationTimeline
  }, [application.id])

  useEffect(() => {
    if (!isOpen) return
    let active = true
    void fetchTimeline()
      .then((response) => {
        if (active) setTimeline(response)
      })
      .catch(() => {
        if (active) setError('Unable to load this application timeline. Please try again.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [fetchTimeline, isOpen])

  const summary = { ...application, ...(timeline?.summary || timeline?.application || {}) }
  const status = summary.display_status === 'EXPIRED' ? 'EXPIRED' : summary.status || application.status || ''
  const timelineSteps = timeline?.steps || EMPTY_TIMELINE_STEPS
  const interviewStep = stageStep(timelineSteps, stages[3])
  const rejected = status === 'REJECTED'
  const withdrawn = status === 'WITHDRAWN'
  const accepted = status === 'ACCEPTED'
  const lastReached = summary.last_reached_status || application.last_reached_status
  const activeStageIndex = status === 'REJECTED' || status === 'WITHDRAWN'
    ? lastReached && stageIndexByStatus[lastReached] !== undefined
      ? stageIndexByStatus[lastReached]
      : latestReachedStage(timelineSteps)
    : stageIndexByStatus[status] ?? latestReachedStage(timelineSteps)
  const activity = [...timelineSteps]
    .filter((step) => eventDate(step))
    .sort((left, right) => new Date(eventDate(right) || 0).getTime() - new Date(eventDate(left) || 0).getTime())

  const handleClose = useCallback(() => onClose(), [onClose])

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Application tracker" maxWidth="xl">
      {loading ? (
        <div className="space-y-4" aria-label="Loading application tracker">
          <div className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          <div className="h-28 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          <div className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
        </div>
      ) : error ? (
        <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-950/30">
          <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setLoading(true)
              setError(null)
              void fetchTimeline()
                .then(setTimeline)
                .catch(() => setError('Unable to load this application timeline. Please try again.'))
                .finally(() => setLoading(false))
            }}
          >
            Retry
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          <section aria-label="Application details" className="space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  {summary.title || summary.internship_title || `Internship #${summary.id}`}
                </h3>
                <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400">{summary.company_name || 'Company'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {summary.internship_status === 'CLOSED' && <Badge variant="slate">ROLE CLOSED</Badge>}
                <Badge status={summary.display_status || status}>{displayStatus(summary.display_status || status)}</Badge>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span>Applied on {dateLabel(summary.applied_at || summary.created_at) || 'date unavailable'}</span>
              <span>Application #{summary.application_number || summary.id}</span>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300">{statusSentence(status, interviewStep)}</p>
            {summary.internship_status === 'CLOSED' && !rejected && !withdrawn && !accepted && (
              <p role="status" className="text-xs text-slate-600 dark:text-slate-300">
                This internship is closed to new applications. Your application is unaffected.
              </p>
            )}
          </section>

          <section aria-label="Application progress">
            <h3 className="mb-4 text-sm font-semibold text-slate-900 dark:text-white">Application progress</h3>
            <ol aria-label="Application progress" className="flex flex-col gap-3 sm:flex-row sm:gap-2">
              {stages.map((stage, index) => {
                const step = stageStep(timelineSteps, stage)
                const isDone = accepted || (rejected || withdrawn
                  ? index <= activeStageIndex
                  : step?.state === 'done' || index < activeStageIndex)
                const isCurrent = !accepted && !rejected && !withdrawn
                  && (step?.state === 'current' || (index === activeStageIndex && step?.state !== 'done'))
                const isPending = !isDone && !isCurrent
                const timestamp = dateTimeLabel(eventDate(step))
                return (
                  <li
                    key={stage.key}
                    className="relative flex min-w-0 gap-3 sm:flex-1 sm:flex-col sm:items-center sm:gap-2 sm:text-center"
                    aria-current={isCurrent ? 'step' : undefined}
                  >
                    {index < stages.length - 1 && (
                      <>
                        <span className={`absolute left-[11px] top-6 h-[calc(100%+0.75rem)] w-0.5 sm:hidden ${isDone ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
                        <span className={`absolute left-[calc(50%+1rem)] right-[-1rem] top-3 hidden h-0.5 sm:block ${isDone ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
                      </>
                    )}
                    <span className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                      isDone ? 'border-emerald-500 bg-emerald-500 text-white'
                        : isCurrent ? 'border-indigo-600 bg-white ring-4 ring-indigo-100 motion-safe:animate-pulse motion-reduce:animate-none dark:bg-slate-900 dark:ring-indigo-950'
                          : 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900'
                    }`}>
                      {isDone && <Check className="h-4 w-4" aria-hidden="true" />}
                    </span>
                    <div className="min-w-0 pb-1 sm:pb-0">
                      <p className={`text-xs font-semibold ${isCurrent ? 'text-indigo-700 dark:text-indigo-300' : isPending ? 'text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}>
                        {stage.label}
                      </p>
                      <p className={`mt-0.5 text-[11px] ${isCurrent ? 'font-medium text-indigo-700 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'}`}>
                        {isDone ? 'Completed' : isCurrent ? 'Current' : 'Pending'}
                      </p>
                      {timestamp && <time className="mt-0.5 block text-[10px] text-slate-500 dark:text-slate-400">{timestamp}</time>}
                    </div>
                  </li>
                )
              })}
              {(rejected || withdrawn) && (
                <li className="relative flex min-w-0 gap-3 sm:flex-1 sm:flex-col sm:items-center sm:gap-2 sm:text-center" aria-current="step">
                  <span className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                    rejected ? 'border-rose-500 bg-rose-500 text-white' : 'border-slate-400 bg-slate-100 text-slate-600 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-300'
                  }`}>
                    {rejected ? <span aria-hidden="true">×</span> : <span aria-hidden="true">–</span>}
                  </span>
                  <div>
                    <p className={`text-xs font-semibold ${rejected ? 'text-rose-700 dark:text-rose-300' : 'text-slate-700 dark:text-slate-300'}`}>
                      {rejected ? 'Not selected' : 'Withdrawn'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">Final status</p>
                  </div>
                </li>
              )}
            </ol>
          </section>

          <section aria-label="Application activity" className="border-t border-slate-200 pt-4 dark:border-slate-700">
            <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Activity</h3>
            {activity.length ? (
              <ol className="space-y-3">
                {activity.map((step, index) => (
                  <li key={`${step.key || step.label}-${index}`} className="flex gap-3">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-slate-800 dark:text-slate-200">{step.label || step.key || 'Application update'}</p>
                      {step.description && <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{step.description}</p>}
                      <time className="mt-0.5 block text-[10px] text-slate-500 dark:text-slate-400">{dateTimeLabel(eventDate(step))}</time>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">No activity is available yet.</p>
            )}
          </section>

          <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
            <Link to={routes.application(summary.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
              Open full details page <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}
    </Modal>
  )
}
