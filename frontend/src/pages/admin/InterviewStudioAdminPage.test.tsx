import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  approveAdminInterviewQuestion,
  getAdminInterviewTaxonomy,
  listAdminInterviewQuestions,
} from '../../services/interviewStudioAdminService'
import { InterviewStudioAdminPage } from './InterviewStudioAdminPage'

vi.mock('../../services/interviewStudioAdminService', () => ({
  approveAdminInterviewQuestion: vi.fn(),
  createAdminInterviewCategory: vi.fn(),
  createAdminInterviewQuestion: vi.fn(),
  createAdminInterviewTest: vi.fn(),
  getAdminInterviewAnalytics: vi.fn(),
  getAdminInterviewAudit: vi.fn(),
  getAdminInterviewFailures: vi.fn(),
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
  category: 'TECHNICAL',
  difficulty: 'BEGINNER',
  prompt: 'Explain how you would test a small API endpoint.',
  hint: 'Think about inputs, expected outputs, and failures.',
  rubric: 'Assess correctness, test coverage, and clear reasoning.',
  active: true,
  review_status: 'DRAFT-for-review',
}

describe('InterviewStudioAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listAdminInterviewQuestions).mockResolvedValue({ items: [question], total: 1 })
    vi.mocked(approveAdminInterviewQuestion).mockResolvedValue({ ...question, review_status: 'APPROVED' })
    vi.mocked(getAdminInterviewTaxonomy).mockResolvedValue({
      categories: [{ id: 1, slug: 'TECHNICAL', label: 'Technical', active: true }],
      difficulties: [{ code: 'BEGINNER', label: 'Beginner', active: true }],
    })
  })

  it('shows curated bank entries without any student-attempt content', async () => {
    render(<InterviewStudioAdminPage />)

    expect((await screen.findAllByText(question.prompt)).length).toBeGreaterThan(0)
    expect(screen.getByText(/does not expose student answers, transcripts, reports, or recordings/i)).toBeInTheDocument()
    expect((await screen.findAllByText(/DRAFT-for-review/)).length).toBeGreaterThan(0)
  })

  it('approves a question through the review action and reports success', async () => {
    render(<InterviewStudioAdminPage />)
    await screen.findAllByText(question.prompt)

    fireEvent.click(screen.getAllByRole('button', { name: `Approve question ${question.id}` })[0])

    await waitFor(() => expect(approveAdminInterviewQuestion).toHaveBeenCalledWith(question.id))
    expect(await screen.findByRole('status')).toHaveTextContent('Question approved.')
  })

  it('loads category and difficulty management when selected', async () => {
    render(<InterviewStudioAdminPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Categories & difficulty' }))

    expect(await screen.findByDisplayValue('Technical')).toBeInTheDocument()
    expect(getAdminInterviewTaxonomy).toHaveBeenCalled()
  })
})
