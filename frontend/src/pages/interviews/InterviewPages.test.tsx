import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InterviewHistoryPage } from './InterviewHistoryPage'
import { InterviewReportPage } from './InterviewReportPage'
import { InterviewSessionPage } from './InterviewSessionPage'
import { InterviewSetupPage } from './InterviewSetupPage'
import { InterviewStudioPage } from './InterviewStudioPage'
import { MockTestsLibrary } from '../../components/interviews/MockTestsLibrary'
import * as interviewService from '../../services/interviewService'
import { confirmAction, showToast } from '../../lib/feedback'
import { ToastProvider } from '../../components/ui/ToastProvider'
import type {
  InterviewEvaluation,
  InterviewQuestion,
  InterviewReport,
  InterviewSession,
  InterviewSessionDetail,
} from '../../types/interview'

vi.mock('../../services/interviewService', () => ({
  acknowledgeInterviewProctoringConsent: vi.fn(),
  completeInterviewSession: vi.fn(),
  createInterviewSession: vi.fn(),
  createMockTestAttempt: vi.fn(),
  deleteInterviewSession: vi.fn(),
  getInterviewAnswers: vi.fn(),
  getInterviewReport: vi.fn(),
  getInterviewVideoRecordingPolicy: vi.fn(),
  getInterviewSession: vi.fn(),
  getMockTest: vi.fn(),
  getMockTestRecommendation: vi.fn(),
  getInterviewProviderAvailability: vi.fn(),
  getNextInterviewQuestion: vi.fn(),
  listInterviewSessions: vi.fn(),
  listMockTestAttempts: vi.fn(),
  listMockTests: vi.fn(),
  retryInterviewEvaluation: vi.fn(),
  recordInterviewProctoringEvent: vi.fn(),
  startInterviewSession: vi.fn(),
  setInterviewVideoStorageConsent: vi.fn(),
  submitInterviewAnswer: vi.fn(),
}))
vi.mock('../../lib/feedback', () => ({
  confirmAction: vi.fn().mockResolvedValue(true),
  showToast: vi.fn(),
}))

const evaluation: InterviewEvaluation = {
  relevance: 8,
  technical_correctness: 7,
  completeness: 6,
  communication: 9,
  structure: 8,
  feedback: 'Clear answer with a relevant example.',
  strengths: ['Clear reasoning'],
  improvements: ['Add a measurable result'],
}

const mockTest = {
  id: 5,
  slug: 'hr-communication',
  title: 'HR Communication',
  description: 'Practice clear communication.',
  category: 'HR' as const,
  difficulty: 'INTERMEDIATE' as const,
  format: 'STANDARD' as const,
  default_mode: 'PRACTICE' as const,
  question_count: 5,
  time_limit_seconds: 600,
  estimated_duration_minutes: 10,
  skill_tags: [],
  company_style: false,
  version: 2,
  attempt_count: 0,
  completed_attempt_count: 0,
  latest_score: null,
  latest_status: null,
  attempts: [],
}

const mockTestDetail = {
  id: mockTest.id,
  title: mockTest.title,
  description: mockTest.description,
  category: mockTest.category,
  difficulty: mockTest.difficulty,
  default_mode: mockTest.default_mode,
  question_count: mockTest.question_count,
  time_limit_seconds: mockTest.time_limit_seconds,
  estimated_duration_minutes: mockTest.estimated_duration_minutes,
  version: mockTest.version,
}

function makeSession(overrides: Partial<InterviewSession> = {}): InterviewSession {
  return {
    id: 17,
    session_type: 'PRACTICE',
    interview_mode: 'TEXT',
    category: 'HR',
    difficulty: 'INTERMEDIATE',
    question_count: 5,
    time_limit_seconds: 1200,
    status: 'IN_PROGRESS',
    consent_acknowledged: true,
    video_storage_consent: false,
    proctoring_consent_acknowledged: true,
    proctoring_max_violations: 3,
    retake_of_session_id: null,
    created_at: '2026-11-18T10:00:00Z',
    started_at: '2026-11-18T10:00:00Z',
    expires_at: new Date(Date.now() + 1_200_000).toISOString(),
    completed_at: null,
    ...overrides,
  }
}

function makeQuestion(overrides: Partial<InterviewQuestion> = {}): InterviewQuestion {
  return {
    id: 22,
    position: 1,
    prompt: 'Tell me about a project you contributed to.',
    hint: 'Describe your role, one action, and the result.',
    is_follow_up: false,
    answer_submitted: false,
    ...overrides,
  }
}

function makeReport(overrides: Partial<InterviewReport> = {}): InterviewReport {
  return {
    session_id: 17,
    status: 'COMPLETED',
    overall_score: 76,
    rubric_scores: {
      relevance: 8,
      technical_correctness: 7,
      completeness: 6,
      communication: 9,
      structure: 8,
    },
    answer_count: 1,
    summary: 'Feedback is ready for one answer.',
    failure_code: null,
    evaluations: [{
      question_id: 22,
      position: 1,
      prompt: 'Tell me about a project you contributed to.',
      answer_text: 'I planned a small project and shared the outcome.',
      evaluation_status: 'COMPLETED',
      failure_code: null,
      evaluation,
      duration_seconds: null,
      word_count: null,
      speaking_pace_wpm: null,
      filler_word_count: null,
    }],
    voice_metrics: null,
    proctoring_summary: { violation_count: 0, types: {}, total_time_away_ms: 0 },
    ...overrides,
  }
}

function makeDetail(
  status: InterviewSession['status'] = 'IN_PROGRESS',
  overrides: Partial<InterviewSession> = {},
): InterviewSessionDetail {
  return { session: makeSession({ status, ...overrides }), answered_question_count: 0 }
}

function CurrentPath() {
  const { pathname, search } = useLocation()
  return <p data-testid="current-path">{`${pathname}${search}`}</p>
}

function renderInterviewPage(path: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/interview-studio" element={<InterviewStudioPage />} />
          <Route path="/interview-studio/mock-tests" element={<MockTestsLibrary />} />
          <Route path="/interview-studio/setup" element={<InterviewSetupPage />} />
          <Route path="/interview-studio/session/:sessionId" element={<InterviewSessionPage />} />
          <Route path="/interview-studio/report/:sessionId" element={<InterviewReportPage />} />
          <Route path="/interview-studio/history" element={<InterviewHistoryPage />} />
          <Route path="*" element={<CurrentPath />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(interviewService.createInterviewSession).mockResolvedValue(makeSession({
    status: 'CREATED',
    proctoring_consent_acknowledged: false,
  }))
  vi.mocked(interviewService.listMockTests).mockResolvedValue([mockTest])
  vi.mocked(interviewService.listMockTestAttempts).mockResolvedValue([])
  vi.mocked(interviewService.getMockTest).mockResolvedValue(mockTestDetail)
  vi.mocked(interviewService.createMockTestAttempt).mockResolvedValue(
    makeSession({
      id: 29,
      status: 'CREATED',
      proctoring_consent_acknowledged: false,
      mock_test_id: mockTest.id,
      mock_test_version: mockTest.version,
    }),
  )
  vi.mocked(interviewService.getMockTestRecommendation).mockResolvedValue({
    weakest_skill: null,
    recommended_test: null,
  })
  vi.mocked(interviewService.getInterviewVideoRecordingPolicy).mockResolvedValue({
    retention_days: 30,
    storage_backend: 'local',
  })
  vi.mocked(interviewService.setInterviewVideoStorageConsent).mockResolvedValue()
  vi.mocked(interviewService.listMockTestAttempts).mockResolvedValue([])
  vi.mocked(interviewService.getMockTestRecommendation).mockResolvedValue({
    weakest_skill: null,
    recommended_test: null,
  })
  vi.mocked(interviewService.acknowledgeInterviewProctoringConsent).mockResolvedValue()
  vi.mocked(interviewService.recordInterviewProctoringEvent).mockResolvedValue({
    violation_count: 1,
    max_violations: 3,
    terminated: false,
  })
  vi.mocked(interviewService.listInterviewSessions).mockResolvedValue([])
  vi.mocked(interviewService.getInterviewAnswers).mockResolvedValue([{
    answer_id: 91,
    question_id: 22,
    position: 1,
    answer_text: 'I planned a small project and shared the outcome.',
    submitted_at: new Date().toISOString(),
    evaluation_status: 'COMPLETED',
    failure_code: null,
    evaluation,
  }])
  vi.mocked(interviewService.getInterviewSession).mockResolvedValue(makeDetail())
  vi.mocked(interviewService.getInterviewProviderAvailability).mockResolvedValue({
    available: true,
    retry_after_seconds: null,
  })
  vi.mocked(interviewService.startInterviewSession).mockResolvedValue(makeSession())
  vi.mocked(interviewService.getNextInterviewQuestion).mockResolvedValue({
    session_status: 'IN_PROGRESS',
    question: makeQuestion(),
    question_limit_reached: false,
  })
  vi.mocked(interviewService.submitInterviewAnswer).mockResolvedValue({
    answer_id: 91,
    evaluation_status: 'COMPLETED',
    failure_code: null,
    evaluation,
  })
  vi.mocked(interviewService.completeInterviewSession).mockResolvedValue(makeReport())
  vi.mocked(interviewService.getInterviewReport).mockResolvedValue(makeReport())
  vi.mocked(interviewService.retryInterviewEvaluation).mockResolvedValue({
    queued: 1,
    evaluated: 0,
    failed: 0,
  })
  vi.mocked(interviewService.deleteInterviewSession).mockResolvedValue()
  vi.mocked(confirmAction).mockResolvedValue(true)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Interview Studio setup', () => {
  it('creates an attempt once and opens the explicit proctoring-consent screen', async () => {
    vi.mocked(interviewService.getInterviewSession).mockResolvedValue(
      makeDetail('CREATED', { proctoring_consent_acknowledged: false }),
    )
    renderInterviewPage('/interview-studio/mock-tests')
    fireEvent.click(await screen.findByRole('button', { name: `View ${mockTest.title} details` }))
    fireEvent.click(await screen.findByLabelText(/my interview answers may be sent to any AI provider configured/))
    fireEvent.click(screen.getByRole('button', { name: 'Start mock test' }))

    expect(await screen.findByText('Proctoring consent')).toBeInTheDocument()
    expect(interviewService.listMockTestAttempts).toHaveBeenCalledWith(mockTest.id)
    expect(interviewService.createMockTestAttempt).toHaveBeenCalledTimes(1)
    expect(interviewService.startInterviewSession).not.toHaveBeenCalled()
  })

  it('resumes a matching unstarted attempt instead of creating a duplicate', async () => {
    vi.mocked(interviewService.listMockTestAttempts).mockResolvedValue([{
      session_id: 48,
      test_version: mockTest.version,
      session_type: 'PRACTICE',
      interview_mode: 'TEXT',
      status: 'CREATED',
      created_at: new Date().toISOString(),
      completed_at: null,
      overall_score: null,
      skill_breakdown: null,
    }])
    vi.mocked(interviewService.getInterviewSession).mockResolvedValue(
      makeDetail('CREATED', { proctoring_consent_acknowledged: false }),
    )
    renderInterviewPage('/interview-studio/mock-tests')
    fireEvent.click(await screen.findByRole('button', { name: `View ${mockTest.title} details` }))
    fireEvent.click(await screen.findByLabelText(/my interview answers may be sent to any AI provider configured/))
    fireEvent.click(screen.getByRole('button', { name: 'Start mock test' }))

    expect(await screen.findByText('Proctoring consent')).toBeInTheDocument()
    expect(interviewService.createMockTestAttempt).not.toHaveBeenCalled()
  })

  it('requires consent and starts a Technical Video interview', async () => {
    vi.mocked(interviewService.getInterviewSession)
      .mockResolvedValueOnce(makeDetail('CREATED', { proctoring_consent_acknowledged: false }))
      .mockResolvedValue(makeDetail('IN_PROGRESS'))
    renderInterviewPage('/interview-studio/setup')
    const startButton = screen.getByRole('button', { name: 'Start interview' })
    expect(startButton).toBeDisabled()

    expect(screen.getByRole('option', { name: '10 questions' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Number of questions/), { target: { value: '10' } })
    expect(screen.getByRole('radio', { name: /Video/ })).toBeChecked()

    expect(screen.getByText(/Get hints and coaching feedback after each answer/)).toBeInTheDocument()
    expect(screen.getByText(/No hints or feedback during the interview/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /Assessment/ }))
    fireEvent.click(screen.getByLabelText(/may be sent to any AI provider configured/))
    fireEvent.click(screen.getByLabelText(/I consent to proctoring/))
    expect(startButton).toBeEnabled()
    fireEvent.click(startButton)

    expect(await screen.findByText('Tell me about a project you contributed to.')).toBeInTheDocument()
    expect(interviewService.createInterviewSession).toHaveBeenCalledWith({
      session_type: 'ASSESSMENT',
      category: 'TECHNICAL',
      question_count: 10,
      interview_mode: 'VIDEO',
      consent_acknowledged: true,
      video_storage_consent: false,
    })
    expect(interviewService.startInterviewSession).toHaveBeenCalledWith(17)
    expect(interviewService.acknowledgeInterviewProctoringConsent).toHaveBeenCalledWith(17)
  })

  it('shows the daily limit from a 429 response', async () => {
    vi.mocked(interviewService.createInterviewSession).mockRejectedValue({
      isAxiosError: true,
      response: { status: 429, data: { detail: 'daily_session_limit_reached' } },
    })
    renderInterviewPage('/interview-studio/setup')
    fireEvent.click(screen.getByLabelText(/may be sent to any AI provider configured/))
    fireEvent.click(screen.getByLabelText(/I consent to proctoring/))
    fireEvent.click(screen.getByRole('button', { name: 'Start interview' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('limit of five interview sessions today')
  })

  it('creates a Video session only after video consent is acknowledged', async () => {
    renderInterviewPage('/interview-studio/setup')
    const startButton = screen.getByRole('button', { name: 'Start interview' })
    expect(startButton).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/may be sent to any AI provider configured/))
    fireEvent.click(screen.getByLabelText(/I consent to proctoring/))
    expect(startButton).toBeEnabled()
    fireEvent.click(startButton)

    await screen.findByText('Tell me about a project you contributed to.')
    expect(interviewService.createInterviewSession).toHaveBeenCalledWith({
      session_type: 'PRACTICE',
      category: 'TECHNICAL',
      question_count: 5,
      interview_mode: 'VIDEO',
      consent_acknowledged: true,
      video_storage_consent: false,
    })
  })

  it('requires proctoring consent before starting a direct text session', async () => {
    vi.mocked(interviewService.getInterviewSession)
      .mockResolvedValueOnce(makeDetail('CREATED', { proctoring_consent_acknowledged: false }))
      .mockResolvedValue(makeDetail('IN_PROGRESS'))
    renderInterviewPage('/interview-studio/session/17')

    expect(await screen.findByText('Proctoring consent')).toBeInTheDocument()
    expect(interviewService.startInterviewSession).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Accept and start interview' }))

    expect(await screen.findByText('Tell me about a project you contributed to.')).toBeInTheDocument()
    expect(interviewService.acknowledgeInterviewProctoringConsent).toHaveBeenCalledWith(17)
    expect(interviewService.startInterviewSession).toHaveBeenCalledWith(17)
  })

  it('offers retry and continue actions when session start fails', async () => {
    vi.mocked(interviewService.getInterviewSession).mockResolvedValue(
      makeDetail('CREATED', { proctoring_consent_acknowledged: false }),
    )
    vi.mocked(interviewService.acknowledgeInterviewProctoringConsent).mockResolvedValue()
    vi.mocked(interviewService.startInterviewSession).mockRejectedValue({
      isAxiosError: true,
      response: { status: 503, data: { detail: 'provider_unavailable' } },
    })
    renderInterviewPage('/interview-studio/session/17')

    expect(await screen.findByText('Proctoring consent')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Accept and start interview' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The evaluation service is unavailable. Your answer has been saved.',
    )
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue attempt' })).toBeInTheDocument()
  })
})

describe('Interview session flow', () => {
  it('keeps one sticky question card visible and focuses the answer input', async () => {
    renderInterviewPage('/interview-studio/session/17')
    const prompt = 'Tell me about a project you contributed to.'
    expect(await screen.findByRole('heading', { name: prompt })).toBeInTheDocument()
    expect(screen.getAllByText(prompt)).toHaveLength(1)
    expect(screen.getByRole('heading', { name: prompt }).parentElement)
      .toHaveClass('overflow-y-auto')

    const answer = screen.getByRole('textbox', { name: 'Your answer' })
    await waitFor(() => expect(answer).toHaveFocus())
    const expand = screen.getByRole('button', { name: 'Show full question' })
    fireEvent.click(expand)
    expect(expand).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows Practice hint and feedback, permits resubmission, and advances to a follow-up', async () => {
    vi.mocked(interviewService.getNextInterviewQuestion)
      .mockResolvedValueOnce({
        session_status: 'IN_PROGRESS',
        question: makeQuestion(),
        question_limit_reached: false,
      })
      .mockResolvedValueOnce({
        session_status: 'IN_PROGRESS',
        question: makeQuestion({
          id: 23,
          position: 2,
          prompt: 'What would you improve next?',
          hint: null,
          is_follow_up: true,
        }),
        question_limit_reached: false,
      })
    vi.mocked(interviewService.submitInterviewAnswer)
      .mockResolvedValueOnce({ answer_id: 91, evaluation_status: 'COMPLETED', failure_code: null, evaluation })
      .mockResolvedValueOnce({ answer_id: 92, evaluation_status: 'COMPLETED', failure_code: null, evaluation })

    renderInterviewPage('/interview-studio/session/17')
    expect(await screen.findByText('Tell me about a project you contributed to.')).toBeInTheDocument()
    expect(screen.getByText('Show hint')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Interview feedback' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'I planned the project and presented the result.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    expect(await screen.findByRole('region', { name: 'Interview feedback' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resubmit answer' })).toBeEnabled()

    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'I planned, tested, and documented the project.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Resubmit answer' }))
    await waitFor(() => expect(interviewService.submitInterviewAnswer).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Next question' }))
    expect(await screen.findByText('What would you improve next?')).toBeInTheDocument()
    expect(screen.getByText(/Follow-up/)).toBeInTheDocument()
  })

  it('blocks empty and over-length answers client-side', async () => {
    renderInterviewPage('/interview-studio/session/17')
    await screen.findByText('Tell me about a project you contributed to.')
    expect(screen.getByRole('button', { name: 'Submit answer' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'x'.repeat(5001) } })
    expect(screen.getByText('5,001 / 5,000 characters')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit answer' })).toBeDisabled()
    expect(interviewService.submitInterviewAnswer).not.toHaveBeenCalled()
  })

  it('restores the latest unanswered question after a page refresh', async () => {
    vi.mocked(interviewService.getInterviewSession).mockResolvedValue({
      session: makeSession(),
      answered_question_count: 1,
    })
    vi.mocked(interviewService.getNextInterviewQuestion).mockResolvedValue({
      session_status: 'IN_PROGRESS',
      question: makeQuestion({ id: 23, position: 2, prompt: 'What did you learn from that project?' }),
      question_limit_reached: false,
    })
    renderInterviewPage('/interview-studio/session/17')
    expect(await screen.findByText('What did you learn from that project?')).toBeInTheDocument()
    expect(screen.getByText('1 of 5 answered')).toBeInTheDocument()
    expect(interviewService.getInterviewSession).toHaveBeenCalledWith(17)
  })

  it('disables the answer controls while a submission is in flight', async () => {
    let resolveSubmission: ((value: Awaited<ReturnType<typeof interviewService.submitInterviewAnswer>>) => void) | undefined
    vi.mocked(interviewService.submitInterviewAnswer).mockImplementation(() => new Promise((resolve) => {
      resolveSubmission = resolve
    }))
    renderInterviewPage('/interview-studio/session/17')
    await screen.findByText('Tell me about a project you contributed to.')
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'I planned and delivered a project.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Submit answer' })).toBeDisabled()
      expect(screen.getByLabelText('Your answer')).toBeDisabled()
    })
    await act(async () => {
      resolveSubmission?.({ answer_id: 91, evaluation_status: 'COMPLETED', failure_code: null, evaluation })
    })
    expect(await screen.findByRole('region', { name: 'Interview feedback' })).toBeInTheDocument()
  })

  it('shows a service error and retries loading after a 5xx response', async () => {
    vi.mocked(interviewService.getInterviewSession)
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 503, data: { detail: 'service unavailable' } },
      })
      .mockResolvedValueOnce(makeDetail())
    renderInterviewPage('/interview-studio/session/17')
    expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Tell me about a project you contributed to.')).toBeInTheDocument()
  })

  it('redirects unauthorized requests to sign-in with the interview route as the return target', async () => {
    vi.mocked(interviewService.getInterviewSession).mockRejectedValue({
      isAxiosError: true,
      response: { status: 401, data: { detail: 'Not authenticated' } },
    })
    renderInterviewPage('/interview-studio/session/17')
    expect(await screen.findByTestId('current-path')).toHaveTextContent(
      '/login?next=%2Finterview-studio%2Fsession%2F17',
    )
  })

  it('withholds Assessment hints and feedback, advances once, then confirms completion', async () => {
    vi.mocked(interviewService.getInterviewSession).mockResolvedValue(makeDetail('IN_PROGRESS', {
      session_type: 'ASSESSMENT',
      question_count: 1,
    })).mockResolvedValueOnce(makeDetail('IN_PROGRESS', {
      session_type: 'ASSESSMENT',
      question_count: 1,
    })).mockResolvedValueOnce(makeDetail('COMPLETED', {
      session_type: 'ASSESSMENT',
      question_count: 1,
    }))
    vi.mocked(interviewService.getNextInterviewQuestion)
      .mockResolvedValueOnce({
        session_status: 'IN_PROGRESS',
        question: makeQuestion({ hint: null }),
        question_limit_reached: false,
      })
      .mockResolvedValueOnce({
        session_status: 'IN_PROGRESS',
        question: null,
        question_limit_reached: true,
      })
    renderInterviewPage('/interview-studio/session/17')
    await screen.findByText('Tell me about a project you contributed to.')
    expect(screen.queryByText('Show hint')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'I planned the work and shared the outcome.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    expect(await screen.findByText('You have reached the end of this interview.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Interview feedback' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Complete Assessment' }))
    await waitFor(() => expect(interviewService.completeInterviewSession).toHaveBeenCalledWith(17))
    expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Complete this assessment?',
    }))
    expect(await screen.findByRole('heading', { name: 'Interview report' })).toBeInTheDocument()
  })
})

describe('Interview report and history', () => {
  it('shows actionable provider setup errors without exposing the technical code', async () => {
    vi.mocked(interviewService.getInterviewSession).mockResolvedValue(
      makeDetail('EVALUATION_FAILED'),
    )
    vi.mocked(interviewService.getInterviewReport).mockResolvedValue(makeReport({
      status: 'FAILED',
      failure_code: 'provider_not_configured',
      evaluations: [],
    }))
    vi.mocked(interviewService.getInterviewProviderAvailability).mockResolvedValue({
      available: false,
      retry_after_seconds: null,
    })
    renderInterviewPage('/interview-studio/report/17')

    expect(await screen.findByText('Evaluation is temporarily unavailable.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry evaluation' })).toBeEnabled()
    expect(screen.queryByText(/provider_not_configured/)).not.toBeInTheDocument()
  })

  it('shows a failed retry result in a toast without duplicating the inline failure notice', async () => {
    vi.mocked(interviewService.getInterviewSession).mockResolvedValue(
      makeDetail('EVALUATION_FAILED'),
    )
    vi.mocked(interviewService.getInterviewReport).mockResolvedValue(makeReport({
      status: 'FAILED',
      overall_score: null,
      rubric_scores: null,
      failure_code: 'provider_unavailable',
    }))
    vi.mocked(interviewService.retryInterviewEvaluation).mockResolvedValue({
      queued: 0,
      evaluated: 0,
      failed: 1,
    })
    renderInterviewPage('/interview-studio/report/17')

    fireEvent.click(await screen.findByRole('button', { name: 'Retry evaluation' }))

    expect(await screen.findByText('0 of 1 evaluated, 0 still queued, 1 failed.')).toBeInTheDocument()
    expect(screen.queryByText('Evaluation is temporarily unavailable.')).not.toBeInTheDocument()
  })

  it('shows a disabled retry countdown while the provider is rate limited', async () => {
    vi.mocked(interviewService.getInterviewSession).mockResolvedValue(
      makeDetail('EVALUATION_FAILED'),
    )
    vi.mocked(interviewService.getInterviewReport).mockResolvedValue(makeReport({
      status: 'FAILED',
      failure_code: 'provider_rate_limited',
      retry_after_seconds: 45,
      evaluations: [],
    }))
    vi.mocked(interviewService.getInterviewProviderAvailability).mockResolvedValue({
      available: false,
      retry_after_seconds: 45,
    })
    renderInterviewPage('/interview-studio/report/17')

    expect(await screen.findByRole('button', { name: /Try again in 4[0-5]s/ })).toBeDisabled()
  })

  it('renders only the server score and study suggestions for completed reports', async () => {
    vi.mocked(interviewService.getInterviewSession).mockResolvedValue(makeDetail('COMPLETED'))
    renderInterviewPage('/interview-studio/report/17')
    expect(await screen.findByText('76')).toBeInTheDocument()
    expect(screen.getByText('Overall score').parentElement).toHaveTextContent('76/100')
    expect(screen.getByText('Study suggestions')).toBeInTheDocument()
    expect(screen.getByText('Study suggestions').parentElement?.textContent).toContain('Add a measurable result')
  })

  it('shows pending status with refresh and expired status without requesting a report', async () => {
    vi.mocked(interviewService.getInterviewSession).mockResolvedValue(makeDetail('EVALUATION_PENDING'))
    vi.mocked(interviewService.getInterviewReport).mockResolvedValue(makeReport({
      status: 'PENDING',
      overall_score: null,
      rubric_scores: null,
    }))
    renderInterviewPage('/interview-studio/report/17')
    expect(await screen.findByText(/Evaluating your answers/)).toBeInTheDocument()
    expect(interviewService.getInterviewReport).toHaveBeenCalledWith(17)

    cleanup()
    vi.mocked(interviewService.getInterviewSession).mockResolvedValue(makeDetail('EXPIRED'))
    vi.mocked(interviewService.getInterviewReport).mockClear()
    renderInterviewPage('/interview-studio/report/17')
    expect(await screen.findByRole('heading', { name: 'Interview expired' })).toBeInTheDocument()
    expect(interviewService.getInterviewReport).not.toHaveBeenCalled()
  })

  it('shows partial failures without a score and retries failed evaluations', async () => {
    vi.mocked(interviewService.getInterviewSession)
      .mockResolvedValueOnce(makeDetail('EVALUATION_FAILED'))
      .mockResolvedValueOnce(makeDetail('COMPLETED'))
    vi.mocked(interviewService.getInterviewReport)
      .mockResolvedValueOnce(makeReport({
        status: 'FAILED',
        overall_score: null,
        rubric_scores: null,
        answer_count: 2,
        failure_code: 'provider_unavailable',
        evaluations: [
          makeReport().evaluations[0],
          {
            question_id: 24,
            position: 2,
            prompt: 'How did you solve a blocker?',
            answer_text: 'I asked for context and tried a small test.',
            evaluation_status: 'FAILED',
            failure_code: 'provider_unavailable',
            evaluation: null,
            duration_seconds: null,
            word_count: null,
            speaking_pace_wpm: null,
            filler_word_count: null,
          },
        ],
      }))
      .mockResolvedValueOnce(makeReport())
    renderInterviewPage('/interview-studio/report/17')
    expect(await screen.findByText(/1 of 2 answers evaluated; 1 need a retry/)).toBeInTheDocument()
    expect(screen.queryByText(/\/100/)).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry evaluation' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Retry evaluation' }))
    await waitFor(() => expect(interviewService.retryInterviewEvaluation).toHaveBeenCalledWith(17))
    expect(await screen.findByText('76')).toBeInTheDocument()
  })

  it('opens retake setup and deletes history only after confirmation', async () => {
    vi.mocked(interviewService.getInterviewSession).mockResolvedValue(makeDetail('COMPLETED', {
      category: 'TECHNICAL',
      difficulty: 'INTERMEDIATE',
      interview_mode: 'TEXT',
      question_count: 10,
    }))
    vi.mocked(interviewService.listInterviewSessions).mockResolvedValue([makeSession({ status: 'IN_PROGRESS' })])
    renderInterviewPage('/interview-studio/history')
    await screen.findAllByText(/HR · Practice · text/)
    fireEvent.click(screen.getAllByRole('button', { name: 'Retake interview 17' })[0])
    expect(await screen.findByRole('heading', { name: 'Set up your retake' })).toBeInTheDocument()
    expect(interviewService.getInterviewSession).toHaveBeenCalledWith(17)
    expect(screen.getByLabelText('Category')).toHaveValue('TECHNICAL')
    expect(screen.getByRole('radio', { name: /Video/ })).toBeChecked()
    expect(screen.getByLabelText(/Number of questions/)).toHaveValue('10')

    cleanup()
    vi.mocked(interviewService.listInterviewSessions).mockResolvedValue([makeSession({ status: 'IN_PROGRESS' })])
    renderInterviewPage('/interview-studio/history')
    await screen.findAllByText(/HR · Practice · text/)
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete interview 17' })[0])
    await waitFor(() => expect(interviewService.deleteInterviewSession).toHaveBeenCalledWith(17))
    expect(confirmAction).toHaveBeenCalledWith({
      title: 'Delete this attempt?',
      message: 'Its questions, answers and report will be permanently removed.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    expect(showToast).toHaveBeenCalledWith('Interview attempt deleted.', 'success')
    expect(await screen.findByText('You have no interview attempts yet.')).toBeInTheDocument()
  })

  it('opens a real report route and explains expired attempts without navigating', async () => {
    vi.mocked(interviewService.listInterviewSessions).mockResolvedValue([makeSession({ status: 'COMPLETED' })])
    vi.mocked(interviewService.getInterviewSession).mockResolvedValue(makeDetail('COMPLETED'))
    renderInterviewPage('/interview-studio/history')
    await screen.findAllByRole('button', { name: 'View report for interview 17' })
    fireEvent.click(screen.getAllByRole('button', { name: 'View report for interview 17' })[0])
    expect(await screen.findByRole('heading', { name: 'Interview report' })).toBeInTheDocument()
    expect(interviewService.getInterviewSession).toHaveBeenCalledWith(17)

    cleanup()
    vi.mocked(interviewService.listInterviewSessions).mockResolvedValue([makeSession({ status: 'EXPIRED' })])
    vi.mocked(interviewService.getInterviewReport).mockClear()
    renderInterviewPage('/interview-studio/history')
    await screen.findAllByRole('button', { name: 'View report for interview 17' })
    fireEvent.click(screen.getAllByRole('button', { name: 'View report for interview 17' })[0])
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This attempt expired before it was completed. Retake the interview to get a report.',
    )
    expect(screen.getByRole('heading', { name: 'Interview history' })).toBeInTheDocument()
    expect(interviewService.getInterviewReport).not.toHaveBeenCalled()

    cleanup()
    vi.mocked(interviewService.listInterviewSessions).mockResolvedValue([makeSession({ status: 'IN_PROGRESS' })])
    renderInterviewPage('/interview-studio/history')
    await screen.findAllByRole('button', { name: 'View report for interview 17' })
    fireEvent.click(screen.getAllByRole('button', { name: 'View report for interview 17' })[0])
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This attempt has no report yet. Complete or retake the interview to get a report.',
    )
    expect(screen.getByRole('heading', { name: 'Interview history' })).toBeInTheDocument()
  })
})
