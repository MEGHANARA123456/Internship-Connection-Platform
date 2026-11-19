import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  compareMockTestAttempts,
  createMockTestAttempt,
  getMockTest,
  getMockTestRecommendation,
  listMockTests,
  startInterviewSession,
} from '../../services/interviewService'
import type { InterviewSession, MockTest, MockTestComparison } from '../../types/interview'
import { MockTestsLibrary } from './MockTestsLibrary'

vi.mock('../../services/interviewService', () => ({
  compareMockTestAttempts: vi.fn(),
  createMockTestAttempt: vi.fn(),
  getMockTest: vi.fn(),
  getMockTestRecommendation: vi.fn(),
  listMockTests: vi.fn(),
  startInterviewSession: vi.fn(),
}))

const mockTest: MockTest = {
  id: 8,
  slug: 'hr-foundations-quick',
  title: 'HR Foundations: Quick Practice',
  description: 'Practice interview introductions.',
  category: 'HR',
  difficulty: 'BEGINNER',
  format: 'QUICK_PRACTICE',
  default_mode: 'PRACTICE',
  question_count: 5,
  time_limit_seconds: 600,
  estimated_duration_minutes: 10,
  skill_tags: ['motivation'],
  company_style: false,
  version: 1,
  attempt_count: 2,
  completed_attempt_count: 2,
  latest_score: 78,
  latest_status: 'COMPLETED',
  questions: [{ position: 1, prompt: 'Tell me about yourself.', skill_tags: ['motivation'] }],
  attempts: [
    {
      session_id: 18,
      test_version: 1,
      session_type: 'PRACTICE',
      interview_mode: 'TEXT',
      status: 'COMPLETED',
      created_at: '2026-11-18T10:00:00Z',
      completed_at: '2026-11-18T10:10:00Z',
      overall_score: 70,
      skill_breakdown: { motivation: 70 },
    },
    {
      session_id: 19,
      test_version: 1,
      session_type: 'PRACTICE',
      interview_mode: 'VOICE',
      status: 'COMPLETED',
      created_at: '2026-11-19T10:00:00Z',
      completed_at: '2026-11-19T10:10:00Z',
      overall_score: 78,
      skill_breakdown: { motivation: 78 },
    },
  ],
}

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="Current path">{location.pathname}</output>
}

function renderLibrary() {
  return render(
    <MemoryRouter>
      <MockTestsLibrary />
      <LocationProbe />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(listMockTests).mockResolvedValue([mockTest])
  vi.mocked(getMockTestRecommendation).mockResolvedValue({ weakest_skill: null, recommended_test: null })
  vi.mocked(getMockTest).mockResolvedValue(mockTest)
  vi.mocked(createMockTestAttempt).mockResolvedValue({
    id: 25,
    session_type: 'PRACTICE',
    interview_mode: 'TEXT',
    category: 'HR',
    difficulty: 'BEGINNER',
    question_count: 5,
    time_limit_seconds: 1200,
    status: 'CREATED',
    consent_acknowledged: true,
    proctoring_consent_acknowledged: true,
    proctoring_max_violations: 3,
    retake_of_session_id: null,
    created_at: '2026-11-19T10:00:00Z',
    started_at: null,
    expires_at: null,
    completed_at: null,
  })
  const startedSession: InterviewSession = {
    id: 25,
    session_type: 'PRACTICE',
    interview_mode: 'TEXT',
    category: 'HR',
    difficulty: 'BEGINNER',
    question_count: 5,
    time_limit_seconds: 1200,
    status: 'IN_PROGRESS',
    consent_acknowledged: true,
    proctoring_consent_acknowledged: true,
    proctoring_max_violations: 3,
    retake_of_session_id: null,
    created_at: '2026-11-19T10:00:00Z',
    started_at: '2026-11-19T10:00:00Z',
    expires_at: '2026-11-19T10:20:00Z',
    completed_at: null,
  }
  vi.mocked(startInterviewSession).mockResolvedValue(startedSession)
  vi.mocked(compareMockTestAttempts).mockResolvedValue({
    mock_test_id: 8,
    test_version: 1,
    attempts: mockTest.attempts,
  } satisfies MockTestComparison)
})

describe('MockTestsLibrary', () => {
  it('filters catalog tests using the selected criteria', async () => {
    renderLibrary()
    await screen.findByText('HR Foundations: Quick Practice')

    fireEvent.change(screen.getByLabelText('Filter by category'), { target: { value: 'DATA_ANALYST' } })
    fireEvent.change(screen.getByLabelText('Filter by difficulty'), { target: { value: 'BEGINNER' } })
    fireEvent.change(screen.getByLabelText('Filter by format'), { target: { value: 'TOPIC_WISE' } })

    await waitFor(() => {
      expect(listMockTests).toHaveBeenLastCalledWith({
        category: 'DATA_ANALYST',
        difficulty: 'BEGINNER',
        format: 'TOPIC_WISE',
      })
    })
  })

  it('requires AI consent and starts the chosen mode in a new session', async () => {
    renderLibrary()
    fireEvent.click(await screen.findByRole('button', { name: 'Test details and attempts' }))
    expect(await screen.findByText('Tell me about yourself.')).toBeInTheDocument()
    const startButton = screen.getByRole('button', { name: 'Start mock test' })
    expect(startButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Practice type'), { target: { value: 'ASSESSMENT' } })
    fireEvent.change(screen.getByLabelText('Interview mode'), { target: { value: 'VIDEO' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /answers are sent to an external AI provider/i }))
    fireEvent.click(startButton)

    await waitFor(() => {
      expect(createMockTestAttempt).toHaveBeenCalledWith(8, {
        session_type: 'ASSESSMENT',
        interview_mode: 'VIDEO',
        consent_acknowledged: true,
      })
      expect(startInterviewSession).toHaveBeenCalledWith(25)
      expect(screen.getByLabelText('Current path')).toHaveTextContent('/interview-studio/session/25')
    })
  })

  it('compares completed attempts and allows a retake to create a fresh session', async () => {
    renderLibrary()
    fireEvent.click(await screen.findByRole('button', { name: 'Test details and attempts' }))
    await screen.findByText('Your attempts')
    const attemptCheckboxes = screen.getAllByRole('checkbox')
    expect(attemptCheckboxes).toHaveLength(3)
    fireEvent.click(attemptCheckboxes[1])
    fireEvent.click(attemptCheckboxes[2])
    fireEvent.click(screen.getByRole('button', { name: 'Compare selected attempts' }))
    expect(await screen.findByText(/Comparison · test version 1/)).toBeInTheDocument()
    await waitFor(() => expect(compareMockTestAttempts).toHaveBeenCalledWith(8, [18, 19]))

    fireEvent.click(screen.getByRole('checkbox', { name: /answers are sent to an external AI provider/i }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Retake' })[0])
    await waitFor(() => expect(createMockTestAttempt).toHaveBeenCalledWith(8, {
      session_type: 'PRACTICE',
      interview_mode: 'TEXT',
      consent_acknowledged: true,
      retake_of_session_id: 18,
    }))
  })
})
