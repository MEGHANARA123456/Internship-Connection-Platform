import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card, CardContent } from '../../components/ui/Card'
import { InterviewErrorNotice, useInterviewError } from '../../components/interviews/InterviewErrorNotice'
import { InterviewPageLayout } from '../../components/interviews/InterviewPageLayout'
import { routes } from '../../lib/routes'
import { showToast } from '../../lib/feedback'
import {
  acknowledgeInterviewProctoringConsent,
  createInterviewSession,
  getInterviewSession,
  startInterviewSession,
} from '../../services/interviewService'
import type {
  InterviewCategory,
  InterviewDifficulty,
  InterviewMode,
  InterviewSessionType,
} from '../../types/interview'

const categoryOptions: Array<{ value: InterviewCategory; label: string }> = [
  { value: 'HR', label: 'HR and general' },
  { value: 'TECHNICAL', label: 'Technical' },
  { value: 'DATA_SCIENCE', label: 'Data Science' },
  { value: 'BEHAVIORAL', label: 'Behavioral' },
  { value: 'MIXED', label: 'Mixed' },
]

const difficultyOptions: Array<{ value: InterviewDifficulty; label: string }> = [
  { value: 'BEGINNER', label: 'Beginner' },
  { value: 'INTERMEDIATE', label: 'Intermediate' },
  { value: 'ADVANCED', label: 'Advanced' },
]

export function InterviewSetupPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const requestError = useInterviewError()
  const retakeIdValue = Number(searchParams.get('retake_of_session_id'))
  const retakeId = Number.isInteger(retakeIdValue) && retakeIdValue > 0 ? retakeIdValue : undefined
  const [category, setCategory] = useState<InterviewCategory>('HR')
  const [difficulty, setDifficulty] = useState<InterviewDifficulty>('BEGINNER')
  const [sessionType, setSessionType] = useState<InterviewSessionType>('PRACTICE')
  const [interviewMode, setInterviewMode] = useState<InterviewMode>('TEXT')
  const [questionCount, setQuestionCount] = useState<5 | 10>(5)
  const [consent, setConsent] = useState(false)
  const [proctoringConsent, setProctoringConsent] = useState(false)
  const [loadingRetake, setLoadingRetake] = useState(Boolean(retakeId))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [createdSessionId, setCreatedSessionId] = useState<number | null>(null)

  const loadRetakeSettings = useCallback(async () => {
    if (!retakeId) {
      setLoadingRetake(false)
      return
    }
    setLoadingRetake(true)
    setError('')
    try {
      const { session } = await getInterviewSession(retakeId)
      setCategory(session.category)
      setDifficulty(session.difficulty)
      setSessionType(session.session_type)
      setInterviewMode(session.interview_mode)
      setQuestionCount(session.question_count === 10 && session.category === 'MIXED' ? 10 : 5)
    } catch (loadError) {
      setError(requestError(loadError, routes.interviewSetup()))
    } finally {
      setLoadingRetake(false)
    }
  }, [requestError, retakeId])

  useEffect(() => {
    void loadRetakeSettings()
  }, [loadRetakeSettings])

  const changeCategory = (value: InterviewCategory) => {
    setCategory(value)
    if (value !== 'MIXED') setQuestionCount(5)
  }

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const proctoringRequired = interviewMode === 'TEXT' || interviewMode === 'VIDEO'
    if (!consent || (proctoringRequired && !proctoringConsent) || submitting) return
    if (proctoringRequired) {
      const request = document.fullscreenEnabled
        ? document.documentElement.requestFullscreen?.()
        : undefined
      if (request) {
        void request.catch(() => {
          showToast('Fullscreen is unavailable; proctoring will continue without fullscreen enforcement.', 'info')
        })
      } else {
        showToast('Fullscreen is unavailable; proctoring will continue without fullscreen enforcement.', 'info')
      }
    }
    setSubmitting(true)
    setError('')
    setCreatedSessionId(null)
    try {
      const created = await createInterviewSession({
        session_type: sessionType,
        category,
        difficulty,
        question_count: questionCount,
        interview_mode: interviewMode,
        consent_acknowledged: true,
        ...(retakeId ? { retake_of_session_id: retakeId } : {}),
      })
      setCreatedSessionId(created.id)
      if (proctoringRequired) {
        await acknowledgeInterviewProctoringConsent(created.id)
      }
      await startInterviewSession(created.id)
      navigate(routes.interviewSession(created.id))
    } catch (startError) {
      setError(requestError(startError, routes.interviewSetup()))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <InterviewPageLayout
      title={retakeId ? 'Set up your retake' : 'Set up your interview'}
      description="Choose a focus and difficulty. Each session is limited to 20 minutes."
      actions={<Link to={routes.interviewStudio} className="rounded-lg px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40">Back to Studio</Link>}
    >
      {error && <InterviewErrorNotice message={error} onRetry={() => void loadRetakeSettings()} retrying={loadingRetake} />}
      {createdSessionId !== null && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Your session was created but could not be started. <Link className="font-semibold underline" to={routes.interviewSession(createdSessionId)}>Continue to the session</Link>.
        </div>
      )}
      <form onSubmit={(event) => void start(event)} className="space-y-5">
        <Card>
          <CardContent className="grid gap-5 py-5 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
              <span>Category</span>
              <select value={category} onChange={(event) => changeCategory(event.target.value as InterviewCategory)} disabled={loadingRetake || submitting} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                {categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="space-y-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
              <span>Difficulty</span>
              <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as InterviewDifficulty)} disabled={loadingRetake || submitting} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                {difficultyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="space-y-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
              <span>Number of questions</span>
              <select value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value) as 5 | 10)} disabled={category !== 'MIXED' || loadingRetake || submitting} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                <option value={5}>5 questions</option>
                {category === 'MIXED' && <option value={10}>10 questions</option>}
              </select>
              {category !== 'MIXED' && <span className="block text-xs font-normal text-slate-500">10 questions are available only for Mixed interviews.</span>}
            </label>
          </CardContent>
        </Card>

        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Interview mode</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={`cursor-pointer rounded-xl border p-4 focus-within:ring-2 focus-within:ring-indigo-500 ${interviewMode === 'TEXT' ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}>
              <input type="radio" name="interviewMode" value="TEXT" checked={interviewMode === 'TEXT'} onChange={() => setInterviewMode('TEXT')} disabled={submitting} className="sr-only" />
              <span className="font-semibold text-slate-900 dark:text-white">Text</span>
              <span className="mt-1 block text-sm text-slate-600 dark:text-slate-400">Type your answers in the interview room.</span>
            </label>
            <label className={`cursor-pointer rounded-xl border p-4 focus-within:ring-2 focus-within:ring-indigo-500 ${interviewMode === 'VOICE' ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}>
              <input type="radio" name="interviewMode" value="VOICE" checked={interviewMode === 'VOICE'} onChange={() => setInterviewMode('VOICE')} disabled={submitting} className="sr-only" />
              <span className="font-semibold text-slate-900 dark:text-white">Voice</span>
              <span className="mt-1 block text-sm text-slate-600 dark:text-slate-400">Record an answer or use text entry; review the transcript before submitting.</span>
            </label>
            <label className={`cursor-pointer rounded-xl border p-4 focus-within:ring-2 focus-within:ring-indigo-500 ${interviewMode === 'VIDEO' ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}>
              <input type="radio" name="interviewMode" value="VIDEO" checked={interviewMode === 'VIDEO'} onChange={() => setInterviewMode('VIDEO')} disabled={submitting} className="sr-only" />
              <span className="font-semibold text-slate-900 dark:text-white">Video</span>
              <span className="mt-1 block text-sm text-slate-600 dark:text-slate-400">Use your webcam and microphone; recording the session is optional and off by default.</span>
            </label>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Interview type</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={`cursor-pointer rounded-xl border p-4 focus-within:ring-2 focus-within:ring-indigo-500 ${sessionType === 'PRACTICE' ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}>
              <input type="radio" name="sessionType" value="PRACTICE" checked={sessionType === 'PRACTICE'} onChange={() => setSessionType('PRACTICE')} disabled={submitting} className="sr-only" />
              <span className="font-semibold text-slate-900 dark:text-white">Practice</span>
              <span className="mt-1 block text-sm text-slate-600 dark:text-slate-400">Get hints and coaching feedback after each answer. You can resubmit answers.</span>
            </label>
            <label className={`cursor-pointer rounded-xl border p-4 focus-within:ring-2 focus-within:ring-indigo-500 ${sessionType === 'ASSESSMENT' ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}>
              <input type="radio" name="sessionType" value="ASSESSMENT" checked={sessionType === 'ASSESSMENT'} onChange={() => setSessionType('ASSESSMENT')} disabled={submitting} className="sr-only" />
              <span className="font-semibold text-slate-900 dark:text-white">Assessment</span>
              <span className="mt-1 block text-sm text-slate-600 dark:text-slate-400">No hints or feedback during the interview. Results are evaluated after completion.</span>
            </label>
          </div>
        </fieldset>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
          <label htmlFor="interview-consent" className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-amber-950 dark:text-amber-100">
            <input id="interview-consent" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={submitting} required className="mt-1 h-4 w-4 rounded border-amber-400 text-indigo-600 focus:ring-indigo-500" />
            <span>
              I understand that my interview answers will be sent to an external AI provider for evaluation.
              {(interviewMode === 'VOICE' || interviewMode === 'VIDEO') && ' Voice answers are sent to an external speech-to-text provider; answer audio is not retained by InternSphere.'}
              {interviewMode === 'VIDEO' && ' Video recording is a separate opt-in and is off unless you explicitly consent in the interview room.'}
            </span>
          </label>
        </div>

        {(interviewMode === 'TEXT' || interviewMode === 'VIDEO') && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
            <label htmlFor="interview-proctoring-consent" className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-indigo-950 dark:text-indigo-100">
              <input
                id="interview-proctoring-consent"
                type="checkbox"
                checked={proctoringConsent}
                onChange={(event) => setProctoringConsent(event.target.checked)}
                disabled={submitting}
                required
                className="mt-1 h-4 w-4 rounded border-indigo-400 text-indigo-600 focus:ring-indigo-500"
              />
              <span>
                I consent to proctoring for this interview. InternSphere records tab visibility and focus changes, fullscreen exits, and blocked clipboard/shortcut attempts, with timestamps, question number, and time away. No screen content is recorded. This browser-side monitoring is a deterrent, may be bypassed, and flags events for review rather than proving misconduct.
              </span>
            </label>
          </div>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Link to={routes.interviewStudio} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900">Cancel</Link>
          <Button
            type="submit"
            size="lg"
            isLoading={submitting}
            disabled={!consent || loadingRetake || ((interviewMode === 'TEXT' || interviewMode === 'VIDEO') && !proctoringConsent)}
          >
            {retakeId ? 'Create retake' : 'Start interview'}
          </Button>
        </div>
      </form>
    </InterviewPageLayout>
  )
}
