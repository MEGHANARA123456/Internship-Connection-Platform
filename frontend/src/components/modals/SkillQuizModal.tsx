import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import {
  AlertCircle,
  Atom,
  Award,
  Braces,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Cloud,
  Code2,
  Database,
  Shield,
  Sparkles,
  Waypoints,
  type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { routes } from '../../lib/routes'

interface SkillTopic {
  id: string
  name: string
  icon: string
  description: string
  question_count: number
  duration_seconds: number
  pass_percentage: number
  available: boolean
  unavailable_reason: string | null
  question_counts: Record<string, number>
}

interface SkillAttemptSummary {
  id?: number
  attempt_id?: number
  topic: string
  score: number | null
  weighted_percentage: number | null
  passed: boolean | null
  status?: string
  started_at?: string
  submitted_at: string | null
  subtopic_scores?: Record<string, { percentage: number }>
}

interface SkillBadgeSummary {
  topic: string
  valid: boolean
  expires_soon: boolean
  expires_at: string
}

interface AssessmentQuestion {
  id: number
  prompt: string
  options: string[]
  difficulty: string
  subtopic: string
  question_type: 'SINGLE' | 'MULTI' | 'TRUE_FALSE'
}

interface AssessmentAttempt {
  attempt_id: number
  topic: string
  started_at: string
  expires_at: string
  duration_seconds: number
  remaining_seconds: number
  resumed: boolean
  answers: Array<QuizAnswer | null> | null
  questions: AssessmentQuestion[]
}

interface AssessmentExplanation {
  question_id: number
  prompt: string
  selected_answer: string | string[]
  correct_answer: string | string[]
  explanation: string
  is_correct: boolean
  earned_credit: number
  time_seconds: number
}

interface AssessmentResult {
  attempt_id: number
  raw_score: number
  score: number
  weighted_percentage: number
  passed: boolean
  level: string
  percentile: number | string
  time_taken_seconds: number
  badge: {
    topic: string
    title: string
    level: string
    score: number
    earned_at: string
    expires_at: string
  } | null
  questions: AssessmentExplanation[]
}

type QuizAnswer = number | number[]

function hasAnswer(answer: QuizAnswer | undefined): boolean {
  return Array.isArray(answer) ? answer.length > 0 : typeof answer === 'number' && answer >= 0
}

function answerText(answer: string | string[]): string {
  return Array.isArray(answer) ? answer.join(', ') || 'No option selected' : answer
}

interface SkillQuizModalProps {
  isOpen: boolean
  onClose: () => void
  onBadgeAwarded?: (badge: AssessmentResult['badge']) => void
  initialTopic?: string | null
}

function errorMessage(error: unknown): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (detail && typeof detail === 'object') {
    const problem = detail as { code?: unknown; next_available_at?: unknown; detail?: unknown }
    if (
      (problem.code === 'COOLDOWN' || problem.code === 'WEEKLY_LIMIT')
      && typeof problem.next_available_at === 'string'
    ) {
      return `${typeof problem.detail === 'string' ? problem.detail : 'You can start another assessment'} Available on ${formatDateTime(problem.next_available_at)}.`
    }
  }
  return typeof detail === 'string' ? detail : 'The assessment request failed. Please try again.'
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const TOPIC_ICONS: Record<string, LucideIcon> = {
  python: Code2,
  react: Atom,
  sql: Database,
  dsa: Waypoints,
  ai: BrainCircuit,
  devops: Cloud,
  security: Shield,
  typescript: Braces,
  mongodb: Database,
}

function topicIcon(topic: string): LucideIcon {
  return TOPIC_ICONS[topic.toLowerCase()] ?? Sparkles
}

function nextRetakeDate(topic: string, attempts: SkillAttemptSummary[], now: number): Date | null {
  const topicAttempts = attempts.filter((attempt) => attempt.topic === topic)
  let blockedUntil = 0
  const lastForTopic = topicAttempts.reduce<SkillAttemptSummary | null>(
    (latest, attempt) => {
      const startedAt = Date.parse(attempt.started_at ?? '')
      return !latest || startedAt > Date.parse(latest.started_at ?? '') ? attempt : latest
    },
    null,
  )
  if (lastForTopic) {
    blockedUntil = Date.parse(lastForTopic.started_at ?? '') + 24 * 60 * 60 * 1000
  }
  const recentAttempts = attempts
    .map((attempt) => Date.parse(attempt.started_at ?? ''))
    .filter((startedAt) => Number.isFinite(startedAt) && startedAt > now - 7 * 24 * 60 * 60 * 1000)
    .sort((left, right) => left - right)
  if (recentAttempts.length >= 3) {
    blockedUntil = Math.max(blockedUntil, recentAttempts[0] + 7 * 24 * 60 * 60 * 1000)
  }
  return blockedUntil > now ? new Date(blockedUntil) : null
}

function hoursUntil(value: Date, now: number): number {
  return Math.max(1, Math.ceil((value.getTime() - now) / (60 * 60 * 1000)))
}

function AssessmentCardSkeleton() {
  return (
    <div aria-hidden="true" className="h-52 animate-pulse rounded-2xl border border-slate-200 bg-slate-100 p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="h-4 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
      <div className="mt-4 h-3 w-full rounded bg-slate-200 dark:bg-slate-700" />
      <div className="mt-2 h-3 w-4/5 rounded bg-slate-200 dark:bg-slate-700" />
      <div className="mt-8 h-9 rounded-lg bg-slate-200 dark:bg-slate-700" />
    </div>
  )
}

export function SkillQuizModal({ isOpen, onClose, onBadgeAwarded, initialTopic }: SkillQuizModalProps) {
  const [topics, setTopics] = useState<SkillTopic[]>([])
  const [loadingTopics, setLoadingTopics] = useState(false)
  const [topicsError, setTopicsError] = useState(false)
  const [statsError, setStatsError] = useState(false)
  const [activeAttemptsError, setActiveAttemptsError] = useState(false)
  const [history, setHistory] = useState<SkillAttemptSummary[]>([])
  const [badges, setBadges] = useState<SkillBadgeSummary[]>([])
  const [attemptSummaries, setAttemptSummaries] = useState<SkillAttemptSummary[]>([])
  const [overviewLoadedAt, setOverviewLoadedAt] = useState(0)
  const [activeAttempts, setActiveAttempts] = useState<Record<string, AssessmentAttempt>>({})
  const [attempt, setAttempt] = useState<AssessmentAttempt | null>(null)
  const [result, setResult] = useState<AssessmentResult | null>(null)
  const [answers, setAnswers] = useState<QuizAnswer[]>([])
  const [answersDirty, setAnswersDirty] = useState(false)
  const answersRevision = useRef(0)
  const [questionTimes, setQuestionTimes] = useState<number[]>([])
  const questionStartedAt = useRef(0)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [expired, setExpired] = useState(false)
  const remainingDeadline = useRef(0)
  const overviewRequest = useRef(0)

  const loadAssessmentOverview = useCallback(async () => {
    const requestId = ++overviewRequest.current
    setLoadingTopics(true)
    setTopicsError(false)
    setStatsError(false)
    setActiveAttemptsError(false)
    const [topicsResult, historyResult, badgesResult, attemptsResult] = await Promise.allSettled([
      api.get('/skills/topics'),
      api.get('/skills/history'),
      api.get('/skills/badges'),
      api.get('/skills/attempts'),
    ])
    if (requestId !== overviewRequest.current) return
    setOverviewLoadedAt(Date.now())
    const availableTopics = topicsResult.status === 'fulfilled' && Array.isArray(topicsResult.value.data)
      ? topicsResult.value.data as SkillTopic[]
      : []
    setTopics(availableTopics)
    setTopicsError(
      topicsResult.status === 'rejected'
      || !Array.isArray(topicsResult.status === 'fulfilled' ? topicsResult.value.data : null),
    )
    if (historyResult.status === 'fulfilled') {
      const attempts = historyResult.value.data?.attempts
      setHistory(Array.isArray(attempts) ? attempts as SkillAttemptSummary[] : [])
    }
    if (badgesResult.status === 'fulfilled') {
      setBadges(Array.isArray(badgesResult.value.data) ? badgesResult.value.data as SkillBadgeSummary[] : [])
    }
    if (attemptsResult.status === 'fulfilled') {
      setAttemptSummaries(Array.isArray(attemptsResult.value.data) ? attemptsResult.value.data as SkillAttemptSummary[] : [])
    }
    setStatsError(
      historyResult.status === 'rejected'
      || badgesResult.status === 'rejected'
      || attemptsResult.status === 'rejected'
      || (historyResult.status === 'fulfilled' && !Array.isArray(historyResult.value.data?.attempts))
      || (badgesResult.status === 'fulfilled' && !Array.isArray(badgesResult.value.data))
      || (attemptsResult.status === 'fulfilled' && !Array.isArray(attemptsResult.value.data)),
    )
    if (topicsResult.status === 'fulfilled' && availableTopics.length > 0) {
      const activeResults = await Promise.allSettled(availableTopics.map(async (topic) => {
        const response = await api.get('/skills/assessments/active', { params: { topic: topic.id } })
        return [topic.id, response.data as AssessmentAttempt | null] as const
      }))
      if (requestId !== overviewRequest.current) return
      const attemptsByTopic: Record<string, AssessmentAttempt> = {}
      activeResults.forEach((result) => {
        const activeAttempt = result.status === 'fulfilled' ? result.value[1] : null
        if (result.status === 'fulfilled' && activeAttempt && activeAttempt.remaining_seconds > 0) {
          attemptsByTopic[result.value[0]] = activeAttempt
        }
      })
      setActiveAttempts(attemptsByTopic)
      setActiveAttemptsError(activeResults.some((result) => result.status === 'rejected'))
    } else {
      setActiveAttempts({})
    }
    if (requestId === overviewRequest.current) setLoadingTopics(false)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    void loadAssessmentOverview()
    return () => { overviewRequest.current += 1 }
  }, [isOpen, loadAssessmentOverview])

  const openAttempt = (startedAttempt: AssessmentAttempt) => {
    const initialAnswers = startedAttempt.questions.map((question, index) => {
      const saved = startedAttempt.answers?.[index]
      if (saved !== null && saved !== undefined) return saved
      return question.question_type === 'MULTI' ? [] : -1
    })
    const firstUnanswered = initialAnswers.findIndex((answer) => !hasAnswer(answer))
    setAttempt(startedAttempt)
    setAnswers(initialAnswers)
    setAnswersDirty(false)
    answersRevision.current += 1
    setQuestionTimes(Array(startedAttempt.questions.length).fill(0))
    setQuestionIndex(firstUnanswered >= 0 ? firstUnanswered : 0)
    const remaining = Math.max(0, startedAttempt.remaining_seconds)
    remainingDeadline.current = Date.now() + remaining * 1000
    setSecondsLeft(remaining)
    setResult(null)
    setExpired(false)
  }

  useEffect(() => {
    if (!attempt || result || expired) return
    questionStartedAt.current = Date.now()
  }, [questionIndex, attempt, result, expired])

  useEffect(() => {
    if (!attempt || result || expired) return
    const updateCountdown = () => {
      const deadline = remainingDeadline.current || Date.parse(attempt.expires_at)
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setSecondsLeft(remaining)
      if (remaining === 0) {
        setExpired(true)
        setError('Time is up. Late submissions are not accepted.')
      }
    }
    updateCountdown()
    const interval = window.setInterval(updateCountdown, 1000)
    return () => window.clearInterval(interval)
  }, [attempt, result, expired])

  const startAssessment = async (topic: string) => {
    setError('')
    setSubmitting(true)
    try {
      const { data } = await api.post('/skills/assessments/start', { topic })
      const startedAttempt = data as AssessmentAttempt
      openAttempt(startedAttempt)
      setActiveAttempts((current) => ({ ...current, [topic]: startedAttempt }))
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  const resumeAttempt = (topic: string) => {
    const activeAttempt = activeAttempts[topic]
    if (activeAttempt) openAttempt(activeAttempt)
  }

  const submitAssessment = async () => {
    if (!attempt || answers.some((answer) => !hasAnswer(answer))) return
    setError('')
    setSubmitting(true)
    try {
      const finalQuestionTimes = [...questionTimes]
      finalQuestionTimes[questionIndex] = (finalQuestionTimes[questionIndex] || 0)
        + Math.max(0, Math.floor((Date.now() - questionStartedAt.current) / 1000))
      const { data } = await api.post(`/skills/assessments/${attempt.attempt_id}/submit`, {
        answers,
        question_time_seconds: finalQuestionTimes,
      })
      const assessmentResult = data as AssessmentResult
      setResult(assessmentResult)
      onBadgeAwarded?.(assessmentResult.badge)
    } catch (requestError) {
      const message = errorMessage(requestError)
      setError(message)
      if ((requestError as { response?: { status?: number } })?.response?.status === 410) {
        setExpired(true)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const reset = () => {
    setAttempt(null)
    setResult(null)
    setAnswers([])
    setQuestionTimes([])
    setQuestionIndex(0)
    setSecondsLeft(0)
    setError('')
    setExpired(false)
    void loadAssessmentOverview()
  }

  const captureQuestionTime = () => {
    const seconds = Math.max(0, Math.floor((Date.now() - questionStartedAt.current) / 1000))
    setQuestionTimes((current) => current.map((value, index) => (
      index === questionIndex ? value + seconds : value
    )))
  }

  const setQuestionAnswer = (optionIndex: number) => {
    if (!currentQuestion) return
    answersRevision.current += 1
    setAnswersDirty(true)
    setAnswers((current) => current.map((answer, index) => {
      if (index !== questionIndex) return answer
      if (currentQuestion.question_type !== 'MULTI') return optionIndex
      const selected = Array.isArray(answer) ? answer : []
      return selected.includes(optionIndex)
        ? selected.filter((value) => value !== optionIndex)
        : [...selected, optionIndex]
    }))
  }

  useEffect(() => {
    if (!attempt || !answersDirty || result || expired) return
    const snapshot = answers.map((answer) => (
      typeof answer === 'number' && answer < 0 ? null : answer
    ))
    const revision = answersRevision.current
    const timer = window.setTimeout(() => {
      api.put(`/skills/attempts/${attempt.attempt_id}/answers`, { answers: snapshot })
        .then(() => {
          if (answersRevision.current === revision) setAnswersDirty(false)
        })
        .catch((requestError: unknown) => setError(errorMessage(requestError)))
    }, 350)
    return () => window.clearTimeout(timer)
  }, [attempt, answers, answersDirty, result, expired])

  useEffect(() => {
    if (!attempt || result || expired) return
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [attempt, result, expired])

  const goToQuestion = (index: number) => {
    captureQuestionTime()
    setQuestionIndex(index)
  }

  const currentQuestion = attempt?.questions[questionIndex]
  const progress = attempt ? ((questionIndex + 1) / attempt.questions.length) * 100 : 0
  const completedAttempts = attemptSummaries.filter((summary) => summary.submitted_at)
  const completedForStats = completedAttempts.length ? completedAttempts : history
  const scores = completedForStats
    .map((summary) => summary.weighted_percentage)
    .filter((score): score is number => typeof score === 'number' && Number.isFinite(score))
  const averageScore = scores.length
    ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length)
    : null
  const bestScoresByTopic = new Map<string, number>()
  completedForStats.forEach((summary) => {
    if (typeof summary.weighted_percentage !== 'number') return
    bestScoresByTopic.set(
      summary.topic,
      Math.max(bestScoresByTopic.get(summary.topic) ?? 0, summary.weighted_percentage),
    )
  })
  const bestTopic = [...bestScoresByTopic.entries()].sort((left, right) => right[1] - left[1])[0]
  const validBadges = badges.filter((badge) => badge.valid)
  const expiringBadges = validBadges.filter((badge) => badge.expires_soon)
  const nextRetake = topics
    .map((topic) => nextRetakeDate(topic.id, attemptSummaries, overviewLoadedAt))
    .filter((date): date is Date => date !== null)
    .sort((left, right) => left.getTime() - right.getTime())[0]
  const subtopicAverages = new Map<string, { total: number; count: number }>()
  completedAttempts.forEach((summary) => {
    Object.entries(summary.subtopic_scores ?? {}).forEach(([name, value]) => {
      if (!Number.isFinite(value.percentage)) return
      const current = subtopicAverages.get(name) ?? { total: 0, count: 0 }
      subtopicAverages.set(name, { total: current.total + value.percentage, count: current.count + 1 })
    })
  })
  const strongestSubtopic = [...subtopicAverages.entries()]
    .map(([name, value]) => [name, value.total / value.count] as const)
    .sort((left, right) => right[1] - left[1])[0]
  const weakestSubtopic = [...subtopicAverages.entries()]
    .map(([name, value]) => [name, value.total / value.count] as const)
    .sort((left, right) => left[1] - right[1])[0]

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Verified Skill Assessment"
      description="Your answers are graded on the server. A score of 80% or higher earns a verified badge."
      maxWidth="5xl"
    >
      {!attempt ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 space-y-6">
            {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>}
            <section aria-labelledby="my-assessments-heading">
              <div className="mb-3">
                <h3 id="my-assessments-heading" className="text-base font-bold text-slate-900 dark:text-white">My Assessment</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Your attempted subjects, best score, and retake availability.</p>
              </div>
              {topicsError && (
                <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                  <span>Could not load assessment subjects.</span>
                  <button type="button" onClick={() => void loadAssessmentOverview()} className="rounded font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600">Retry</button>
                </div>
              )}
              {loadingTopics ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading attempted subjects">
                  <AssessmentCardSkeleton />
                  <AssessmentCardSkeleton />
                </div>
              ) : topics.filter((topic) => attemptSummaries.some((summary) => summary.topic === topic.id)).length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">You have not attempted a subject yet. Start an assessment below to track your progress.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {topics.filter((topic) => attemptSummaries.some((summary) => summary.topic === topic.id)).map((topic) => {
                    const topicAttempts = attemptSummaries.filter((summary) => summary.topic === topic.id)
                    const latestAttempt = topicAttempts.reduce<SkillAttemptSummary | null>(
                      (latest, summary) => !latest || Date.parse(summary.started_at ?? '') > Date.parse(latest.started_at ?? '') ? summary : latest,
                      null,
                    )
                    const topicCompletedAttempts = topicAttempts.filter((summary) => summary.submitted_at)
                    const topicScores = (topicCompletedAttempts.length ? topicCompletedAttempts : history.filter((summary) => summary.topic === topic.id))
                      .map((summary) => summary.weighted_percentage)
                      .filter((score): score is number => typeof score === 'number' && Number.isFinite(score))
                    const bestScore = topicScores.length ? Math.max(...topicScores) : null
                    const badge = badges.find((summary) => summary.topic === topic.id)
                    const badgeDays = badge?.expires_at
                      ? Math.max(0, Math.ceil((Date.parse(badge.expires_at) - overviewLoadedAt) / (24 * 60 * 60 * 1000)))
                      : null
                    const retakeAt = nextRetakeDate(topic.id, attemptSummaries, overviewLoadedAt)
                    const activeAttempt = activeAttempts[topic.id]
                    const status = badge && !badge.valid
                      ? 'Badge expired'
                      : badge?.valid && badge.expires_soon
                        ? `Badge expires in ${badgeDays} ${badgeDays === 1 ? 'day' : 'days'}`
                        : latestAttempt?.status === 'IN_PROGRESS'
                          ? 'In progress'
                          : latestAttempt?.passed
                            ? 'Passed'
                            : 'Not passed'
                    const Icon = topicIcon(topic.id)
                    return (
                      <article key={topic.id} className={`relative min-h-56 overflow-hidden rounded-2xl border bg-white p-4 shadow-sm dark:bg-slate-800/60 ${initialTopic === topic.id ? 'border-indigo-500 ring-1 ring-indigo-300 dark:border-indigo-500 dark:ring-indigo-800' : 'border-slate-200 dark:border-slate-700'}`}>
                        <Icon aria-hidden="true" className="pointer-events-none absolute bottom-3 right-3 h-16 w-16 text-indigo-500 opacity-[0.08]" />
                        <div className="relative flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h4 className="font-semibold text-slate-900 dark:text-white">{topic.name}</h4>
                            <p className="mt-1 line-clamp-2 min-h-9 text-xs text-slate-500 dark:text-slate-400">{topic.description}</p>
                          </div>
                          <div className="relative grid h-16 w-16 shrink-0 place-items-center" role="img" aria-label={bestScore === null ? `${topic.name} has no completed score` : `${topic.name} best score ${bestScore}%`}>
                            <svg viewBox="0 0 40 40" className="h-16 w-16 -rotate-90" aria-hidden="true">
                              <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="3" className="text-slate-200 dark:text-slate-700" />
                              <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={`${(Math.min(100, bestScore ?? 0) / 100) * 100.53} 100.53`} strokeLinecap="round" className="text-indigo-600 dark:text-indigo-400" />
                            </svg>
                            <span className="absolute text-xs font-bold text-slate-900 dark:text-white">{bestScore === null ? '—' : `${bestScore}%`}</span>
                          </div>
                        </div>
                        <div className="relative mt-3 space-y-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                          <p>{topicAttempts.length} {topicAttempts.length === 1 ? 'attempt' : 'attempts'} · Last: {latestAttempt?.started_at ? new Date(latestAttempt.started_at).toLocaleDateString() : 'Not available'}</p>
                          <span className={`inline-flex rounded-full px-2 py-1 font-semibold ${status === 'Passed' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300' : status === 'Badge expired' || status === 'Not passed' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300' : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300'}`}>{status}</span>
                        </div>
                        <div className="relative mt-3">
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                            disabled={submitting || (!activeAttempt && (!topic.available || retakeAt !== null))}
                            onClick={() => activeAttempt ? resumeAttempt(topic.id) : void startAssessment(topic.id)}
                          >
                            {submitting
                              ? 'Starting…'
                              : activeAttempt
                                ? `Resume (${formatTime(activeAttempt.remaining_seconds)} left)`
                                : !topic.available
                                  ? topic.unavailable_reason || 'Unavailable'
                                  : retakeAt
                                    ? `Retake in ${hoursUntil(retakeAt, overviewLoadedAt)} hours`
                                    : 'Retake'}
                          </Button>
                          {!topic.available && <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">{topic.unavailable_reason}</p>}
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>

            <section aria-labelledby="certified-heading">
              <div className="mb-3">
                <h3 id="certified-heading" className="text-base font-bold text-slate-900 dark:text-white">Get Your Skills Certified</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">New subjects you have not attempted yet.</p>
              </div>
              {loadingTopics ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading available subjects">
                  <AssessmentCardSkeleton />
                  <AssessmentCardSkeleton />
                </div>
              ) : topicsError && topics.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">Subjects are unavailable until the list can be loaded.</p>
              ) : topics.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">No assessment subjects are available right now.</p>
              ) : topics.filter((topic) => !attemptSummaries.some((summary) => summary.topic === topic.id)).length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">You have tried every available subject. Retake an assessment when it becomes available.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {topics.filter((topic) => !attemptSummaries.some((summary) => summary.topic === topic.id)).map((topic) => {
                    const Icon = topicIcon(topic.id)
                    const activeAttempt = activeAttempts[topic.id]
                    const retakeAt = nextRetakeDate(topic.id, attemptSummaries, overviewLoadedAt)
                    return (
                      <article key={topic.id} className="relative flex min-h-56 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/60">
                        <Icon aria-hidden="true" className="pointer-events-none absolute bottom-3 right-3 h-16 w-16 text-indigo-500 opacity-[0.08]" />
                        <div className="relative flex-1">
                          <h4 className="font-semibold text-slate-900 dark:text-white">{topic.name}</h4>
                          <p className="mt-2 min-h-10 text-xs text-slate-500 dark:text-slate-400">{topic.description}</p>
                          <span className="mt-3 inline-flex rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                            {topic.question_count} questions · {Math.ceil(topic.duration_seconds / 60)} mins
                          </span>
                          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Pass mark: {topic.pass_percentage}%</p>
                        </div>
                        <div className="relative mt-4">
                          <Button
                            size="sm"
                            variant="primary"
                            className="w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                            disabled={submitting || (!activeAttempt && (!topic.available || retakeAt !== null))}
                            onClick={() => activeAttempt ? resumeAttempt(topic.id) : void startAssessment(topic.id)}
                          >
                            {submitting
                              ? 'Starting…'
                              : activeAttempt
                                ? `Resume (${formatTime(activeAttempt.remaining_seconds)} left)`
                                : retakeAt
                                  ? `Available in ${hoursUntil(retakeAt, overviewLoadedAt)} hours`
                                  : 'Start Assessment'}
                          </Button>
                          {!topic.available && <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">{topic.unavailable_reason || 'This topic cannot be started yet.'}</p>}
                          {topic.available && retakeAt && <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Weekly attempt limit reached.</p>}
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
          </div>

          <aside aria-labelledby="skill-stats-heading" className="h-fit rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
            <h3 id="skill-stats-heading" className="text-base font-bold text-slate-900 dark:text-white">Your Skill Stats</h3>
            {(statsError || activeAttemptsError) && (
              <div role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                <p>Some assessment stats or active status could not be refreshed.</p>
                <button type="button" onClick={() => void loadAssessmentOverview()} className="mt-2 rounded font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700">Retry</button>
              </div>
            )}
            {loadingTopics ? (
              <div aria-label="Loading skill stats" className="mt-4 space-y-3">
                <div className="h-10 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-10 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-10 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              </div>
            ) : statsError && attemptSummaries.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Stats are unavailable right now. Retry to load your assessment history.</p>
            ) : attemptSummaries.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No assessment activity yet. Complete a subject to build your skill stats.</p>
            ) : (
              <div className="mt-4 space-y-4">
                <dl className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-white p-3 dark:bg-slate-900"><dt className="text-[10px] text-slate-500 dark:text-slate-400">Total attempts</dt><dd className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{attemptSummaries.length}</dd></div>
                  <div className="rounded-xl bg-white p-3 dark:bg-slate-900"><dt className="text-[10px] text-slate-500 dark:text-slate-400">Passed</dt><dd className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{completedForStats.filter((summary) => summary.passed).length}</dd></div>
                  <div className="rounded-xl bg-white p-3 dark:bg-slate-900"><dt className="text-[10px] text-slate-500 dark:text-slate-400">Pass rate</dt><dd className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{completedForStats.length ? Math.round((completedForStats.filter((summary) => summary.passed).length / completedForStats.length) * 100) : 0}%</dd></div>
                  <div className="rounded-xl bg-white p-3 dark:bg-slate-900"><dt className="text-[10px] text-slate-500 dark:text-slate-400">Average score</dt><dd className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{averageScore === null ? '—' : `${averageScore}%`}</dd></div>
                </dl>
                <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
                  <p><span className="font-semibold text-slate-900 dark:text-white">Best topic:</span> {bestTopic ? `${topics.find((topic) => topic.id === bestTopic[0])?.name ?? bestTopic[0]} · ${Math.round(bestTopic[1])}%` : 'No completed assessment'}</p>
                  <p><span className="font-semibold text-slate-900 dark:text-white">Badges:</span> {badges.length} earned · {validBadges.length} valid · {expiringBadges.length} expiring within 30 days</p>
                  <p><span className="font-semibold text-slate-900 dark:text-white">Next retake:</span> {nextRetake ? formatDateTime(nextRetake.toISOString()) : 'Available now'}</p>
                </div>
                {strongestSubtopic && weakestSubtopic && (
                  <div className="border-t border-slate-200 pt-3 text-xs dark:border-slate-700">
                    <p className="mb-2 font-semibold text-slate-900 dark:text-white">Subtopic strengths</p>
                    <p className="text-emerald-700 dark:text-emerald-300">Strongest: {strongestSubtopic[0].replaceAll('_', ' ')} · {Math.round(strongestSubtopic[1])}%</p>
                    <p className="mt-1 text-amber-700 dark:text-amber-300">Needs practice: {weakestSubtopic[0].replaceAll('_', ' ')} · {Math.round(weakestSubtopic[1])}%</p>
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      ) : result ? (
        <div className="space-y-4">
          <div className="space-y-2 py-3 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900/60 dark:text-indigo-400">
              {result.passed ? <Award className="h-7 w-7" /> : <AlertCircle className="h-7 w-7" />}
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{result.passed ? 'Assessment passed' : 'Assessment completed'}</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Weighted score: <strong>{result.weighted_percentage}%</strong> · {result.level} · {result.raw_score}/10 raw points
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Time: {Math.floor(result.time_taken_seconds / 60)}m {result.time_taken_seconds % 60}s · Percentile: {result.percentile}
            </p>
            {result.badge && (
              <div className="space-y-1">
                <p className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <Sparkles className="h-4 w-4" /> {result.badge.level} badge earned: {result.badge.title}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Badge expires on {formatDateTime(result.badge.expires_at)}.
                </p>
              </div>
            )}
          </div>
          <div className="max-h-[45vh] space-y-2 overflow-y-auto">
            {result.questions.map((question) => (
              <div key={question.question_id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-xs font-semibold text-slate-900 dark:text-white">{question.prompt}</p>
                <p className={`mt-1 text-xs ${question.is_correct ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                  Your answer: {answerText(question.selected_answer)}
                </p>
                {!question.is_correct && <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">Correct answer: {answerText(question.correct_answer)}</p>}
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{question.explanation}</p>
                <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                  {question.earned_credit} credit · {question.time_seconds}s · {question.question_id}
                </p>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <Link
              to={routes.skillResult(result.attempt_id)}
              onClick={onClose}
              className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Full report
            </Link>
            <Button size="sm" variant="outline" onClick={reset}>Choose another topic</Button>
            <Button size="sm" variant="primary" onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-bold text-slate-900 dark:text-white">
              {topics.find((topic) => topic.id === attempt.topic)?.name || attempt.topic}
            </span>
            <span className={`inline-flex items-center gap-1 text-xs font-semibold ${secondsLeft < 60 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-slate-300'}`}>
              <Clock3 className="h-4 w-4" aria-hidden="true" />
              <span aria-label="Time remaining">{formatTime(secondsLeft)}</span>
            </span>
          </div>
          <div className="space-y-1" aria-label="Assessment progress">
            <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span>Question {questionIndex + 1} of {attempt.questions.length}</span>
              <span>{Math.round(progress)}% complete</span>
            </div>
          </div>
          {currentQuestion && (
            <>
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {currentQuestion.subtopic.replaceAll('-', ' ')} · {currentQuestion.difficulty.toLowerCase()} · {currentQuestion.question_type === 'MULTI' ? 'Select all that apply' : 'Select one'}
              </p>
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3.5 dark:border-indigo-900/60 dark:bg-indigo-950/30">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{currentQuestion.prompt}</p>
              </div>
              <div className="space-y-2">
                {currentQuestion.options.map((option, index) => {
                  const answer = answers[questionIndex]
                  const selected = Array.isArray(answer) ? answer.includes(index) : answer === index
                  return (
                    <button
                      key={`${currentQuestion.id}-${index}`}
                      type="button"
                      disabled={expired || submitting}
                      onClick={() => setQuestionAnswer(index)}
                      className={`flex w-full items-center justify-between rounded-xl border p-3 text-left text-xs transition-colors disabled:cursor-not-allowed ${
                        selected
                          ? 'border-indigo-600 bg-indigo-50 font-medium text-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-200'
                          : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span>{option}</span>
                      {selected && <CheckCircle2 className="ml-2 h-4 w-4 shrink-0 text-indigo-600" />}
                    </button>
                  )
                })}
              </div>
            </>
          )}
          {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>}
          {expired && <p className="text-xs text-slate-600 dark:text-slate-400">Your attempt was not submitted. You can retake this topic after the cooldown.</p>}
          <div className="flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
            <Button size="sm" variant="ghost" onClick={reset}>Quit</Button>
            <div className="flex gap-2">
              {questionIndex > 0 && (
                <Button size="sm" variant="outline" onClick={() => goToQuestion(questionIndex - 1)}>Previous</Button>
              )}
              {questionIndex < attempt.questions.length - 1 ? (
                <Button size="sm" variant="primary" disabled={!hasAnswer(answers[questionIndex]) || expired} onClick={() => goToQuestion(questionIndex + 1)}>
                  Next Question →
                </Button>
              ) : (
                <Button size="sm" variant="primary" disabled={answers.some((answer) => !hasAnswer(answer)) || expired || submitting} isLoading={submitting} onClick={() => void submitAssessment()}>
                  Submit Assessment
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
