import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { AlertCircle, Award, CheckCircle2, Clock3, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { routes } from '../../lib/routes'

interface SkillTopic {
  id: string
  name: string
  icon: string
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

export function SkillQuizModal({ isOpen, onClose, onBadgeAwarded, initialTopic }: SkillQuizModalProps) {
  const [topics, setTopics] = useState<SkillTopic[]>([])
  const [loadingTopics, setLoadingTopics] = useState(false)
  const [activeAttempts, setActiveAttempts] = useState<Record<string, AssessmentAttempt>>({})
  const [attempt, setAttempt] = useState<AssessmentAttempt | null>(null)
  const [result, setResult] = useState<AssessmentResult | null>(null)
  const [answers, setAnswers] = useState<QuizAnswer[]>([])
  const [answersDirty, setAnswersDirty] = useState(false)
  const answersRevision = useRef(0)
  const [questionTimes, setQuestionTimes] = useState<number[]>([])
  const questionStartedAt = useRef(Date.now())
  const [questionIndex, setQuestionIndex] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [expired, setExpired] = useState(false)
  const remainingDeadline = useRef(0)

  useEffect(() => {
    if (!isOpen) return
    let active = true
    setLoadingTopics(true)
    setError('')
    api.get('/skills/topics')
      .then(async ({ data }) => {
        const availableTopics = Array.isArray(data) ? data as SkillTopic[] : []
        if (active) setTopics(availableTopics)
        const topicsToCheck = initialTopic
          ? availableTopics.filter((topic) => topic.id === initialTopic)
          : availableTopics
        const activeEntries = await Promise.all(topicsToCheck.map(async (topic) => {
          const response = await api.get('/skills/assessments/active', { params: { topic: topic.id } })
          return [topic.id, response.data as AssessmentAttempt | null] as const
        }))
        if (active) {
          const attemptsByTopic: Record<string, AssessmentAttempt> = {}
          for (const [topicId, activeAttempt] of activeEntries) {
            if (activeAttempt && activeAttempt.remaining_seconds > 0) {
              attemptsByTopic[topicId] = activeAttempt
            }
          }
          setActiveAttempts(attemptsByTopic)
        }
      })
      .catch((requestError: unknown) => {
        if (active) setError(errorMessage(requestError))
      })
      .finally(() => {
        if (active) setLoadingTopics(false)
      })
    return () => { active = false }
  }, [isOpen, initialTopic])

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
  }, [questionIndex, attempt?.attempt_id, result, expired])

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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Verified Skill Assessment"
      description="Your answers are graded on the server. A score of 80% or higher earns a verified badge."
      maxWidth="2xl"
    >
      {!attempt ? (
        <div className="space-y-4">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Each assessment has 10 randomly selected questions (4 easy, 4 medium and 2 hard), with a 15-minute server-enforced time limit. Scores use weighted difficulty points. Retakes are available after 24 hours, with a maximum of three attempts per week.
          </p>
          {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>}
          {loadingTopics ? (
            <p className="py-8 text-center text-sm text-slate-500">Loading assessments…</p>
          ) : topics.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No assessment topics are available right now.</p>
          ) : (
            <div className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto p-1 sm:grid-cols-2 lg:grid-cols-4">
              {topics.map((topic) => (
                <button
                  key={topic.id}
                  type="button"
                  disabled={submitting}
                  onClick={() => activeAttempts[topic.id]
                    ? resumeAttempt(topic.id)
                    : void startAssessment(topic.id)}
                  className={`group flex cursor-pointer flex-col justify-between rounded-xl border p-3.5 text-left transition-all hover:border-indigo-500 hover:shadow-md disabled:cursor-wait disabled:opacity-60 dark:bg-slate-800/50 dark:hover:border-indigo-500 ${initialTopic === topic.id ? 'border-indigo-500 bg-indigo-50/70 ring-1 ring-indigo-300 dark:border-indigo-500 dark:ring-indigo-800' : 'border-slate-200 bg-slate-50/50 dark:border-slate-800'}`}
                >
                  <div>
                    <span className="mb-1.5 block text-2xl">{topic.icon}</span>
                    <h4 className="line-clamp-2 text-xs font-bold text-slate-900 group-hover:text-indigo-600 dark:text-white dark:group-hover:text-indigo-400">{topic.name}</h4>
                    <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">10 Questions • 80% Pass</p>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-slate-200/80 pt-2 dark:border-slate-700/60">
                    <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">
                      {submitting
                        ? 'Starting…'
                        : activeAttempts[topic.id]
                          ? `Resume (${formatTime(activeAttempts[topic.id].remaining_seconds)} left)`
                          : 'Start Assessment →'}
                    </span>
                    <Award className="h-3.5 w-3.5 text-indigo-500" />
                  </div>
                </button>
              ))}
            </div>
          )}
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
