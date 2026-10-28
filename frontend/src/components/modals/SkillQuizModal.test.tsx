import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { SkillQuizModal } from './SkillQuizModal'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}))

afterEach(() => vi.clearAllMocks())

describe('server-graded skill assessment', () => {
  it('shows a countdown and withholds correct answers and explanations until server submission', async () => {
    const questions = Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      prompt: `Question ${index + 1}`,
      options: ['Option A', 'Option B', 'Option C', 'Option D'],
      difficulty: index < 4 ? 'EASY' : index < 8 ? 'MEDIUM' : 'HARD',
      subtopic: 'fundamentals',
      question_type: 'SINGLE' as const,
    }))
    vi.mocked(api.get).mockResolvedValue({ data: [{ id: 'python', name: 'Python', icon: '🐍' }] } as never)
    vi.mocked(api.post)
      .mockResolvedValueOnce({
        data: {
          attempt_id: 81,
          topic: 'python',
          started_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
          duration_seconds: 900,
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
  })
})
