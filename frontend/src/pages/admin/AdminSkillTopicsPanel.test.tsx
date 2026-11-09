import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { AdminSkillTopicsPanel } from './AdminSkillTopicsPanel'

vi.mock('../../api/client', () => ({
  api: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

const topic = {
  topic: 'python',
  name: 'Python',
  description: 'Python systems',
  icon: '🐍',
  badge_title: 'Python specialist',
  active: true,
  archived_at: null,
  archived_by: null,
  attempts: 2,
  attempt_status_counts: { completed: 1, expired: 1, in_progress: 0 },
  pass_rate: 50,
  average_score: 72.5,
  score_sample_size: 1,
  analytics_ready: false,
  active_questions: 10,
  difficulty_pool_sizes: { EASY: 4, MEDIUM: 4, HARD: 2 },
  bank_warnings: [],
  weakest_subtopics: [{ subtopic: 'syntax', average_percentage: 40, attempts: 2 }],
  hardest_questions: [],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AdminSkillTopicsPanel', () => {
  it('renders topic analytics and recent attempts', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url.startsWith('/skills/admin/skill-topics?')) return { data: [topic] } as never
      if (url.includes('/subtopics')) return { data: [] } as never
      if (url.startsWith('/skills/admin/stats?topic_id=')) return { data: [topic] } as never
      if (url.includes('/attempts?')) {
        const expiredOnly = url.includes('status=EXPIRED')
        const rows = [
          { id: 3, student_id: 8, student_email: 'student@example.test', topic: 'python', status: 'COMPLETED', score: 85, passed: true, started_at: '2025-01-01', submitted_at: '2025-01-01' },
          { id: 4, student_id: 7, student_email: 'expired@example.test', topic: 'python', status: 'EXPIRED', score: 0, passed: false, started_at: '2025-01-02', submitted_at: '2025-01-02' },
        ]
        return { data: { items: expiredOnly ? [rows[1]] : rows, total: 2, filtered_total: expiredOnly ? 1 : 2, page: 1, page_size: 10 } } as never
      }
      if (url === '/skills/admin/attempts/4?topic_id=python') return { data: { id: 4, student_id: 7, student_email: 'expired@example.test', topic: 'python', status: 'EXPIRED', score: null, passed: null, level: null, percentile: null, subtopic_scores: {}, started_at: '2025-01-02', submitted_at: '2025-01-02' } } as never
      return { data: topic } as never
    })

    render(<AdminSkillTopicsPanel />)

    expect(await screen.findAllByText('Python')).not.toHaveLength(0)
    expect(await screen.findByText('student@example.test')).toBeInTheDocument()
    expect(screen.getByText('2 total')).toBeInTheDocument()
    expect(screen.getByText('Expired · —')).toBeInTheDocument()
    expect(screen.getByText('Weakest subtopics')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expired' }))
    expect(await screen.findByText('expired@example.test')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    expect(await screen.findByRole('dialog', { name: 'Assessment attempt details' })).toHaveTextContent('Expired · —')
    expect(api.get).toHaveBeenCalledWith(
      expect.stringMatching(/\/skills\/admin\/topics\/python\/attempts\?.*topic_id=python.*status=EXPIRED/),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(api.get).toHaveBeenCalledWith('/skills/admin/attempts/4?topic_id=python', expect.any(Object))
  })

  it('shows an empty state and allows retry when topic analytics fail', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'))
    const onNotice = vi.fn()
    render(<AdminSkillTopicsPanel onNotice={onNotice} />)
    await waitFor(() => {
      expect(onNotice).toHaveBeenCalledWith(expect.objectContaining({
        title: "Couldn't load topics",
        sectionKey: 'topics',
        retry: expect.any(Function),
      }))
    })

    vi.mocked(api.get).mockResolvedValueOnce({ data: [] } as never)
    const retry = onNotice.mock.calls[0][0].retry
    await act(async () => retry?.())
    expect(await screen.findByText('No assessment topics are configured yet.')).toBeInTheDocument()
  })

  it('updates topic metadata through the administrative endpoint', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url.startsWith('/skills/admin/skill-topics?')) return { data: [topic] } as never
      if (url.includes('/subtopics')) return { data: [] } as never
      if (url.startsWith('/skills/admin/stats?topic_id=')) return { data: [topic] } as never
      if (url.includes('/attempts?')) {
        return { data: { items: [], total: 0, filtered_total: 0, page: 1, page_size: 10 } } as never
      }
      return { data: topic } as never
    })
    vi.mocked(api.patch).mockResolvedValue({ data: { ...topic, active: false } } as never)

    render(<AdminSkillTopicsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit topic' }))
    expect(screen.getByLabelText('Display name')).toHaveValue('Python')
    expect(screen.getByLabelText('Description')).toHaveValue('Python systems')
    expect(screen.getByLabelText('Display name')).toHaveClass('border-slate-300', 'bg-white')
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Python Engineering' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/skills/admin/topics/python', expect.objectContaining({ name: 'Python Engineering' }))
    })
  })

  it('creates a new topic without a topic-level active flag', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url.startsWith('/skills/admin/skill-topics?')) return { data: [topic] } as never
      if (url.includes('/subtopics')) return { data: [] } as never
      if (url.startsWith('/skills/admin/stats?topic_id=')) return { data: [topic] } as never
      if (url.includes('/attempts?')) return { data: { items: [], total: 0, filtered_total: 0, page: 1, page_size: 10 } } as never
      return { data: topic } as never
    })
    vi.mocked(api.post).mockResolvedValue({ data: { topic: 'data-science' } } as never)

    render(<AdminSkillTopicsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add topic' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add skill topic' })
    expect(dialog.querySelector('#new-skill-topic-id')).not.toBeNull()
    fireEvent.change(screen.getByLabelText('Topic ID'), { target: { value: 'data-science' } })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Data Science' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create topic' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/skills/admin/skill-topics', expect.objectContaining({
      topic: 'data-science',
      name: 'Data Science',
    })))
  })

  it('allows archiving while an in-progress attempt can finish or expire', async () => {
    const inactiveTopic = { ...topic, active: false }
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url.startsWith('/skills/admin/skill-topics?')) return { data: [inactiveTopic] } as never
      if (url.includes('/impact')) return { data: {
        total_attempts: 1,
        completed_attempts: 0,
        expired_attempts: 0,
        in_progress_attempts: 1,
        total_badges: 0,
        active_badges: 0,
        expiring_badges: 0,
        questions: 10,
        resources: 0,
      } } as never
      if (url.startsWith('/skills/admin/stats?topic_id=')) return { data: [inactiveTopic] } as never
      if (url.includes('/attempts?')) return { data: { items: [], total: 1, filtered_total: 1, page: 1, page_size: 10 } } as never
      return { data: inactiveTopic } as never
    })

    render(<AdminSkillTopicsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Archive Python' }))
    const dialog = await screen.findByRole('dialog', { name: 'Archive skill topic?' })
    expect(dialog).toHaveTextContent('In-progress attempts may finish or expire normally')
    expect(screen.getByText('1 (0 completed, 0 expired, 1 in progress)')).toBeInTheDocument()
    const archiveButton = within(dialog).getByRole('button', { name: 'Archive topic' })
    expect(archiveButton).toBeEnabled()
    fireEvent.click(archiveButton)
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/skills/admin/skill-topics/python/archive')
    })
  })
})
