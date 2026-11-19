import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InterviewHistoryPage } from './InterviewHistoryPage'
import { InterviewReportPage } from './InterviewReportPage'
import { InterviewSessionPage } from './InterviewSessionPage'
import { InterviewSetupPage } from './InterviewSetupPage'
import { InterviewStudioPage } from './InterviewStudioPage'
import * as interviewService from '../../services/interviewService'
import type {
  InterviewEvaluation,
  InterviewQuestion,
  InterviewReport,
  InterviewSession,
  InterviewSessionDetail,
} from '../../types/interview'

vi.mock('../../services/interviewService', () => ({
  completeInterviewSession: vi.fn(),
  createInterviewSession: vi.fn(),
  deleteInterviewSession: vi.fn(),
  getInterviewReport: vi.fn(),
  getInterviewSession: vi.fn(),
  getNextInterviewQuestion: vi.fn(),
  listInterviewSessions: vi.fn(),
  retryInterviewEvaluation: vi.fn(),
  startInterviewSession: vi.fn(),
  submitInterviewAnswer: vi.fn(),
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

function makeSession(overrides: Partial<InterviewSession> = {}): InterviewSession {
  return {
    id: 17,
    session_type: 'PRACTICE',
    interview_mode: 'TEXT',
    category: 'HR',
    difficulty: 'BEGINNER',
    question_count: 5,
    time_limit_seconds: 1200,
    status: 'IN_PROGRESS',
    consent_acknowledged: true,
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
    ...overrides,
  }
}

function makeDetail(
  status: InterviewSession['status'] = 'IN_PROGRESS',
  overrides: Partial<InterviewSession> = {},
): InterviewSessionDetail {
  return { session: makeSession({ status, ...overrides }), questions: [] }
}

function CurrentPath() {
  const { pathname, search } = useLocation()
  return <p data-testid="current-path">{`${pathname}${search}`}</p>
}

function renderInterviewPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/interview-studio" element={<InterviewStudioPage />} />
        <Route path="/interview-studio/setup" element={<InterviewSetupPage />} />
        <Route path="/interview-studio/session/:sessionId" element={<InterviewSessionPage />} />
        <Route path="/interview-studio/report/:sessionId" element={<InterviewReportPage />} />
        <Route path="/interview-studio/history" element={<InterviewHistoryPage />} />
        <Route path="*" element={<CurrentPath />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(interviewService.createInterviewSession).mockResolvedValue(makeSession({ status: 'CREATED' }))
  vi.mocked(interviewService.listInterviewSessions).mockResolvedValue([])
  vi.mocked(interviewService.getInterviewSession).mockResolvedValue(makeDetail())
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
  vi.mocked(interviewService.retryInterviewEvaluation).mockResolvedValue(makeReport())
  vi.mocked(interviewService.deleteInterviewSession).mockResolvedValue()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Interview Studio setup', () => {
  it('requires consent, applies Mixed-only question counts, and starts the chosen mode', async () => {
    renderInterviewPage('/interview-studio/setup')
    const startButton = screen.getByRole('button', { name: 'Start interview' })
    expect(startButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'MIXED' } })
    expect(screen.getByRole('option', { name: '10 questions' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Number of questions/), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'TECHNICAL' } })
    expect(screen.getByLabelText(/Number of questions/)).toHaveValue('5')
    expect(screen.queryByRole('option', { name: '10 questions' })).not.toBeInTheDocument()

    expect(screen.getByText(/Get hints and coaching feedback after each answer/)).toBeInTheDocument()
    expect(screen.getByText(/No hints or feedback during the interview/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /Assessment/ }))
    fireEvent.click(screen.getByLabelText(/sent to an external AI provider/))
    expect(startButton).toBeEnabled()
    fireEvent.click(startButton)

    expect(await screen.findByText('Tell me about a project you contributed to.')).toBeInTheDocument()
    expect(interviewService.createInterviewSession).toHaveBeenCalledWith({
      session_type: 'ASSESSMENT',
      category: 'TECHNICAL',
      difficulty: 'BEGINNER',
      question_count: 5,
      interview_mode: 'TEXT',
      consent_acknowledged: true,
    })
    expect(interviewService.startInterviewSession).toHaveBeenCalledWith(17)
  })

  it('shows the daily limit from a 429 response', async () => {
    vi.mocked(interviewService.createInterviewSession).mockRejectedValue({
      isAxiosError: true,
      response: { status: 429, data: { detail: 'daily_session_limit_reached' } },
    })
    renderInterviewPage('/interview-studio/setup')
    fireEvent.click(screen.getByLabelText(/sent to an external AI provider/))
    fireEvent.click(screen.getByRole('button', { name: 'Start interview' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('limit of five interview sessions today')
  })

  it('creates a Voice session only after voice consent is acknowledged', async () => {
    renderInterviewPage('/interview-studio/setup')
    fireEvent.click(screen.getByRole('radio', { name: /Voice/ }))
    const startButton = screen.getByRole('button', { name: 'Start interview' })
    expect(startButton).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/Voice answers are sent to an external speech-to-text provider/))
    expect(startButton).toBeEnabled()
    fireEvent.click(startButton)

    await screen.findByText('Tell me about a project you contributed to.')
    expect(interviewService.createInterviewSession).toHaveBeenCalledWith({
      session_type: 'PRACTICE',
      category: 'HR',
      difficulty: 'BEGINNER',
      question_count: 5,
      interview_mode: 'VOICE',
      consent_acknowledged: true,
    })
  })
})

describe('Interview session flow', () => {
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
      questions: [makeQuestion({ answer_submitted: true })],
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
    expect(window.confirm).toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: 'Interview report' })).toBeInTheDocument()
  })
})

describe('Interview report and history', () => {
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
    expect(await screen.findByText(/Evaluation is pending/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh report' })).toBeInTheDocument()

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
    expect(await screen.findByText(/1 answer\(s\) evaluated successfully/)).toBeInTheDocument()
    expect(screen.queryByText(/\/100/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry evaluation' }))
    await waitFor(() => expect(interviewService.retryInterviewEvaluation).toHaveBeenCalledWith(17))
    expect(await screen.findByText('76')).toBeInTheDocument()
  })

  it('opens retake setup and deletes history only after confirmation', async () => {
    vi.mocked(interviewService.listInterviewSessions).mockResolvedValue([makeSession({ status: 'IN_PROGRESS' })])
    renderInterviewPage('/interview-studio/history')
    await screen.findByText(/HR · Practice · text/)
    fireEvent.click(screen.getByRole('link', { name: 'Retake' }))
    expect(await screen.findByRole('heading', { name: 'Set up your retake' })).toBeInTheDocument()
    expect(interviewService.getInterviewSession).toHaveBeenCalledWith(17)

    cleanup()
    vi.mocked(interviewService.listInterviewSessions).mockResolvedValue([makeSession({ status: 'IN_PROGRESS' })])
    renderInterviewPage('/interview-studio/history')
    await screen.findByText(/HR · Practice · text/)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(interviewService.deleteInterviewSession).toHaveBeenCalledWith(17))
    expect(window.confirm).toHaveBeenCalled()
    expect(await screen.findByText('You have no interview attempts yet.')).toBeInTheDocument()
  })
})
