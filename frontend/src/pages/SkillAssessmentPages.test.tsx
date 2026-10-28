import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { SkillAssessmentHistoryPage, SkillAssessmentResultPage } from './SkillAssessmentPages'

vi.mock('../api/client', () => ({
  api: { get: vi.fn() },
}))

afterEach(() => vi.clearAllMocks())

describe('skill assessment reports', () => {
  it('shows private question feedback and verified badge data for the selected attempt', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        attempt_id: 12,
        topic: 'python',
        attempt_number: 1,
        score: 90,
        raw_score: 9.5,
        weighted_percentage: 90,
        level: 'Advanced',
        passed: true,
        percentile: 'Not enough data yet',
        time_taken_seconds: 240,
        submitted_at: '2026-10-23T00:00:00Z',
        retake_at: '2026-10-24T00:00:00Z',
        badge: { title: 'Verified Python Specialist', level: 'Advanced', expires_at: '2027-10-23T00:00:00Z' },
        questions: [{
          question_id: 1,
          prompt: 'What does await do?',
          subtopic: 'async-io',
          difficulty: 'HARD',
          selected_answer: 'Wait',
          correct_answer: 'Suspend the coroutine',
          explanation: 'Await yields control until the awaitable completes.',
          is_correct: false,
          earned_credit: 0,
          time_seconds: 24,
        }],
        subtopic_scores: { 'async-io': { earned: 0, possible: 3, percentage: 0 } },
        difficulty_scores: { HARD: { correct: 0, total: 1, percentage: 0 } },
        strengths: [],
        weak_subtopics: [{
          subtopic: 'async-io',
          tip: 'Review coroutine scheduling.',
          learning_links: [{ title: 'Python guide', url: 'https://docs.python.org/' }],
        }],
        matching_internships: [],
      },
    } as never)

    render(
      <MemoryRouter initialEntries={['/skills/results/12']}>
        <Routes>
          <Route path="/skills/results/:attemptId" element={<SkillAssessmentResultPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('90%')).toBeInTheDocument()
    expect(screen.getByText('Verified Python Specialist')).toBeInTheDocument()
    expect(screen.getByText('Correct answer: Suspend the coroutine')).toBeInTheDocument()
    expect(screen.getByText('Await yields control until the awaitable completes.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download PDF/ })).toBeInTheDocument()
  })

  it('shows the trend delta between prior topic attempts', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        attempts: [
          {
            attempt_id: 10,
            topic: 'python',
            attempt_number: 1,
            score: 70,
            weighted_percentage: 70,
            passed: false,
            submitted_at: '2026-10-20T00:00:00Z',
            change_from_previous: null,
          },
          {
            attempt_id: 11,
            topic: 'python',
            attempt_number: 2,
            score: 80,
            weighted_percentage: 80,
            passed: true,
            submitted_at: '2026-10-22T00:00:00Z',
            change_from_previous: 10,
          },
        ],
      },
    } as never)

    render(<MemoryRouter><SkillAssessmentHistoryPage /></MemoryRouter>)

    expect(await screen.findByText('+10 points since previous')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'View report' }).some((link) => link.getAttribute('href') === '/skills/results/11')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'python' }))
    expect(screen.getByRole('img', { name: 'Score-over-time chart for python' })).toBeInTheDocument()
  })
})
