import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertCircle, Award, Download, History, LoaderCircle } from 'lucide-react'
import { api } from '../api/client'
import { routes } from '../lib/routes'

interface AssessmentQuestionResult {
  question_id: number
  prompt: string
  subtopic: string
  difficulty: string
  selected_answer: string | string[]
  correct_answer: string | string[]
  explanation: string
  is_correct: boolean
  earned_credit: number
  time_seconds: number
}

interface AssessmentResult {
  attempt_id: number
  topic: string
  attempt_number: number
  score: number
  raw_score: number
  weighted_percentage: number
  level: string
  passed: boolean
  percentile: number | string
  time_taken_seconds: number
  submitted_at: string
  retake_at: string
  badge: { title: string; level: string; expires_at: string } | null
  questions: AssessmentQuestionResult[]
  subtopic_scores: Record<string, { earned: number; possible: number; percentage: number }>
  difficulty_scores: Record<string, { correct: number; total: number; percentage: number }>
  strengths: string[]
  weak_subtopics: Array<{
    subtopic: string
    tip: string
    learning_links: Array<{ title: string; url: string }>
  }>
  matching_internships: Array<{ id: number; title: string; matched_skills: string[] }>
}

interface HistoryAttempt {
  attempt_id: number
  topic: string
  attempt_number: number
  score: number
  weighted_percentage: number
  passed: boolean
  submitted_at: string
  change_from_previous: number | null
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatAnswer(answer: string | string[]): string {
  return Array.isArray(answer) ? answer.join(', ') || 'No option selected' : answer
}

function requestError(error: unknown): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' ? detail : 'The assessment data could not be loaded. Please try again.'
}

function PageLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-indigo-600 dark:text-indigo-300">
      <LoaderCircle className="h-6 w-6 animate-spin" aria-label="Loading" />
    </div>
  )
}

export function SkillAssessmentResultPage() {
  const { attemptId } = useParams()
  const [result, setResult] = useState<AssessmentResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    api.get(`/skills/assessments/${attemptId}/result`)
      .then(({ data }) => {
        if (active) setResult(data as AssessmentResult)
      })
      .catch((loadError: unknown) => {
        if (active) setError(requestError(loadError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [attemptId])

  const downloadReport = async () => {
    if (!result) return
    setDownloading(true)
    setError('')
    try {
      const { data } = await api.get(`/skills/assessments/${result.attempt_id}/report.pdf`, {
        responseType: 'blob',
      })
      const objectUrl = URL.createObjectURL(data as Blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = `skill-assessment-${result.attempt_id}.pdf`
      anchor.click()
      URL.revokeObjectURL(objectUrl)
    } catch (downloadError) {
      setError(requestError(downloadError))
    } finally {
      setDownloading(false)
    }
  }

  if (loading) return <PageLoading />
  if (!result) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-10">
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {error || 'Assessment result not found.'}
        </div>
        <Link className="mt-4 inline-block text-sm font-semibold text-indigo-600 dark:text-indigo-300" to={routes.skillHistory}>Back to assessment history</Link>
      </main>
    )
  }

  const subtopics = Object.entries(result.subtopic_scores).map(([name, value]) => ({
    name: name.replaceAll('-', ' '),
    percentage: value.percentage,
  }))
  const difficulties = Object.entries(result.difficulty_scores).map(([name, value]) => ({
    name: name.toLowerCase(),
    percentage: value.percentage,
  }))

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-300">Skill assessment report</p>
          <h1 className="mt-1 text-2xl font-bold capitalize text-slate-900 dark:text-white">{result.topic.replaceAll('-', ' ')}</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Attempt {result.attempt_number} · Completed {formatDate(result.submitted_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={downloading} onClick={() => void downloadReport()} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900">
            <Download className="h-4 w-4" /> {downloading ? 'Preparing…' : 'Download PDF'}
          </button>
          <Link to={routes.skillHistory} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            <History className="h-4 w-4" /> History
          </Link>
        </div>
      </header>

      {error && <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Assessment score summary">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Weighted score</p>
          <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-white">{result.weighted_percentage}%</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Level</p>
          <p className="mt-2 text-2xl font-bold text-indigo-700 dark:text-indigo-300">{result.level}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Result</p>
          <p className={`mt-2 text-2xl font-bold ${result.passed ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
            {result.passed ? 'Passed' : 'Not passed'}
          </p>
          <p className="mt-1 text-xs text-slate-500">Raw score: {result.raw_score}/10</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Time · percentile</p>
          <p className="mt-2 text-xl font-bold text-slate-900 dark:text-white">{Math.floor(result.time_taken_seconds / 60)}m {result.time_taken_seconds % 60}s</p>
          <p className="mt-1 text-xs text-slate-500">{typeof result.percentile === 'number' ? `${result.percentile}th percentile` : result.percentile}</p>
        </article>
      </section>

      {result.badge && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          <Award className="h-5 w-5 shrink-0" />
          <div className="text-sm"><strong>{result.badge.title}</strong> · {result.badge.level} · Expires {formatDate(result.badge.expires_at)}</div>
        </div>
      )}

      <section className="mt-6 grid gap-5 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-base font-bold text-slate-900 dark:text-white">Performance by subtopic</h2>
          <div className="h-64" role="img" aria-label="Bar chart of performance by subtopic">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={subtopics} margin={{ top: 8, right: 8, left: -20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#64748b" opacity={0.2} />
                <XAxis dataKey="name" angle={-20} textAnchor="end" interval={0} height={55} tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(value) => [`${value}%`, 'Score']} />
                <Bar dataKey="percentage" fill="#6366f1" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-base font-bold text-slate-900 dark:text-white">Performance by difficulty</h2>
          <div className="h-64" role="img" aria-label="Bar chart of performance by difficulty">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={difficulties} margin={{ top: 8, right: 8, left: -20, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#64748b" opacity={0.2} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(value) => [`${value}%`, 'Score']} />
                <Bar dataKey="percentage" fill="#0d9488" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="mt-6 grid gap-5 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Strengths and study plan</h2>
          <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">
            Strengths: {result.strengths.length ? result.strengths.map((value) => value.replaceAll('-', ' ')).join(', ') : 'Keep practicing to build topic strengths.'}
          </p>
          {result.weak_subtopics.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">No weak subtopics detected in this attempt.</p>
          ) : (
            <div className="mt-4 space-y-4">
              {result.weak_subtopics.map((weak) => (
                <div key={weak.subtopic} className="rounded-xl bg-amber-50 p-4 dark:bg-amber-950/30">
                  <h3 className="font-semibold capitalize text-amber-900 dark:text-amber-200">{weak.subtopic.replaceAll('-', ' ')}</h3>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{weak.tip}</p>
                  {weak.learning_links.length > 0 && (
                    <ul className="mt-2 list-inside list-disc text-sm">
                      {weak.learning_links.map((resource) => (
                        <li key={resource.url}><a href={resource.url} target="_blank" rel="noreferrer" className="text-indigo-700 underline dark:text-indigo-300">{resource.title}</a></li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">Recommended retake after {formatDate(result.retake_at)}.</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Internships matching verified skills</h2>
          {!result.passed ? (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">Pass this assessment to see internships matched to the verified skill.</p>
          ) : result.matching_internships.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">No open matching internships are available right now.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-200 dark:divide-slate-800">
              {result.matching_internships.map((internship) => (
                <li key={internship.id} className="py-3">
                  <Link to={routes.opportunity(internship.id)} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">{internship.title}</Link>
                  <p className="mt-1 text-xs text-slate-500">Matched skills: {internship.matched_skills.join(', ')}</p>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">Question review</h2>
        <div className="mt-3 space-y-3">
          {result.questions.map((question, index) => (
            <article key={question.question_id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{index + 1}. {question.prompt}</h3>
                <span className="text-xs text-slate-500">{question.difficulty.toLowerCase()} · {question.time_seconds}s · {question.earned_credit} credit</span>
              </div>
              <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">Your answer: {formatAnswer(question.selected_answer)}</p>
              <p className="mt-1 text-sm text-indigo-700 dark:text-indigo-300">Correct answer: {formatAnswer(question.correct_answer)}</p>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{question.explanation}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

export function SkillAssessmentHistoryPage() {
  const [attempts, setAttempts] = useState<HistoryAttempt[]>([])
  const [topic, setTopic] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    api.get('/skills/history')
      .then(({ data }) => {
        if (!active) return
        const values = (data?.attempts ?? []) as HistoryAttempt[]
        setAttempts(values)
        setTopic(values[0]?.topic ?? '')
      })
      .catch((loadError: unknown) => {
        if (active) setError(requestError(loadError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  const topics = useMemo(() => [...new Set(attempts.map((attempt) => attempt.topic))], [attempts])
  const chartData = attempts
    .filter((attempt) => attempt.topic === topic)
    .map((attempt, index) => ({
      label: `Attempt ${index + 1}`,
      score: attempt.weighted_percentage,
      date: formatDate(attempt.submitted_at),
    }))

  if (loading) return <PageLoading />
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-300">Your progress</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">Assessment history</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Track your weighted score over time for each skill topic.</p>
      </header>
      {error && <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}
      {attempts.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <AlertCircle className="mx-auto h-8 w-8 text-slate-400" />
          <h2 className="mt-3 font-semibold text-slate-900 dark:text-white">No completed assessments yet</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Take an assessment to start tracking your progress.</p>
          <Link to={routes.studentProfile} className="mt-4 inline-flex rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">Go to profile</Link>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2" aria-label="Choose a topic">
            {topics.map((item) => (
              <button key={item} type="button" aria-pressed={topic === item} onClick={() => setTopic(item)} className={`rounded-full px-4 py-2 text-sm font-semibold capitalize ${topic === item ? 'bg-indigo-600 text-white' : 'border border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>
                {item.replaceAll('-', ' ')}
              </button>
            ))}
          </div>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-3 text-base font-bold capitalize text-slate-900 dark:text-white">{topic.replaceAll('-', ' ')} score trend</h2>
            <div className="h-72" role="img" aria-label={`Score-over-time chart for ${topic}`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#64748b" opacity={0.2} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => [`${value}%`, 'Weighted score']} labelFormatter={(label, values) => `${label}${values[0]?.payload?.date ? ` · ${values[0].payload.date}` : ''}`} />
                  <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={3} dot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <h2 className="p-5 text-base font-bold text-slate-900 dark:text-white">Completed attempts</h2>
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {attempts.filter((attempt) => attempt.topic === topic).slice().reverse().map((attempt) => (
                <li key={attempt.attempt_id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-white">Attempt {attempt.attempt_number} · {attempt.weighted_percentage}%</p>
                    <p className="text-xs text-slate-500">{formatDate(attempt.submitted_at)} · {attempt.passed ? 'Passed' : 'Not passed'}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {attempt.change_from_previous !== null && (
                      <span className={`text-sm font-semibold ${attempt.change_from_previous >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                        {attempt.change_from_previous >= 0 ? '+' : ''}{attempt.change_from_previous} points since previous
                      </span>
                    )}
                    <Link to={routes.skillResult(attempt.attempt_id)} className="text-sm font-semibold text-indigo-700 hover:underline dark:text-indigo-300">View report</Link>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  )
}
