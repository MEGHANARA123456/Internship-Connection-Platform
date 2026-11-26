import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, RotateCcw, Trash2, Video } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { DataList } from '../../components/ui/DataList'
import { IconButton } from '../../components/ui/IconButton'
import { useToast } from '../../components/ui/ToastProvider'
import { InterviewErrorNotice, useInterviewError } from '../../components/interviews/InterviewErrorNotice'
import { InterviewPageLayout } from '../../components/interviews/InterviewPageLayout'
import { InterviewVideoRecordingPanel } from '../../components/interviews/InterviewVideoRecordingPanel'
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
  const [recordingSessionId, setRecordingSessionId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const { toast } = useToast()
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
                  <span className="mr-2 inline-flex rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                    {session.mock_test_id ? 'Mock' : 'Real'}
                  </span>
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
        actions={({ session }) => {
          const item = items.find((entry) => entry.session.id === session.id)
          const reportAvailable = item?.report !== null && item?.report !== undefined
          return (
            <>
              <IconButton
                icon={Eye}
                aria-label={`View report for interview ${session.id}`}
                onClick={() => {
                  if (reportAvailable) {
                    navigate(routes.interviewReport(session.id))
                    return
                  }
                  toast(session.status === 'EXPIRED'
                    ? 'This attempt expired before it was completed. Retake the interview to get a report.'
                    : item?.reportError
                      ? 'The report could not be loaded. Refresh history and try again.'
                      : 'This attempt has no report yet. Complete or retake the interview to get a report.',
                    { kind: 'warning' },
                  )
                }}
              />
              {session.interview_mode === 'VIDEO' && (
                <IconButton
                  icon={Video}
                  aria-label={`View recordings for interview ${session.id}`}
                  onClick={() => setRecordingSessionId((current) => current === session.id ? null : session.id)}
                />
              )}
              <IconButton
                icon={RotateCcw}
                aria-label={`Retake interview ${session.id}`}
                onClick={() => navigate(routes.interviewSetup({ retake_of_session_id: session.id }))}
              />
              {recordingSessionId !== null && (
                <InterviewVideoRecordingPanel sessionId={recordingSessionId} />
              )}
              <IconButton
                icon={Trash2}
                variant="danger"
                aria-label={`Delete interview ${session.id}`}
                isLoading={deletingId === session.id}
                disabled={deletingId !== null}
                onClick={() => {
                  if (item) void removeSession(item)
                }}
              />
            </>
          )
        }}
      />
      {items.length > 0 && <Button variant="outline" onClick={() => void loadHistory()} isLoading={loading}>Refresh history</Button>}
    </InterviewPageLayout>
  )
}
