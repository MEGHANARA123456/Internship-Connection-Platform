import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { SkillQuizModal } from './SkillQuizModal'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}))

afterEach(() => vi.clearAllMocks())

describe('server-graded skill assessment', () => {
  const topic = { id: 'python', name: 'Python', icon: '🐍' }
  const questions = Array.from({ length: 10 }, (_, index) => ({
    id: index + 1,
    prompt: `Question ${index + 1}`,
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    difficulty: index < 4 ? 'EASY' : index < 8 ? 'MEDIUM' : 'HARD',
    subtopic: 'fundamentals',
    question_type: 'SINGLE' as const,
  }))

  it('shows a countdown and withholds correct answers and explanations until server submission', async () => {
    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({
      data: url === '/skills/topics' ? [topic] : null,
    }) as never)
    vi.mocked(api.post)
      .mockResolvedValueOnce({
        data: {
          attempt_id: 81,
          topic: 'python',
          started_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
          duration_seconds: 900,
          remaining_seconds: 900,
          resumed: false,
          answers: null,
          questions,
        },
      } as never)
      .mockResolvedValueOnce({
        data: {
          score: 100,
          attempt_id: 81,
          raw_score: 10,
          weighted_percentage: 100,
          time_taken_seconds: 100,
          percentile: 'Not enough data yet',
          passed: true,
          level: 'Advanced',
          badge: {
            topic: 'python',
            title: 'Verified Python Specialist',
            level: 'Advanced',
            score: 100,
            earned_at: '2026-10-23T00:00:00Z',
            expires_at: '2027-10-23T00:00:00Z',
          },
          questions: questions.map((question) => ({
            question_id: question.id,
            prompt: question.prompt,
            selected_answer: 'Option A',
            correct_answer: 'Option A',
            explanation: 'Server-only explanation',
            is_correct: true,
            earned_credit: 1,
            time_seconds: 10,
          })),
        },
      } as never)
    const onBadgeAwarded = vi.fn()

    render(<MemoryRouter><SkillQuizModal isOpen onClose={vi.fn()} onBadgeAwarded={onBadgeAwarded} /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Start Assessment/ }))

    expect(await screen.findByText('Question 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Time remaining')).toHaveTextContent('15:00')
    expect(screen.queryByText('Server-only explanation')).not.toBeInTheDocument()
    expect(questions[0]).not.toHaveProperty('correct_index')
    expect(questions[0]).not.toHaveProperty('explanation')

    for (let index = 0; index < questions.length; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Option A' }))
      if (index < questions.length - 1) {
        fireEvent.click(screen.getByRole('button', { name: 'Next Question →' }))
      }
    }
    fireEvent.click(screen.getByRole('button', { name: 'Submit Assessment' }))

    expect(await screen.findByText('Assessment passed')).toBeInTheDocument()
    expect(screen.getAllByText('Server-only explanation')).toHaveLength(10)
    expect(api.post).toHaveBeenLastCalledWith('/skills/assessments/81/submit', {
      answers: Array(10).fill(0),
      question_time_seconds: expect.any(Array),
    })
    await waitFor(() => expect(onBadgeAwarded).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Verified Python Specialist',
      level: 'Advanced',
    })))
    expect(await screen.findByText(/Badge expires on/)).toBeInTheDocument()
  })

  it('offers resume and restores saved answers and server remaining time', async () => {
    const activeAttempt = {
      attempt_id: 82,
      topic: 'python',
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 112_000).toISOString(),
      duration_seconds: 900,
      remaining_seconds: 112,
      resumed: true,
      answers: [0, ...Array(9).fill(null)],
      questions,
    }
    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({
      data: url === '/skills/topics' ? [topic] : activeAttempt,
    }) as never)

    render(<MemoryRouter><SkillQuizModal isOpen onClose={vi.fn()} /></MemoryRouter>)

    const resume = await screen.findByRole('button', { name: /Resume \(01:52 left\)/ })
    fireEvent.click(resume)

    expect(await screen.findByText('Question 2')).toBeInTheDocument()
    expect(screen.getByLabelText('Time remaining')).toHaveTextContent('01:52')
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('Question 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Option A' }).className).toContain('border-indigo-600')
    expect(api.get).toHaveBeenCalledWith('/skills/assessments/active', { params: { topic: 'python' } })
  })

  it('shows the exact next-available time from a structured cooldown error', async () => {
    const retryAt = '2026-10-30T14:35:00Z'
    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({
      data: url === '/skills/topics' ? [topic] : null,
    }) as never)
    vi.mocked(api.post).mockRejectedValue({
      response: {
        data: {
          detail: {
            code: 'COOLDOWN',
            next_available_at: retryAt,
            detail: 'You can retake this topic 24 hours after your previous attempt.',
          },
        },
      },
    })

    render(<MemoryRouter><SkillQuizModal isOpen onClose={vi.fn()} /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Start Assessment/ }))

    const formattedRetryAt = new Date(retryAt).toLocaleString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(`Available on ${formattedRetryAt}.`)
  })
})
