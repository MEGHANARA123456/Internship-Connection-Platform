import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { DataList } from '../../components/ui/DataList'
import { InterviewErrorNotice, useInterviewError } from '../../components/interviews/InterviewErrorNotice'
import { InterviewPageLayout } from '../../components/interviews/InterviewPageLayout'
import { confirmAction, showToast } from '../../lib/feedback'
import { routes } from '../../lib/routes'
import {
  deleteInterviewSession,
  getInterviewReport,
  listInterviewSessions,
} from '../../services/interviewService'
import type { InterviewReport, InterviewSession } from '../../types/interview'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'

interface HistoryItem {
  session: InterviewSession
  report: InterviewReport | null
  reportError: string
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function hasReport(session: InterviewSession): boolean {
  return ['EVALUATION_PENDING', 'EVALUATION_FAILED', 'COMPLETED', 'TERMINATED'].includes(session.status)
}

function statusLabel(status: InterviewSession['status']): string {
  return status.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
}

export function InterviewHistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [viewNotice, setViewNotice] = useState('')
  const requestError = useInterviewError()
  const navigate = useNavigate()

  const loadHistory = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setError('')
    }
    try {
      const sessions = await listInterviewSessions()
      const nextItems = await Promise.all(sessions.map(async (session): Promise<HistoryItem> => {
        if (!hasReport(session)) return { session, report: null, reportError: '' }
        try {
          return { session, report: await getInterviewReport(session.id), reportError: '' }
        } catch (loadError) {
          return {
            session,
            report: null,
            reportError: requestError(loadError, routes.interviewHistory),
          }
        }
      }))
      setItems(nextItems)
      setError('')
    } catch (loadError) {
      if (!silent) setError(requestError(loadError, routes.interviewHistory))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [requestError])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])
  useAutoRefresh(() => loadHistory(true), 60_000, deletingId === null)

  const removeSession = async (item: HistoryItem) => {
    const confirmed = await confirmAction({
      title: 'Delete this attempt?',
      message: 'Its questions, answers and report will be permanently removed.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!confirmed) return
    setDeletingId(item.session.id)
    setError('')
    try {
      await deleteInterviewSession(item.session.id)
      setItems((current) => current.filter(({ session }) => session.id !== item.session.id))
      showToast('Interview attempt deleted.', 'success')
    } catch (deleteError) {
      setError(requestError(deleteError, routes.interviewHistory))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <InterviewPageLayout
      title="Interview history"
      description="Review past attempts, open reports, retake an interview, or delete an attempt and its saved data."
      actions={<Link to={routes.interviewStudio} className="rounded-lg px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40">Back to Studio</Link>}
    >
      {error && <InterviewErrorNotice message={error} onRetry={() => void loadHistory()} retrying={loading} />}
      {viewNotice && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">{viewNotice}</p>}
      {loading && items.length === 0 && <p role="status" className="text-sm text-slate-500">Loading interview history…</p>}
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Interview attempts ({items.length})</h2>
      <DataList
        ariaLabel="Interview history"
        rows={items}
        getRowKey={({ session }) => session.id}
        loading={loading}
        emptyState={error ? 'Interview history is unavailable.' : 'You have no interview attempts yet.'}
        columns={[
          {
            key: 'interview',
            header: 'Interview',
            render: ({ session, report, reportError }) => (
              <div className="min-w-0">
                <p className="font-semibold text-slate-900 dark:text-white">
                  {session.category.replaceAll('_', ' ')} · {session.session_type === 'PRACTICE' ? 'Practice' : 'Assessment'} · {session.interview_mode.toLowerCase()}
                </p>
                <p className="mt-1 text-xs text-slate-500">{session.question_count} questions · {formatDate(session.created_at)}</p>
                {report && typeof report.overall_score === 'number' && <p className="mt-1 text-xs font-semibold text-indigo-700 dark:text-indigo-300">Overall score: {report.overall_score}/100</p>}
                {report?.status === 'PENDING' && <p role="status" className="mt-1 text-xs text-amber-700 dark:text-amber-300">Evaluation pending.</p>}
                {report?.status === 'FAILED' && <p role="status" className="mt-1 text-xs text-rose-700 dark:text-rose-300">Evaluation failed; retry from the report.</p>}
                {reportError && <p role="alert" className="mt-1 text-xs text-rose-700 dark:text-rose-300">{reportError}</p>}
              </div>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: ({ session }) => <Badge status={session.status}>{statusLabel(session.status)}</Badge>,
          },
        ]}
        actions={(item) => {
          const { session, report, reportError } = item
          const reportAvailable = report !== null
          return (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-label={`View report for interview ${session.id}`}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
                onClick={() => {
                  if (reportAvailable) {
                    navigate(routes.interviewReport(session.id))
                    return
                  }
                  setViewNotice(session.status === 'EXPIRED'
                    ? 'This attempt expired before it was completed. Retake the interview to get a report.'
                    : 'This attempt has no report yet. Complete or retake the interview to get a report.')
                }}
              >
                <Eye aria-hidden="true" size={16} /> View report
              </button>
              {!reportAvailable && session.status !== 'EXPIRED' && (
                <Link to={routes.interviewSession(session.id)} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900">Continue</Link>
              )}
              <Link to={routes.interviewSetup({ retake_of_session_id: session.id })} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Retake</Link>
              <Button variant="danger" size="sm" isLoading={deletingId === session.id} disabled={deletingId !== null} onClick={() => void removeSession(item)}>Delete</Button>
              {reportError && !report && session.status !== 'EXPIRED' && <span role="alert" className="text-xs text-rose-700">{reportError}</span>}
            </div>
          )
        }}
      />
      {items.length > 0 && <Button variant="outline" onClick={() => void loadHistory()} isLoading={loading}>Refresh history</Button>}
    </InterviewPageLayout>
  )
}
