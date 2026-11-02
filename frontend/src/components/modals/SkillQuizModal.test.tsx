import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { SkillQuizModal } from './SkillQuizModal'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}))

beforeEach(() => vi.mocked(api.put).mockResolvedValue({ data: {} } as never))
afterEach(() => vi.clearAllMocks())

describe('server-graded skill assessment', () => {
  type TopicFixture = {
    id: string
    name: string
    icon: string
    description: string
    question_count: number
    duration_seconds: number
    pass_percentage: number
    available: boolean
    unavailable_reason: string | null
    question_counts: { easy: number; medium: number; hard: number }
  }
  const topic: TopicFixture = {
    id: 'python',
    name: 'Python',
    icon: '🐍',
    description: 'Build dependable Python services and backend systems.',
    question_count: 10,
    duration_seconds: 900,
    pass_percentage: 80,
    available: true,
    unavailable_reason: null,
    question_counts: { easy: 4, medium: 4, hard: 2 },
  }
  const questions = Array.from({ length: 10 }, (_, index) => ({
    id: index + 1,
    prompt: `Question ${index + 1}`,
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    difficulty: index < 4 ? 'EASY' : index < 8 ? 'MEDIUM' : 'HARD',
    subtopic: 'fundamentals',
    question_type: 'SINGLE' as const,
  }))

  const makeSummary = (overrides: Partial<{
    id: number
    topic: string
    score: number | null
    weighted_percentage: number | null
    passed: boolean | null
    status: string
    started_at: string
    submitted_at: string | null
    subtopic_scores: Record<string, { percentage: number }>
  }> = {}) => ({
    id: 1,
    topic: 'python',
    score: 9,
    weighted_percentage: 90,
    passed: true,
    status: 'COMPLETED',
    started_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    submitted_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    subtopic_scores: { fundamentals: { percentage: 90 } },
    ...overrides,
  })

  const mockOverview = ({
    topics = [topic],
    history = [],
    badges = [],
    attempts = [],
    activeAttempts = {},
    activeRequestFails = false,
    historyRequestFails = false,
  }: {
    topics?: TopicFixture[]
    history?: ReturnType<typeof makeSummary>[]
    badges?: Array<{ topic: string; valid: boolean; expires_soon: boolean; expires_at: string }>
    attempts?: ReturnType<typeof makeSummary>[]
    activeAttempts?: Record<string, object>
    activeRequestFails?: boolean
    historyRequestFails?: boolean
  } = {}) => {
    vi.mocked(api.get).mockImplementation((url, config) => {
      if (url === '/skills/topics') return Promise.resolve({ data: topics }) as never
      if (url === '/skills/history') {
        return historyRequestFails
          ? Promise.reject(new Error('history failed'))
          : Promise.resolve({ data: { attempts: history } }) as never
      }
      if (url === '/skills/badges') return Promise.resolve({ data: badges }) as never
      if (url === '/skills/attempts') return Promise.resolve({ data: attempts }) as never
      if (url === '/skills/assessments/active') {
        if (activeRequestFails) return Promise.reject(new Error('active check failed'))
        const topicId = (config as { params?: { topic?: string } } | undefined)?.params?.topic
        return Promise.resolve({ data: topicId ? activeAttempts[topicId] ?? null : null }) as never
      }
      return Promise.resolve({ data: null }) as never
    })
  }

  it('shows a countdown and withholds correct answers and explanations until server submission', async () => {
    mockOverview()
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
    mockOverview({ activeAttempts: { python: activeAttempt } })

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
    mockOverview()
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

  it('shows an attempted subject with its best-score progress ring and current status', async () => {
    const summary = makeSummary({ weighted_percentage: 84, passed: true })
    mockOverview({ attempts: [summary], history: [summary] })

    render(<MemoryRouter><SkillQuizModal isOpen onClose={vi.fn()} /></MemoryRouter>)

    expect(await screen.findByRole('img', { name: 'Python best score 84%' })).toBeInTheDocument()
    expect(screen.getByText('Passed', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText(/1 attempt · Last:/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retake' })).toBeEnabled()
  })

  it('shows an unattempted subject with server-provided timing and pass mark', async () => {
    mockOverview()

    render(<MemoryRouter><SkillQuizModal isOpen onClose={vi.fn()} /></MemoryRouter>)

    expect(await screen.findByText('Get Your Skills Certified')).toBeInTheDocument()
    expect(screen.getByText('10 questions · 15 mins')).toBeInTheDocument()
    expect(screen.getByText('Pass mark: 80%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Assessment' })).toBeEnabled()
  })

  it('disables retake while the 24-hour topic cooldown is active', async () => {
    const summary = makeSummary({ started_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() })
    mockOverview({ attempts: [summary], history: [summary] })

    render(<MemoryRouter><SkillQuizModal isOpen onClose={vi.fn()} /></MemoryRouter>)

    const retake = await screen.findByRole('button', { name: /Retake in \d+ hours/ })
    expect(retake).toBeDisabled()
  })

  it('shows an expired badge status on the attempted subject', async () => {
    const summary = makeSummary({ started_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() })
    mockOverview({
      attempts: [summary],
      history: [summary],
      badges: [{
        topic: 'python',
        valid: false,
        expires_soon: false,
        expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      }],
    })

    render(<MemoryRouter><SkillQuizModal isOpen onClose={vi.fn()} /></MemoryRouter>)

    expect(await screen.findByText('Badge expired')).toBeInTheDocument()
  })

  it('shows how many days remain on a valid expiring badge', async () => {
    const summary = makeSummary()
    mockOverview({
      attempts: [summary],
      history: [summary],
      badges: [{
        topic: 'python',
        valid: true,
        expires_soon: true,
        expires_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      }],
    })

    render(<MemoryRouter><SkillQuizModal isOpen onClose={vi.fn()} /></MemoryRouter>)

    expect(await screen.findByText('Badge expires in 10 days')).toBeInTheDocument()
  })

  it('disables subjects whose question bank is unavailable and explains why', async () => {
    mockOverview({
      topics: [{
        ...topic,
        available: false,
        unavailable_reason: 'Add more active hard questions to enable this topic.',
      }],
    })

    render(<MemoryRouter><SkillQuizModal isOpen onClose={vi.fn()} /></MemoryRouter>)

    expect(await screen.findByText('Add more active hard questions to enable this topic.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Assessment' })).toBeDisabled()
  })

  it('shows real skill stats and strongest and weakest subtopics', async () => {
    const pass = makeSummary({
      weighted_percentage: 90,
      passed: true,
      subtopic_scores: { fundamentals: { percentage: 90 }, async_io: { percentage: 40 } },
    })
    const fail = makeSummary({
      id: 2,
      weighted_percentage: 60,
      score: 6,
      passed: false,
      started_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      subtopic_scores: { fundamentals: { percentage: 70 }, async_io: { percentage: 30 } },
    })
    mockOverview({
      attempts: [pass, fail],
      history: [pass, fail],
      badges: [
        { topic: 'python', valid: true, expires_soon: true, expires_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString() },
        { topic: 'react', valid: false, expires_soon: false, expires_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
      ],
    })

    render(<MemoryRouter><SkillQuizModal isOpen onClose={vi.fn()} /></MemoryRouter>)

    expect(await screen.findByText('Your Skill Stats')).toBeInTheDocument()
    expect(screen.getByText('Total attempts').parentElement).toHaveTextContent('2')
    expect(screen.getByText('Passed').parentElement).toHaveTextContent('1')
    const statsPanel = screen.getByRole('complementary', { name: 'Your Skill Stats' })
    expect(statsPanel).toHaveTextContent(/Pass rate\s*50%/)
    expect(statsPanel).toHaveTextContent(/Average score\s*75%/)
    expect(statsPanel).toHaveTextContent('Best topic: Python · 90%')
    expect(statsPanel).toHaveTextContent('Badges: 2 earned · 1 valid · 1 expiring within 30 days')
    expect(statsPanel).toHaveTextContent('Strongest: fundamentals · 80%')
    expect(statsPanel).toHaveTextContent('Needs practice: async io · 35%')
  })

  it('shows an empty state for a new student', async () => {
    mockOverview()

    render(<MemoryRouter><SkillQuizModal isOpen onClose={vi.fn()} /></MemoryRouter>)

    expect(await screen.findByText(/No assessment activity yet/)).toBeInTheDocument()
  })

  it('keeps subject cards visible and offers retry when history or active status fails', async () => {
    mockOverview({ historyRequestFails: true, activeRequestFails: true })

    render(<MemoryRouter><SkillQuizModal isOpen onClose={vi.fn()} /></MemoryRouter>)

    expect(await screen.findByText('Python')).toBeInTheDocument()
    expect(screen.getByText('Get Your Skills Certified')).toBeInTheDocument()
    expect(screen.getByText(/Some assessment stats or active status could not be refreshed/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
