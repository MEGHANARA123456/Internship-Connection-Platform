import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card, CardContent } from '../../components/ui/Card'
import { InterviewErrorNotice, useInterviewError } from '../../components/interviews/InterviewErrorNotice'
import { InterviewPageLayout } from '../../components/interviews/InterviewPageLayout'
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
  return ['EVALUATION_PENDING', 'EVALUATION_FAILED', 'COMPLETED'].includes(session.status)
}

function statusLabel(status: InterviewSession['status']): string {
  return status.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
}

export function InterviewHistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const requestError = useInterviewError()

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
    if (!window.confirm('Delete this interview and all of its saved questions, answers, evaluations, and report?')) return
    setDeletingId(item.session.id)
    setError('')
    try {
      await deleteInterviewSession(item.session.id)
      setItems((current) => current.filter(({ session }) => session.id !== item.session.id))
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
      {loading && items.length === 0 && <p role="status" className="text-sm text-slate-500">Loading interview history…</p>}
      {!loading && items.length === 0 && !error && (
        <Card><CardContent className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">You have no interview attempts yet.</CardContent></Card>
      )}
      <div className="space-y-3">
        {items.map((item) => {
          const { session, report, reportError } = item
          const reportAvailable = hasReport(session)
          return (
            <Card key={session.id}>
              <CardContent className="flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <h2 className="font-semibold text-slate-900 dark:text-white">
                    {session.category.replaceAll('_', ' ')} · {session.session_type === 'PRACTICE' ? 'Practice' : 'Assessment'} · {session.interview_mode.toLowerCase()}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    {statusLabel(session.status)} · {formatDate(session.created_at)} · {session.question_count} questions
                  </p>
                  {report && typeof report.overall_score === 'number' && (
                    <p className="mt-1 text-sm font-semibold text-indigo-700 dark:text-indigo-300">Overall score: {report.overall_score}/100</p>
                  )}
                  {report?.status === 'PENDING' && <p role="status" className="mt-1 text-sm text-amber-700 dark:text-amber-300">Evaluation pending.</p>}
                  {report?.status === 'FAILED' && <p role="status" className="mt-1 text-sm text-rose-700 dark:text-rose-300">Evaluation failed; retry from the report.</p>}
                  {reportError && <p role="alert" className="mt-1 text-sm text-rose-700 dark:text-rose-300">{reportError}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link to={reportAvailable ? routes.interviewReport(session.id) : routes.interviewSession(session.id)} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900">
                    {reportAvailable ? 'View report' : session.status === 'EXPIRED' ? 'View session' : 'Continue'}
                  </Link>
                  <Link to={routes.interviewSetup({ retake_of_session_id: session.id })} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                    Retake
                  </Link>
                  <Button variant="danger" size="sm" isLoading={deletingId === session.id} disabled={deletingId !== null} onClick={() => void removeSession(item)}>
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
      {items.length > 0 && <Button variant="outline" onClick={() => void loadHistory()} isLoading={loading}>Refresh history</Button>}
    </InterviewPageLayout>
  )
}
