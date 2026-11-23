import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  approveAdminInterviewQuestion,
  getAdminInterviewAnalytics,
  getAdminInterviewAudit,
  getAdminInterviewFailures,
  getAdminInterviewProviderStatus,
  getAdminInterviewSettings,
  getAdminInterviewTaxonomy,
  listAdminInterviewQuestions,
} from '../../services/interviewStudioAdminService'
import { queryClient } from '../../lib/queryClient'
import { InterviewStudioAdminPage } from './InterviewStudioAdminPage'

vi.mock('../../services/interviewStudioAdminService', () => ({
  approveAdminInterviewQuestion: vi.fn(),
  createAdminInterviewCategory: vi.fn(),
  createAdminInterviewQuestion: vi.fn(),
  createAdminInterviewTest: vi.fn(),
  getAdminInterviewAnalytics: vi.fn(),
  getAdminInterviewAudit: vi.fn(),
  getAdminInterviewFailures: vi.fn(),
  getAdminInterviewProviderStatus: vi.fn(),
  getAdminInterviewSettings: vi.fn(),
  getAdminInterviewTaxonomy: vi.fn(),
  importAdminInterviewQuestions: vi.fn(),
  listAdminInterviewQuestions: vi.fn(),
  listAdminInterviewTests: vi.fn(),
  retryAdminInterviewFailures: vi.fn(),
  updateAdminInterviewCategory: vi.fn(),
  updateAdminInterviewDifficulty: vi.fn(),
  updateAdminInterviewQuestion: vi.fn(),
  updateAdminInterviewSettings: vi.fn(),
  updateAdminInterviewTest: vi.fn(),
}))

const question = {
  id: 17,
  seed_key: 'technical-beginner-17',
  category: 'HR',
  difficulty: 'INTERMEDIATE',
  prompt: 'Explain how you would test a small API endpoint.',
  hint: 'Think about inputs, expected outputs, and failures.',
  rubric: 'Assess correctness, test coverage, and clear reasoning.',
  active: true,
  review_status: 'DRAFT-for-review',
}

describe('InterviewStudioAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient.clear()
    vi.mocked(listAdminInterviewQuestions).mockResolvedValue({
      items: [question],
      total: 1,
      counts: { HR: 0, TECHNICAL: 1 },
    })
    vi.mocked(approveAdminInterviewQuestion).mockResolvedValue({ ...question, review_status: 'APPROVED' })
    vi.mocked(getAdminInterviewTaxonomy).mockResolvedValue({
      categories: [{ id: 1, slug: 'TECHNICAL', label: 'Technical', active: true }],
      difficulties: [],
    })
    vi.mocked(getAdminInterviewAudit).mockResolvedValue([])
    vi.mocked(getAdminInterviewAnalytics).mockResolvedValue({
      sessions_started: 0,
      sessions_completed: 0,
      mode_split: { TEXT: 0, VOICE: 0, VIDEO: 0 },
      daily: [],
      proctoring: { violation_count: 0, types: {} },
    })
    vi.mocked(getAdminInterviewFailures).mockResolvedValue({
      evaluations: [],
      reports: [],
      provider_failures: [],
    })
    vi.mocked(getAdminInterviewProviderStatus).mockResolvedValue({
      configured: true,
      provider: 'groq',
      model: 'test-model',
      last_error: null,
    })
  })

  it('shows curated bank entries without any student-attempt content', async () => {
    render(<InterviewStudioAdminPage />)

    expect(await screen.findByText(question.prompt)).toBeInTheDocument()
    expect(screen.getByText(/does not expose student answers, transcripts, reports, or recordings/i)).toBeInTheDocument()
    expect(screen.getByText(/DRAFT-for-review/)).toBeInTheDocument()
  })

  it('approves a question through the review action and reports success', async () => {
    render(<InterviewStudioAdminPage />)
    await screen.findByText(question.prompt)

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(approveAdminInterviewQuestion).toHaveBeenCalledWith(question.id))
    expect(await screen.findByRole('status')).toHaveTextContent('Question approved.')
  })

  it('loads category management when selected', async () => {
    render(<InterviewStudioAdminPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Categories' }))

    expect(await screen.findByText('Technical')).toBeInTheDocument()
    expect(getAdminInterviewTaxonomy).toHaveBeenCalled()
  })

  it('shows a friendly network error and keeps Retry for category loading', async () => {
    vi.mocked(getAdminInterviewTaxonomy).mockRejectedValue(new Error('Network Error'))
    render(<InterviewStudioAdminPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Categories' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server. Check your connection and retry.")
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('maps permission failures on Settings to a friendly message', async () => {
    vi.mocked(getAdminInterviewSettings).mockRejectedValue({
      response: { status: 403, data: { detail: 'forbidden' } },
    })
    render(<InterviewStudioAdminPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have permission to view this section.")
  })

  it('shows provider readiness in Settings without exposing provider secrets', async () => {
    vi.mocked(getAdminInterviewSettings).mockResolvedValue({
      voice_enabled: true,
      video_enabled: true,
      recording_enabled: false,
      retention_days: 30,
      sessions_per_day: 5,
      allowed_provider_hosts: ['api.groq.com'],
    })
    vi.mocked(getAdminInterviewProviderStatus).mockResolvedValue({
      configured: false,
      provider: 'groq',
      model: 'test-model',
      last_error: 'provider_api_key_missing',
    })
    render(<InterviewStudioAdminPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Provider not configured: add INTERVIEW_LLM_API_KEY.')
    expect(screen.queryByText('test-key')).not.toBeInTheDocument()
  })

  it('explains unavailable sections for 404 responses', async () => {
    vi.mocked(getAdminInterviewTaxonomy).mockRejectedValue({
      response: { status: 404, data: { detail: 'not found' } },
    })
    render(<InterviewStudioAdminPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Categories' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("This section isn't available yet.")
  })

  it('loads usage and failures independently and shows empty states', async () => {
    vi.mocked(getAdminInterviewAnalytics).mockRejectedValue({
      response: { status: 500, data: { detail: 'database error' } },
    })
    vi.mocked(getAdminInterviewFailures).mockResolvedValue({
      evaluations: [],
      reports: [],
      provider_failures: [],
    })
    render(<InterviewStudioAdminPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Usage & failures' }))

    expect(await screen.findByText('No data yet.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong on our side. Please retry.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(getAdminInterviewFailures).toHaveBeenCalled()
  })

  it('renders usage and failure responses as labelled tables rather than JSON', async () => {
    vi.mocked(getAdminInterviewAnalytics).mockResolvedValue({
      sessions_started: 7,
      sessions_completed: 4,
      mode_split: { TEXT: 1, VOICE: 2, VIDEO: 4 },
      daily: [{ date: '2026-11-23', mode: 'VIDEO', started: 4, completed: 3 }],
      proctoring: { violation_count: 2, types: { FULLSCREEN_EXIT: 1, WINDOW_BLUR: 1 } },
    })
    vi.mocked(getAdminInterviewFailures).mockResolvedValue({
      evaluations: [{ code: 'provider_not_configured', count: 3 }],
      reports: [],
      provider_failures: [],
    })
    render(<InterviewStudioAdminPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Usage & failures' }))

    expect(await screen.findByText('AI provider not configured')).toBeInTheDocument()
    expect(screen.getByText('23 Nov 2026')).toBeInTheDocument()
    expect(screen.getByText('Fullscreen exit 1')).toBeInTheDocument()
    expect(screen.getByText('Window blur 1')).toBeInTheDocument()
    expect(screen.getByText('Aggregated counts only.')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /usage by mode/i })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /daily usage/i })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /failure monitor/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry evaluation batch' })).toBeInTheDocument()
    expect(screen.queryByText(/"provider_not_configured"/)).not.toBeInTheDocument()
  })

  it('does not retry a 429 automatically and honors Retry-After', async () => {
    vi.mocked(getAdminInterviewAnalytics).mockRejectedValue({
      response: { status: 429, headers: { 'retry-after': '9' } },
    })
    render(<InterviewStudioAdminPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Usage & failures' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests, retrying in a few seconds.')
    const retryButton = screen.getByRole('button', { name: 'Retry in 9s' })
    expect(retryButton).toBeDisabled()
    expect(getAdminInterviewAnalytics).toHaveBeenCalledTimes(1)
  })

  it('reuses fresh cached usage and failure requests when returning to the tab', async () => {
    render(<InterviewStudioAdminPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Usage & failures' }))
    await screen.findAllByText('No data yet.')
    await waitFor(() => {
      expect(getAdminInterviewAnalytics).toHaveBeenCalledTimes(1)
      expect(getAdminInterviewFailures).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Usage & failures' }))
    await screen.findByRole('table', { name: 'Usage by mode' })

    expect(getAdminInterviewAnalytics).toHaveBeenCalledTimes(1)
    expect(getAdminInterviewFailures).toHaveBeenCalledTimes(1)
  })

  it('formats audit actions and summarizes only changed fields', async () => {
    vi.mocked(getAdminInterviewAudit).mockResolvedValue([{
      id: 56,
      actor_id: 18,
      actor_name: 'Morgan Admin',
      action: 'question_approved',
      entity_type: 'question',
      entity_id: '56',
      created_at: '2026-11-19T17:59:00',
      summary: {
        before: { review_status: 'DRAFT-for-review' },
        after: { review_status: 'APPROVED' },
      },
    }])
    render(<InterviewStudioAdminPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Audit log' }))

    expect((await screen.findAllByText('Question approved')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('19 Nov 2026, 5:59 PM').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Morgan Admin').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Question #56').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Status: Draft → Approved').length).toBeGreaterThan(0)
    expect(screen.getByText('Filter by action')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[0])
    expect((await screen.findAllByText(/review_status/)).length).toBeGreaterThan(0)
  })
})
