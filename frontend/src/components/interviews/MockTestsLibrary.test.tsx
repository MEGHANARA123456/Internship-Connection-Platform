import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockTestAttempt,
  getMockTest,
  getInterviewVideoRecordingPolicy,
  getMockTestRecommendation,
  listMockTestAttempts,
  listMockTests,
  setInterviewVideoStorageConsent,
} from '../../services/interviewService'
import type { MockTest, MockTestDetail } from '../../types/interview'
import { MockTestsLibrary } from './MockTestsLibrary'

vi.mock('../../services/interviewService', () => ({
  createMockTestAttempt: vi.fn(),
  getInterviewVideoRecordingPolicy: vi.fn(),
  getMockTest: vi.fn(),
  getMockTestRecommendation: vi.fn(),
  listMockTestAttempts: vi.fn(),
  listMockTests: vi.fn(),
  setInterviewVideoStorageConsent: vi.fn(),
}))

const mockTest: MockTest = {
  id: 8,
  slug: 'hr-foundations-quick',
  title: 'HR Foundations: Quick Practice',
  description: 'Practice interview introductions.',
  category: 'HR',
  difficulty: 'INTERMEDIATE',
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
  attempts: [],
}

const mockTestDetail: MockTestDetail = {
  id: 8,
  title: 'HR Foundations: Quick Practice',
  description: 'Practice interview introductions.',
  category: 'HR',
  difficulty: 'INTERMEDIATE',
  default_mode: 'PRACTICE',
  question_count: 5,
  time_limit_seconds: 600,
  estimated_duration_minutes: 10,
  version: 1,
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
  vi.mocked(getInterviewVideoRecordingPolicy).mockResolvedValue({ retention_days: 30, storage_backend: 'local' })
  vi.mocked(setInterviewVideoStorageConsent).mockResolvedValue()
  vi.mocked(getMockTest).mockResolvedValue(mockTestDetail)
  vi.mocked(listMockTestAttempts).mockResolvedValue([])
  vi.mocked(createMockTestAttempt).mockResolvedValue({
    id: 25,
    session_type: 'PRACTICE',
    interview_mode: 'TEXT',
    category: 'HR',
    difficulty: 'INTERMEDIATE',
    question_count: 5,
    time_limit_seconds: 1200,
    status: 'CREATED',
    consent_acknowledged: true,
    video_storage_consent: false,
    proctoring_consent_acknowledged: true,
    proctoring_max_violations: 3,
    retake_of_session_id: null,
    created_at: '2026-11-19T10:00:00Z',
    started_at: null,
    expires_at: null,
    completed_at: null,
  })
})

describe('MockTestsLibrary', () => {
  it('filters catalog tests using the selected criteria', async () => {
    renderLibrary()
    await screen.findAllByText('HR Foundations: Quick Practice')

    fireEvent.click(screen.getByRole('button', { name: 'Technical' }))
    fireEvent.change(screen.getByLabelText('Filter by format'), { target: { value: 'TOPIC_WISE' } })

    await waitFor(() => {
      expect(listMockTests).toHaveBeenLastCalledWith({
        category: 'TECHNICAL',
        format: 'TOPIC_WISE',
      })
    })
  })

  it('requires AI consent and starts the chosen mode in a new session', async () => {
    renderLibrary()
    fireEvent.click((await screen.findAllByRole('button', { name: 'View HR Foundations: Quick Practice details' }))[0])
    expect(await screen.findByText('Questions are revealed during the interview.')).toBeInTheDocument()
    expect(screen.queryByText('Tell me about yourself.')).not.toBeInTheDocument()
    const startButton = screen.getByRole('button', { name: 'Start mock test' })
    expect(startButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Practice type'), { target: { value: 'ASSESSMENT' } })
    fireEvent.change(screen.getByLabelText('Interview mode'), { target: { value: 'VIDEO' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /may be sent to any AI provider configured/i }))
    fireEvent.click(startButton)

    await waitFor(() => {
      expect(createMockTestAttempt).toHaveBeenCalledWith(8, {
        session_type: 'ASSESSMENT',
        interview_mode: 'VIDEO',
        consent_acknowledged: true,
        video_storage_consent: false,
      })
      expect(screen.getByLabelText('Current path')).toHaveTextContent('/interview-studio/session/25')
    })
    expect(listMockTestAttempts).toHaveBeenCalledWith(8)
  })

  it('shows metadata and the start form without exposing question or attempt lists', async () => {
    renderLibrary()
    fireEvent.click((await screen.findAllByRole('button', { name: 'View HR Foundations: Quick Practice details' }))[0])
    expect(await screen.findByRole('heading', { name: 'HR Foundations: Quick Practice' })).toBeInTheDocument()
    expect(screen.getByText('Version 1 · 5 questions · ~10 minutes')).toBeInTheDocument()
    expect(screen.getByText('Practice interview introductions.', { selector: 'p.text-sm' })).toBeInTheDocument()
    expect(screen.getByText('Questions are revealed during the interview.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Start a new attempt' })).toBeInTheDocument()
    expect(screen.queryByText('Tell me about yourself.')).not.toBeInTheDocument()
    expect(screen.queryByText('Your attempts')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Question list' })).not.toBeInTheDocument()
    await waitFor(() => expect(getMockTest).toHaveBeenCalledWith(8))
  })
})
