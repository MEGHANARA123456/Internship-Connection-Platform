import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Clock3, Lightbulb } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card, CardContent } from '../../components/ui/Card'
import { Textarea } from '../../components/ui/Textarea'
import { InterviewErrorNotice, useInterviewError } from '../../components/interviews/InterviewErrorNotice'
import { InterviewFeedback } from '../../components/interviews/InterviewFeedback'
import { InterviewPageLayout } from '../../components/interviews/InterviewPageLayout'
import { ProctorGuard } from '../../components/interviews/ProctorGuard'
import { VoiceRoom } from '../../components/interviews/VoiceRoom'
import {
  VideoInterviewRoom,
  type VideoInterviewRoomHandle,
} from '../../components/interviews/VideoInterviewRoom'
import { InterviewVideoRecordingPanel } from '../../components/interviews/InterviewVideoRecordingPanel'
import { useToast } from '../../components/ui/ToastProvider'
import { routes } from '../../lib/routes'
import { confirmAction, showToast } from '../../lib/feedback'
import {
  retryAfterSecondsFromError,
  studentProviderFailureMessage,
} from '../../lib/interviewProviderErrors'
import {
  acknowledgeInterviewProctoringConsent,
  completeInterviewSession,
  getInterviewAnswers,
  getInterviewSession,
  getNextInterviewQuestion,
  retryInterviewEvaluation,
  startInterviewSession,
  submitInterviewAnswer,
} from '../../services/interviewService'
import type {
  InterviewEvaluation,
  InterviewEvaluationStatus,
  InterviewQuestion,
  InterviewSession,
} from '../../types/interview'

const ANSWER_LIMIT = 5000

function CurrentQuestionCard({
  question,
  questionCount,
}: {
  question: InterviewQuestion
  questionCount: number
}) {
  const [expanded, setExpanded] = useState(false)

  useEffect(() => setExpanded(false), [question.id])

  return (
    <section className="sticky top-[4.5rem] z-30 rounded-xl border border-indigo-200 bg-white/95 p-4 shadow-md backdrop-blur dark:border-indigo-900 dark:bg-slate-950/95">
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
        Question {question.position} of {questionCount}{question.is_follow_up ? ' · Follow-up' : ''}
      </p>
      <div className={`mt-2 overflow-y-auto ${expanded ? 'max-h-64' : 'max-h-14 sm:max-h-40'}`}>
        <h2 className="select-none text-lg font-semibold leading-7 text-slate-900 dark:text-white">
          {question.prompt}
        </h2>
      </div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="mt-2 text-xs font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 sm:hidden"
      >
        {expanded ? 'Show less' : 'Show full question'}
      </button>
    </section>
  )
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

export function InterviewSessionPage() {
  const { sessionId: rawSessionId } = useParams()
  const sessionId = Number(rawSessionId)
  const navigate = useNavigate()
  const { toast } = useToast()
  const requestError = useInterviewError()
  const answerInputRef = useRef<HTMLTextAreaElement>(null)
  const videoRoomRef = useRef<VideoInterviewRoomHandle>(null)
  const startRequestRef = useRef<{
    sessionId: number
    promise: Promise<InterviewSession>
  } | null>(null)
  const [session, setSession] = useState<InterviewSession | null>(null)
  const [answeredCount, setAnsweredCount] = useState(0)
  const [question, setQuestion] = useState<InterviewQuestion | null>(null)
  const [currentQuestionAnswered, setCurrentQuestionAnswered] = useState(false)
  const [questionLimitReached, setQuestionLimitReached] = useState(false)
  const [answer, setAnswer] = useState('')
  const [evaluation, setEvaluation] = useState<InterviewEvaluation | null>(null)
  const [evaluationFailure, setEvaluationFailure] = useState('')
  const [evaluationStatus, setEvaluationStatus] = useState<InterviewEvaluationStatus | null>(null)
  const [retryWait, setRetryWait] = useState(0)
  const [currentAnswerId, setCurrentAnswerId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)
  const [audioDurationToken, setAudioDurationToken] = useState<string | null>(null)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [videoBusy, setVideoBusy] = useState(false)

  const startSessionOnce = useCallback((id: number) => {
    if (startRequestRef.current?.sessionId === id) {
      return startRequestRef.current.promise
    }
    const promise = startInterviewSession(id).finally(() => {
      if (startRequestRef.current?.promise === promise) startRequestRef.current = null
    })
    startRequestRef.current = { sessionId: id, promise }
    return promise
  }, [])

  useEffect(() => {
    if (retryWait <= 0) return
    const timer = window.setTimeout(() => setRetryWait((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [retryWait])

  const loadSession = useCallback(async () => {
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      setError('This interview URL is invalid.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const detail = await getInterviewSession(sessionId)
      let nextSession = detail.session
      setAnsweredCount(detail.answered_question_count)
      if (
        nextSession.status === 'CREATED'
        && (nextSession.interview_mode === 'VOICE'
          || nextSession.proctoring_consent_acknowledged)
      ) {
        nextSession = await startSessionOnce(sessionId)
      }
      setSession(nextSession)
      if (['EVALUATION_PENDING', 'EVALUATION_FAILED', 'COMPLETED', 'TERMINATED'].includes(nextSession.status)) {
        navigate(routes.interviewReport(sessionId), { replace: true })
        return
      }
      if (nextSession.status !== 'IN_PROGRESS') {
        setQuestion(null)
        setQuestionLimitReached(false)
        setCurrentQuestionAnswered(false)
        return
      }
      const next = await getNextInterviewQuestion(sessionId)
      setSession((current) => current ? { ...current, status: next.session_status } : current)
      setQuestion(next.question)
      setQuestionLimitReached(next.question_limit_reached)
      setCurrentQuestionAnswered(next.question?.answer_submitted ?? false)
      setAnswer('')
      setEvaluation(null)
      setEvaluationFailure('')
      setEvaluationStatus(null)
      setCurrentAnswerId(null)
      setAudioDurationToken(null)
    } catch (loadError) {
      setError(requestError(loadError, routes.interviewSession(sessionId)))
    } finally {
      setLoading(false)
    }
  }, [navigate, requestError, sessionId, startSessionOnce])

  useEffect(() => {
    void loadSession()
  }, [loadSession])

  useEffect(() => {
    if (!question) return
    if (session?.interview_mode === 'TEXT') {
      const frame = window.requestAnimationFrame(() => {
        answerInputRef.current?.focus({ preventScroll: true })
        answerInputRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      })
      return () => window.cancelAnimationFrame(frame)
    }
  }, [question?.id, session?.interview_mode])

  useEffect(() => {
    if (!session?.expires_at) {
      setRemainingSeconds(null)
      return
    }
    const updateRemaining = () => {
      const deadline = new Date(session.expires_at as string).getTime()
      setRemainingSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    }
    updateRemaining()
    const interval = window.setInterval(updateRemaining, 1000)
    return () => window.clearInterval(interval)
  }, [session?.expires_at])

  const loadNextQuestion = async () => {
    setBusy(true)
    setError('')
    try {
      const next = await getNextInterviewQuestion(sessionId)
      setSession((current) => current ? { ...current, status: next.session_status } : current)
      setQuestion(next.question)
      setQuestionLimitReached(next.question_limit_reached)
      setCurrentQuestionAnswered(next.question?.answer_submitted ?? false)
      setAnswer('')
      setEvaluation(null)
      setEvaluationFailure('')
      setCurrentAnswerId(null)
      setAudioDurationToken(null)
    } catch (nextError) {
      setError(requestError(nextError, routes.interviewSession(sessionId)))
    } finally {
      setBusy(false)
    }
  }

  const submitAnswer = async () => {
    if (!question) return
    if (!answer.trim()) {
      setError('Enter an answer before submitting.')
      return
    }
    if (answer.length > ANSWER_LIMIT) {
      setError(`Answers must be ${ANSWER_LIMIT.toLocaleString()} characters or fewer.`)
      return
    }
    setBusy(true)
    setError('')
    const alreadyAnswered = currentQuestionAnswered
    try {
      const result = await submitInterviewAnswer(
        sessionId,
        question.id,
        answer,
        session?.interview_mode === 'VOICE' || session?.interview_mode === 'VIDEO'
          ? audioDurationToken
          : null,
      )
      setCurrentAnswerId(result.answer_id)
      if (!alreadyAnswered) setAnsweredCount((current) => current + 1)
      setCurrentQuestionAnswered(true)
      if (session?.session_type === 'PRACTICE') {
        setEvaluation(result.evaluation)
        setEvaluationFailure(result.evaluation_status === 'FAILED' ? result.failure_code ?? 'evaluation_failed' : '')
        setEvaluationStatus(result.evaluation_status)
        setRetryWait(result.evaluation_status === 'FAILED' ? result.retry_after_seconds ?? 0 : 0)
      } else {
        const next = await getNextInterviewQuestion(sessionId)
        setSession((current) => current ? { ...current, status: next.session_status } : current)
        setQuestion(next.question)
        setQuestionLimitReached(next.question_limit_reached)
        setCurrentQuestionAnswered(next.question?.answer_submitted ?? false)
        setAnswer('')
        setEvaluation(null)
        setEvaluationStatus(null)
        setCurrentAnswerId(null)
        setAudioDurationToken(null)
      }
    } catch (submitError) {
      setRetryWait(retryAfterSecondsFromError(submitError))
      setError(requestError(submitError, routes.interviewSession(sessionId)))
    } finally {
      setBusy(false)
    }
  }

  const retryPracticeEvaluation = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await retryInterviewEvaluation(sessionId)
      showToast(
        `${result.queued} answer(s) queued, ${result.evaluated} already evaluated, ${result.failed} still failed.`,
        result.failed ? 'error' : 'info',
      )
      setEvaluationStatus(result.queued ? 'PENDING' : null)
      setEvaluationFailure(result.failed ? 'evaluation_failed' : '')
      setRetryWait(0)
    } catch (retryError) {
      setRetryWait(retryAfterSecondsFromError(retryError))
      setError(requestError(retryError, routes.interviewSession(sessionId)))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (
      session?.session_type !== 'PRACTICE'
      || currentAnswerId === null
      || (evaluationStatus !== 'PENDING' && evaluationStatus !== 'EVALUATING')
    ) return

    let active = true
    let inFlight = false
    const refreshEvaluation = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const answers = await getInterviewAnswers(sessionId)
        if (!active) return
        const current = answers.find((item) => item.answer_id === currentAnswerId)
        if (!current) return
        setEvaluation(current.evaluation)
        setEvaluationFailure(current.evaluation_status === 'FAILED'
          ? current.failure_code ?? 'evaluation_failed'
          : '')
        setEvaluationStatus(current.evaluation_status)
      } catch (pollError) {
        if (active) setError(requestError(pollError, routes.interviewSession(sessionId)))
      } finally {
        inFlight = false
      }
    }
    void refreshEvaluation()
    const interval = window.setInterval(() => void refreshEvaluation(), 3000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [currentAnswerId, evaluationStatus, requestError, session?.session_type, sessionId])

  const complete = async (endEarly = false) => {
    if (session?.session_type === 'ASSESSMENT' || endEarly) {
      const confirmed = await confirmAction({
        title: endEarly ? 'End interview now?' : 'Complete this assessment?',
        message: endEarly
          ? 'Any unsubmitted answer will be discarded, and saved answers will be evaluated.'
          : 'Your submitted answers will be evaluated. You cannot add answers afterward.',
        confirmLabel: endEarly ? 'End interview' : 'Complete assessment',
      })
      if (!confirmed) return
    }
    setBusy(true)
    setError('')
    try {
      if (session?.interview_mode === 'VIDEO') {
        await videoRoomRef.current?.finalizeRecording()
      }
      await completeInterviewSession(sessionId)
      navigate(routes.interviewReport(sessionId))
    } catch (completeError) {
      setError(requestError(completeError, routes.interviewSession(sessionId)))
    } finally {
      setBusy(false)
    }
  }

  const canLeaveProctoredRoom = useCallback(
    () => !voiceBusy && !videoBusy,
    [videoBusy, voiceBusy],
  )

  if (loading) {
    return <main className="mx-auto w-full max-w-3xl px-4 py-10"><p role="status">Loading your interview…</p></main>
  }

  if (!session) {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-10">
        <InterviewErrorNotice message={error || 'Interview session could not be loaded.'} onRetry={() => void loadSession()} />
        <Link to={routes.interviewHistory} className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Back to history</Link>
      </main>
    )
  }

  if (session.status === 'EXPIRED') {
    return (
      <InterviewPageLayout title="Interview expired" description="The 20-minute time limit has passed. Your saved answers remain in your history.">
        <Card><CardContent className="space-y-4 py-5">
          {error && <InterviewErrorNotice message={error} onRetry={() => void loadSession()} />}
          {session.interview_mode === 'VIDEO' && <InterviewVideoRecordingPanel sessionId={session.id} />}
          <Link className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300" to={routes.interviewHistory}>View interview history</Link>
        </CardContent></Card>
      </InterviewPageLayout>
    )
  }

  if (session.status === 'TERMINATED') {
    return (
      <InterviewPageLayout title="Interview terminated" description="This interview ended after the configured proctoring violation threshold was reached.">
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          The event record is flagged for review and is not proof of misconduct.
        </p>
        <Link to={routes.interviewReport(session.id)} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">View interview report</Link>
      </InterviewPageLayout>
    )
  }

  if (
    session.status === 'CREATED'
    && (session.interview_mode === 'TEXT' || session.interview_mode === 'VIDEO')
    && !session.proctoring_consent_acknowledged
  ) {
    const acceptAndStart = async () => {
      setBusy(true)
      setError('')
      try {
        if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen().catch(() => {
            showToast('Fullscreen is unavailable; proctoring will continue without fullscreen enforcement.', 'info')
          })
        } else {
          showToast('Fullscreen is unavailable; proctoring will continue without fullscreen enforcement.', 'info')
        }
        await acknowledgeInterviewProctoringConsent(session.id)
        await startSessionOnce(session.id)
        await loadSession()
      } catch (consentError) {
        const message = requestError(consentError, routes.interviewSession(session.id))
        if (message) {
          toast(message, {
            kind: 'error',
            actions: [
              { label: 'Try again', onClick: () => void acceptAndStart() },
              { label: 'Continue attempt', onClick: () => void loadSession() },
            ],
          })
        }
      } finally {
        setBusy(false)
      }
    }
    return (
      <InterviewPageLayout
        title="Before you begin"
        description="Proctoring is limited to this active text or video interview."
      >
        {error && <InterviewErrorNotice message={error} onRetry={() => void acceptAndStart()} retrying={busy} />}
        <Card>
          <CardContent className="space-y-4 py-5">
            <h2 className="font-semibold text-slate-900 dark:text-white">Proctoring consent</h2>
            <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700 dark:text-slate-300">
              <li>Tab visibility and window focus changes, fullscreen exits, and blocked clipboard/shortcut attempts are recorded with timestamps and the current question number.</li>
              <li>Time away is recorded when focus returns. No screen content is recorded.</li>
              <li>Browser-side proctoring is a deterrent and can be bypassed. Events are flagged for review, not treated as proof of misconduct.</li>
            </ul>
            <Button isLoading={busy} onClick={() => void acceptAndStart()}>Accept and start interview</Button>
          </CardContent>
        </Card>
      </InterviewPageLayout>
    )
  }

  return (
    <InterviewPageLayout
      title={`${session.category.replaceAll('_', ' ')} ${session.session_type === 'PRACTICE' ? 'Practice' : 'Assessment'}`}
      description={session.interview_mode === 'VIDEO'
        ? 'Check your devices, answer by voice or text, and opt in separately before any video recording.'
        : session.session_type === 'PRACTICE'
        ? 'Use the optional hint, answer in your own words, and review coaching feedback.'
        : 'Answer each question once. Hints and feedback are withheld until you finish.'}
      actions={(
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
          <Clock3 className="h-4 w-4" aria-hidden="true" />
          <span aria-label="Time remaining">{remainingSeconds === null ? formatTime(session.time_limit_seconds) : formatTime(remainingSeconds)}</span>
        </div>
      )}
    >
      {error && <InterviewErrorNotice message={error} onRetry={() => void loadSession()} retrying={loading} />}
      <ProctorGuard
        active={session.status === 'IN_PROGRESS' && (session.interview_mode === 'TEXT' || session.interview_mode === 'VIDEO')}
        sessionId={session.id}
        questionIndex={question?.position ?? null}
        maxViolations={session.proctoring_max_violations}
        onTerminated={() => navigate(routes.interviewReport(session.id), { replace: true })}
        canExit={canLeaveProctoredRoom}
      >
      <div className="space-y-2" aria-label="Interview progress">
        <div className="flex justify-between text-sm font-medium text-slate-600 dark:text-slate-300">
          <span>Progress</span>
          <span>{answeredCount} of {session.question_count} answered</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="progressbar" aria-valuemin={0} aria-valuemax={session.question_count} aria-valuenow={answeredCount}>
          <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${Math.min(100, answeredCount / session.question_count * 100)}%` }} />
        </div>
      </div>

      {session.interview_mode === 'VIDEO' ? (
        <VideoInterviewRoom
          ref={videoRoomRef}
          sessionId={session.id}
          onBusyChange={setVideoBusy}
        >
          {(sharedStream) => question ? (
            <Card>
              <CardContent className="space-y-5 py-5">
                <CurrentQuestionCard question={question} questionCount={session.question_count} />
                {session.session_type === 'PRACTICE' && question.hint && (
                  <details className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                    <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-amber-100">
                      <Lightbulb className="h-4 w-4" aria-hidden="true" /> Show hint
                    </summary>
                    <p className="mt-2 text-sm leading-6 text-amber-950 dark:text-amber-100">{question.hint}</p>
                  </details>
                )}
                <VoiceRoom
                  key={`${session.id}-${question.id}-video`}
                  sessionId={session.id}
                  questionId={question.id}
                  questionText={question.prompt}
                  answer={answer}
                  disabled={busy || (session.session_type === 'ASSESSMENT' && currentQuestionAnswered)}
                  allowAudioTranscription={false}
                  sharedStream={sharedStream}
                  onAnswerChange={(value) => {
                    setAnswer(value)
                    if (error) setError('')
                  }}
                  onDurationTokenChange={setAudioDurationToken}
                  onBusyChange={setVoiceBusy}
                />
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  {session.session_type === 'PRACTICE' && currentQuestionAnswered && (
                    <Button variant="outline" disabled={busy || voiceBusy || videoBusy} onClick={() => void loadNextQuestion()}>
                      Next question
                    </Button>
                  )}
                  {session.session_type === 'ASSESSMENT' && currentQuestionAnswered && (
                    <Button variant="outline" disabled={busy || videoBusy} onClick={() => void loadSession()}>Retry loading next question</Button>
                  )}
                  <Button
                    onClick={() => void submitAnswer()}
                    disabled={busy || voiceBusy || videoBusy || (session.session_type === 'ASSESSMENT' && currentQuestionAnswered) || !answer.trim() || answer.length > ANSWER_LIMIT}
                    isLoading={busy}
                  >
                    {currentQuestionAnswered && session.session_type === 'PRACTICE' ? 'Resubmit answer' : 'Submit answer'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card><CardContent className="py-5 text-sm text-slate-600 dark:text-slate-300">No question is available. You can finish saved answers or refresh the session.</CardContent></Card>
          )}
        </VideoInterviewRoom>
      ) : question && (
        <Card>
          <CardContent className="space-y-5 py-5">
            <CurrentQuestionCard question={question} questionCount={session.question_count} />

            {session.session_type === 'PRACTICE' && question.hint && (
              <details className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-amber-100">
                  <Lightbulb className="h-4 w-4" aria-hidden="true" /> Show hint
                </summary>
                <p className="mt-2 text-sm leading-6 text-amber-950 dark:text-amber-100">{question.hint}</p>
              </details>
            )}

            {session.interview_mode === 'VOICE' ? (
              <VoiceRoom
                key={`${session.id}-${question.id}`}
                sessionId={session.id}
                questionId={question.id}
                questionText={question.prompt}
                answer={answer}
                disabled={busy || (session.session_type === 'ASSESSMENT' && currentQuestionAnswered)}
                onAnswerChange={(value) => {
                  setAnswer(value)
                  if (error) setError('')
                }}
                onDurationTokenChange={setAudioDurationToken}
                onBusyChange={setVoiceBusy}
              />
            ) : (
              <>
                <Textarea
                  ref={answerInputRef}
                  label="Your answer"
                  value={answer}
                  onChange={(event) => {
                    setAnswer(event.target.value)
                    if (error) setError('')
                  }}
                  maxLength={ANSWER_LIMIT}
                  rows={8}
                  disabled={busy || (session.session_type === 'ASSESSMENT' && currentQuestionAnswered)}
                  placeholder="Write your answer here…"
                  aria-describedby="interview-answer-count"
                />
                <p id="interview-answer-count" className={`text-right text-xs ${answer.length > ANSWER_LIMIT ? 'text-rose-700' : 'text-slate-500 dark:text-slate-400'}`}>
                  {answer.length.toLocaleString()} / {ANSWER_LIMIT.toLocaleString()} characters
                </p>
              </>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {session.session_type === 'PRACTICE' && currentQuestionAnswered && (
                <Button variant="outline" disabled={busy || voiceBusy || videoBusy} onClick={() => void loadNextQuestion()}>
                  Next question
                </Button>
              )}
              {session.session_type === 'ASSESSMENT' && currentQuestionAnswered && (
                <Button variant="outline" disabled={busy || videoBusy} onClick={() => void loadSession()}>Retry loading next question</Button>
              )}
              <Button
                onClick={() => void submitAnswer()}
                disabled={busy || voiceBusy || videoBusy || (session.session_type === 'ASSESSMENT' && currentQuestionAnswered) || !answer.trim() || answer.length > ANSWER_LIMIT}
                isLoading={busy}
              >
                {currentQuestionAnswered && session.session_type === 'PRACTICE' ? 'Resubmit answer' : 'Submit answer'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {session.session_type === 'PRACTICE' && evaluation && <InterviewFeedback evaluation={evaluation} />}
      {session.session_type === 'PRACTICE'
        && !evaluation
        && !evaluationFailure
        && (evaluationStatus === 'PENDING' || evaluationStatus === 'EVALUATING')
        && (
          <div role="status" className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-amber-700 border-t-transparent dark:border-amber-300 dark:border-t-transparent" aria-hidden="true" />
            Queued for evaluation...
          </div>
        )}
      {session.session_type === 'PRACTICE' && evaluationFailure && (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
          <p role="status" className="text-sm text-amber-950 dark:text-amber-100">
            {studentProviderFailureMessage(evaluationFailure)}
          </p>
          <Button variant="outline" size="sm" disabled={busy || retryWait > 0} isLoading={busy} onClick={() => void retryPracticeEvaluation()}>
            {retryWait > 0 ? `Try again in ${retryWait}s` : 'Retry evaluation'}
          </Button>
        </div>
      )}

      {!question && questionLimitReached && (
        <Card><CardContent className="space-y-3 py-5">
          <h2 className="font-semibold text-slate-900 dark:text-white">You have reached the end of this interview.</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">Complete the session to prepare your report.</p>
          <Button isLoading={busy} disabled={voiceBusy || videoBusy} onClick={() => void complete()}>{session.session_type === 'ASSESSMENT' ? 'Complete Assessment' : 'Complete Practice'}</Button>
        </CardContent></Card>
      )}
      {!question && !questionLimitReached && (
        <Card><CardContent className="py-5 text-sm text-slate-600 dark:text-slate-300">No question is available. Refresh the session to continue.</CardContent></Card>
      )}
      <div className="flex flex-wrap gap-3">
        {(session.interview_mode === 'VOICE' || session.interview_mode === 'VIDEO') && (
          <Button variant="outline" disabled={busy || voiceBusy || videoBusy || answeredCount === 0} onClick={() => void complete(true)}>End interview</Button>
        )}
        <Link
          to={routes.interviewHistory}
          onClick={(event) => {
            if (voiceBusy || videoBusy) {
              event.preventDefault()
              setError('Wait for voice transcription or video upload to finish before leaving this session.')
            } else if ((session.interview_mode === 'VOICE' || session.interview_mode === 'VIDEO') && answer.trim() && !window.confirm('Leave without submitting this answer? The current transcript will be discarded.')) {
              event.preventDefault()
            }
          }}
          className="text-sm font-semibold text-slate-600 hover:underline dark:text-slate-300"
        >
          Exit to history
        </Link>
        {session.status === 'EVALUATION_PENDING' && <Link to={routes.interviewReport(session.id)} className="text-sm font-semibold text-indigo-700 hover:underline dark:text-indigo-300">View evaluation status</Link>}
      </div>
      </ProctorGuard>
    </InterviewPageLayout>
  )
}
