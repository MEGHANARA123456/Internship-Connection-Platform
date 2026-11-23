import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card, CardContent } from '../../components/ui/Card'
import { InterviewErrorNotice, useInterviewError } from '../../components/interviews/InterviewErrorNotice'
import { InterviewFeedback } from '../../components/interviews/InterviewFeedback'
import { InterviewPageLayout } from '../../components/interviews/InterviewPageLayout'
import { InterviewVideoRecordingPanel } from '../../components/interviews/InterviewVideoRecordingPanel'
import { routes } from '../../lib/routes'
import {
  retryAfterSecondsFromError,
  studentProviderFailureMessage,
} from '../../lib/interviewProviderErrors'
import {
  getInterviewReport,
  getInterviewSession,
  getInterviewProviderAvailability,
  retryInterviewEvaluation,
} from '../../services/interviewService'
import type { InterviewReport, InterviewSession } from '../../types/interview'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'

export function InterviewReportPage() {
  const { sessionId: rawSessionId } = useParams()
  const sessionId = Number(rawSessionId)
  const requestError = useInterviewError()
  const [session, setSession] = useState<InterviewSession | null>(null)
  const [report, setReport] = useState<InterviewReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState('')
  const [providerAvailable, setProviderAvailable] = useState<boolean | null>(null)
  const [retryWait, setRetryWait] = useState(0)

  useEffect(() => {
    if (retryWait <= 0) return
    const timer = window.setTimeout(() => setRetryWait((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [retryWait])

  const loadReport = useCallback(async (silent = false) => {
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      if (!silent) {
        setError('This report URL is invalid.')
        setLoading(false)
      }
      return
    }
    if (!silent) {
      setLoading(true)
      setError('')
    }
    try {
      const detail = await getInterviewSession(sessionId)
      setSession(detail.session)
      setError('')
      if (detail.session.status === 'EXPIRED') {
        setReport(null)
        return
      }
      if (!['EVALUATION_PENDING', 'EVALUATION_FAILED', 'COMPLETED', 'TERMINATED'].includes(detail.session.status)) {
        setReport(null)
        return
      }
      const reportData = await getInterviewReport(sessionId)
      setReport(reportData)
      setRetryWait(reportData.retry_after_seconds ?? 0)
    } catch (loadError) {
      if (!silent) setError(requestError(loadError, routes.interviewReport(sessionId)))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [requestError, sessionId])

  useEffect(() => {
    void loadReport()
  }, [loadReport])
  const evaluationNeedsProvider = session?.status === 'EVALUATION_FAILED' || report?.status === 'FAILED'
  useEffect(() => {
    if (!evaluationNeedsProvider) {
      setProviderAvailable(null)
      return
    }

    let active = true
    const checkAvailability = async () => {
      try {
        const status = await getInterviewProviderAvailability()
        if (active) {
          setProviderAvailable(status.available)
          setRetryWait(status.retry_after_seconds ?? 0)
        }
      } catch {
        if (active) {
          setProviderAvailable(false)
          setRetryWait(0)
        }
      }
    }
    void checkAvailability()
    const interval = window.setInterval(() => void checkAvailability(), 30_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [evaluationNeedsProvider])
  useAutoRefresh(
    () => loadReport(true),
    15_000,
    session?.status === 'EVALUATION_PENDING' && !retrying,
  )

  const retryEvaluation = async () => {
    setRetrying(true)
    setError('')
    try {
      await retryInterviewEvaluation(sessionId)
      setRetryWait(0)
      await loadReport(true)
    } catch (retryError) {
      setRetryWait(retryAfterSecondsFromError(retryError))
      setError(requestError(retryError, routes.interviewReport(sessionId)))
    } finally {
      setRetrying(false)
    }
  }

  const studySuggestions = useMemo(() => {
    const suggestions = report?.evaluations.flatMap((item) => item.evaluation?.improvements ?? []) ?? []
    return [...new Set(suggestions)]
  }, [report])

  if (loading) {
    return <main className="mx-auto w-full max-w-4xl px-4 py-10"><p role="status">Loading your report…</p></main>
  }

  if (session?.status === 'EXPIRED') {
    return (
      <InterviewPageLayout title="Interview expired" description="This session passed its time limit. Its saved answers remain in your history.">
        {error && <InterviewErrorNotice message={error} onRetry={() => void loadReport()} />}
        {session.interview_mode === 'VIDEO' && <InterviewVideoRecordingPanel sessionId={session.id} />}
        <Link to={routes.interviewHistory} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Back to interview history</Link>
      </InterviewPageLayout>
    )
  }

  if (session && !report && ['CREATED', 'IN_PROGRESS'].includes(session.status)) {
    return (
      <InterviewPageLayout title="Interview not completed" description="Finish the interview before opening its report.">
        {error && <InterviewErrorNotice message={error} onRetry={() => void loadReport()} />}
        <Link to={routes.interviewSession(session.id)} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Continue interview</Link>
      </InterviewPageLayout>
    )
  }

  if (!session || !report) {
    return (
      <InterviewPageLayout title="Report unavailable">
        <InterviewErrorNotice message={error || 'A report could not be loaded for this session.'} onRetry={() => void loadReport()} retrying={loading} />
        <Link to={routes.interviewHistory} className="text-sm font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Back to interview history</Link>
      </InterviewPageLayout>
    )
  }

  const pending = session.status === 'EVALUATION_PENDING' || report.status === 'PENDING'
  const terminated = session.status === 'TERMINATED'
  const failed = !terminated && (session.status === 'EVALUATION_FAILED' || report.status === 'FAILED')
  const completed = session.status === 'COMPLETED' && report.status === 'COMPLETED'
  const completedEvaluations = report.evaluations.filter((item) => item.evaluation_status === 'COMPLETED')
  const failedEvaluations = report.evaluations.filter((item) => item.evaluation_status === 'FAILED')

  return (
    <InterviewPageLayout
      title="Interview report"
      description={`${session.category.replaceAll('_', ' ')} · ${session.session_type === 'PRACTICE' ? 'Practice' : 'Assessment'} · ${report.answer_count} answer(s)`}
      actions={(
        <>
          <Link to={routes.interviewHistory} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900">History</Link>
          <Link to={routes.interviewSetup({ retake_of_session_id: session.id })} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Retake</Link>
        </>
      )}
    >
      {error && <InterviewErrorNotice message={error} onRetry={() => void loadReport()} retrying={loading} />}
      {session.interview_mode === 'VIDEO' && report.video_metrics && (
        <section aria-label="Video interview duration" className="rounded-xl border border-violet-200 bg-violet-50/70 p-4 dark:border-violet-900 dark:bg-violet-950/30">
          <h2 className="font-semibold text-violet-950 dark:text-violet-100">Video session duration</h2>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
            {(report.video_metrics.session_duration_seconds / 60).toFixed(1)} minutes. This is session elapsed time, not an appearance or performance score.
          </p>
        </section>
      )}

      {pending && (
        <div role="status" className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
          <p>Evaluation is pending. Refresh this page to check for your results.</p>
          <Button variant="outline" size="sm" isLoading={loading} onClick={() => void loadReport()}>Refresh report</Button>
        </div>
      )}

      {failed && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">Evaluation failed</p>
            <p className="mt-1">
              {studentProviderFailureMessage(
                report.failure_code ?? failedEvaluations.find((item) => item.failure_code)?.failure_code,
              )}
            </p>
          </div>
          <Button variant="outline" isLoading={retrying} disabled={retrying || retryWait > 0 || providerAvailable !== true} onClick={() => void retryEvaluation()}>
            {retryWait > 0 ? `Try again in ${retryWait}s` : 'Retry evaluation'}
          </Button>
        </div>
      )}

      {terminated && (
        <section aria-label="Proctoring termination" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <h2 className="font-semibold">Terminated – proctoring violations</h2>
          <p className="mt-1">Events are flagged for review and are not treated as proof of misconduct.</p>
        </section>
      )}

      {report.proctoring_summary && (
        <section aria-label="Proctoring violations summary" className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-semibold text-slate-900 dark:text-white">Proctoring summary</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {report.proctoring_summary.violation_count} violation(s) recorded · {Math.round(report.proctoring_summary.total_time_away_ms / 1000)} seconds away
          </p>
          {Object.keys(report.proctoring_summary.types).length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
              {Object.entries(report.proctoring_summary.types).map(([type, count]) => (
                <li key={type}>{type.replaceAll('_', ' ').toLowerCase()}: {count}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {completed && typeof report.overall_score === 'number' && (
        <Card>
          <CardContent className="flex flex-col gap-3 py-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Overall score</p>
              <p className="mt-1 text-4xl font-bold text-indigo-700 dark:text-indigo-300">{report.overall_score}<span className="text-xl text-slate-500">/100</span></p>
            </div>
            {report.summary && <p className="max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">{report.summary}</p>}
          </CardContent>
        </Card>
      )}

      {completed && typeof report.overall_score !== 'number' && (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          The report is marked complete but does not contain a score. No score will be displayed until the server provides one.
        </p>
      )}

      {failed && report.evaluations.length > 0 && (
        <p role="status" className="text-sm text-slate-600 dark:text-slate-300">
          {completedEvaluations.length} answer(s) evaluated successfully; {failedEvaluations.length} answer(s) still need evaluation. No overall score is shown for a partial report.
        </p>
      )}

      {report.rubric_scores && (
        <section aria-labelledby="rubric-summary-title">
          <h2 id="rubric-summary-title" className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">Rubric averages</h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {Object.entries(report.rubric_scores).map(([name, value]) => (
              <div key={name} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <dt className="text-xs capitalize text-slate-500 dark:text-slate-400">{name.replaceAll('_', ' ')}</dt>
                <dd className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{value}/10</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {completed && Object.keys(report.skill_breakdown ?? {}).length > 0 && (
        <section aria-labelledby="skill-breakdown-title">
          <h2 id="skill-breakdown-title" className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">Skill breakdown</h2>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(report.skill_breakdown ?? {}).map(([skill, score]) => (
              <div key={skill} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <dt className="text-sm font-medium text-slate-600 dark:text-slate-300">{skill.replaceAll('-', ' ').replaceAll('_', ' ')}</dt>
                <dd className="mt-1 text-xl font-bold text-indigo-700 dark:text-indigo-300">{score}/100</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {(session.interview_mode === 'VOICE' || session.interview_mode === 'VIDEO') && report.voice_metrics && (
        <section aria-labelledby="voice-metrics-title" className="rounded-xl border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-900 dark:bg-sky-950/30">
          <h2 id="voice-metrics-title" className="font-semibold text-sky-950 dark:text-sky-100">Speaking insights</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-600 dark:text-slate-300">Recorded time</dt>
              <dd className="mt-1 font-semibold">{report.voice_metrics.total_duration_seconds.toFixed(1)} sec</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-600 dark:text-slate-300">Transcript words</dt>
              <dd className="mt-1 font-semibold">{report.voice_metrics.total_word_count}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-600 dark:text-slate-300">Speaking pace</dt>
              <dd className="mt-1 font-semibold">
                {report.voice_metrics.average_speaking_pace_wpm === null
                  ? 'Not available'
                  : `${report.voice_metrics.average_speaking_pace_wpm} words/min`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-600 dark:text-slate-300">Filler words</dt>
              <dd className="mt-1 font-semibold">{report.voice_metrics.total_filler_word_count}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">These deterministic counts use the confirmed transcript; they are practice signals, not personality or hiring judgments.</p>
        </section>
      )}
      {session.interview_mode === 'VIDEO' && (
        <InterviewVideoRecordingPanel sessionId={session.id} />
      )}

      {studySuggestions.length > 0 && (
        <section className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
          <h2 className="font-semibold text-indigo-950 dark:text-indigo-100">Study suggestions</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-700 dark:text-slate-300">
            {studySuggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}
          </ul>
        </section>
      )}

      <section aria-labelledby="answer-reviews-title" className="space-y-4">
        <h2 id="answer-reviews-title" className="text-lg font-semibold text-slate-900 dark:text-white">Question-by-question review</h2>
        {report.evaluations.map((item) => (
          <Card key={`${item.question_id}-${item.position}`}>
            <CardContent className="space-y-4 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">Question {item.position}</p>
                <h3 className="mt-1 font-semibold text-slate-900 dark:text-white">{item.prompt}</h3>
                {item.skill_tags && item.skill_tags.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Skills: {item.skill_tags.map((skill) => skill.replaceAll('-', ' ').replaceAll('_', ' ')).join(', ')}</p>
                )}
                <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{item.answer_text}</p>
                {(session.interview_mode === 'VOICE' || session.interview_mode === 'VIDEO') && item.word_count !== null && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    {item.word_count} words · {item.filler_word_count ?? 0} filler words
                    {item.duration_seconds !== null
                      ? ` · ${item.duration_seconds.toFixed(1)} sec · ${item.speaking_pace_wpm ?? '—'} words/min`
                      : ' · duration not recorded (text fallback)'}
                  </p>
                )}
              </div>
              {item.evaluation
                ? <InterviewFeedback evaluation={item.evaluation} />
                : <p role="status" className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {item.evaluation_status === 'PENDING'
                      ? 'This answer is waiting for evaluation.'
                      : 'This answer could not be evaluated yet. Use Retry evaluation above.'}
                  </p>}
            </CardContent>
          </Card>
        ))}
        {report.evaluations.length === 0 && (
          <Card><CardContent className="py-5 text-sm text-slate-600 dark:text-slate-300">No answer reviews are available yet.</CardContent></Card>
        )}
      </section>
    </InterviewPageLayout>
  )
}
