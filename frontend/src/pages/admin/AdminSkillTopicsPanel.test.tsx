import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { AdminSkillTopicsPanel } from './AdminSkillTopicsPanel'

vi.mock('../../api/client', () => ({
  api: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}))

const topic = {
  topic: 'python',
  name: 'Python',
  description: 'Python systems',
  icon: '🐍',
  badge_title: 'Python specialist',
  active: true,
  attempts: 2,
  pass_rate: 50,
  average_score: 72.5,
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
      if (url === '/skills/admin/topics') return { data: [topic] } as never
      if (url.includes('/attempts?')) {
        return { data: { items: [{ id: 3, student_id: 8, student_email: 'student@example.test', status: 'COMPLETED', score: 85, passed: true, started_at: '2025-01-01', submitted_at: '2025-01-01' }], total: 1, page: 1, page_size: 10 } } as never
      }
      return { data: topic } as never
    })

    render(<AdminSkillTopicsPanel />)

    expect(await screen.findAllByText('Python')).not.toHaveLength(0)
    expect(await screen.findByText('student@example.test')).toBeInTheDocument()
    expect(screen.getByText('Weakest subtopics')).toBeInTheDocument()
  })

  it('shows an empty state and allows retry when topic analytics fail', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'))
    render(<AdminSkillTopicsPanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Topic analytics could not be loaded.')

    vi.mocked(api.get).mockResolvedValueOnce({ data: [] } as never)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No assessment topics are configured yet.')).toBeInTheDocument()
  })

  it('updates topic metadata through the administrative endpoint', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/skills/admin/topics') return { data: [topic] } as never
      if (url.includes('/attempts?')) {
        return { data: { items: [], total: 0, page: 1, page_size: 10 } } as never
      }
      return { data: topic } as never
    })
    vi.mocked(api.patch).mockResolvedValue({ data: { ...topic, active: false } } as never)

    render(<AdminSkillTopicsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit topic' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Topic active' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/skills/admin/topics/python', expect.objectContaining({ active: false }))
    })
  })
})
