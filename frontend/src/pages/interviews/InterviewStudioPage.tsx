import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Clock3, History, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card, CardContent } from '../../components/ui/Card'
import { InterviewErrorNotice, useInterviewError } from '../../components/interviews/InterviewErrorNotice'
import { InterviewPageLayout } from '../../components/interviews/InterviewPageLayout'
import { MockTestsLibrary } from '../../components/interviews/MockTestsLibrary'
import { routes } from '../../lib/routes'
import { listInterviewSessions } from '../../services/interviewService'
import type { InterviewSession } from '../../types/interview'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function sessionDestination(session: InterviewSession): string {
  return ['EVALUATION_PENDING', 'EVALUATION_FAILED', 'COMPLETED'].includes(session.status)
    ? routes.interviewReport(session.id)
    : routes.interviewSession(session.id)
}

export function InterviewStudioPage() {
  const [sessions, setSessions] = useState<InterviewSession[]>([])
  const [activeTab, setActiveTab] = useState<'overview' | 'mock-tests'>('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestError = useInterviewError()

  const loadSessions = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setError('')
    }
    try {
      setSessions(await listInterviewSessions())
      setError('')
    } catch (loadError) {
      if (!silent) setError(requestError(loadError, routes.interviewStudio))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [requestError])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])
  useAutoRefresh(() => loadSessions(true), 15_000, activeTab === 'overview')

  return (
    <InterviewPageLayout
      title="AI Interview Studio"
      description="Build confidence with guided interviews and reusable mock tests across text, voice, and video modes."
      actions={(
        <>
          <Link to={routes.interviewHistory} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900">
            <History className="h-4 w-4" /> History
          </Link>
          <Link to={routes.interviewSetup()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <Sparkles className="h-4 w-4" /> Start new interview
          </Link>
        </>
      )}
    >
      {error && <InterviewErrorNotice message={error} onRetry={() => void loadSessions()} retrying={loading} />}

      <div role="tablist" aria-label="Interview Studio sections" className="mb-5 flex gap-2 border-b border-slate-200 dark:border-slate-800">
        <button type="button" role="tab" aria-selected={activeTab === 'overview'} onClick={() => setActiveTab('overview')} className={`border-b-2 px-3 py-2 text-sm font-semibold ${activeTab === 'overview' ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300' : 'border-transparent text-slate-600 dark:text-slate-400'}`}>Overview</button>
        <button type="button" role="tab" aria-selected={activeTab === 'mock-tests'} onClick={() => setActiveTab('mock-tests')} className={`border-b-2 px-3 py-2 text-sm font-semibold ${activeTab === 'mock-tests' ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300' : 'border-transparent text-slate-600 dark:text-slate-400'}`}>Mock Tests</button>
      </div>

      {activeTab === 'mock-tests' ? <MockTestsLibrary /> : <section aria-labelledby="recent-interviews-title" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="recent-interviews-title" className="text-lg font-semibold text-slate-900 dark:text-white">Recent attempts</h2>
          <Button variant="ghost" size="sm" onClick={() => void loadSessions()} isLoading={loading}>Refresh</Button>
        </div>
        {loading && sessions.length === 0 && <p role="status" className="text-sm text-slate-500">Loading your interviews…</p>}
        {!loading && sessions.length === 0 && !error && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <Sparkles className="h-8 w-8 text-indigo-500" aria-hidden="true" />
              <p className="font-semibold text-slate-900 dark:text-white">No interview attempts yet</p>
              <p className="max-w-md text-sm text-slate-600 dark:text-slate-400">Choose a category and interview style to start your first practice session.</p>
              <Link to={routes.interviewSetup()} className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-indigo-700 hover:underline dark:text-indigo-300">
                Set up an interview <ArrowRight className="h-4 w-4" />
              </Link>
            </CardContent>
          </Card>
        )}
        {sessions.slice(0, 4).map((session) => (
          <Card key={session.id}>
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">
                  {session.category.replaceAll('_', ' ')} · {session.session_type === 'PRACTICE' ? 'Practice' : 'Assessment'}
                </p>
                <p className="mt-1 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <Clock3 className="h-4 w-4" aria-hidden="true" /> {formatDate(session.created_at)} · {session.question_count} questions
                </p>
                <p className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-300">{session.status.replaceAll('_', ' ')}</p>
              </div>
              <Link to={sessionDestination(session)} className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-950/40 sm:self-auto">
                {session.status === 'CREATED' || session.status === 'IN_PROGRESS' ? 'Continue' : 'View report'}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </CardContent>
          </Card>
        ))}
        {sessions.length > 4 && (
          <Link to={routes.interviewHistory} className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-700 hover:underline dark:text-indigo-300">
            See all attempts <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </section>}
    </InterviewPageLayout>
  )
}
