import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  listAdminLearningAudit,
  listAdminLearningCategories,
  listAdminLearningPaths,
  listAdminLearningResources,
  verifyAdminLearningResource,
} from '../../services/learningLibraryAdminService'
import { AdminLearningLibraryPage } from './AdminLearningLibraryPage'

vi.mock('../../services/learningLibraryAdminService', () => ({
  createAdminLearningCategory: vi.fn(),
  createAdminLearningPath: vi.fn(),
  createAdminLearningResource: vi.fn(),
  listAdminLearningAudit: vi.fn(),
  listAdminLearningCategories: vi.fn(),
  listAdminLearningPaths: vi.fn(),
  listAdminLearningResources: vi.fn(),
  updateAdminLearningCategory: vi.fn(),
  updateAdminLearningPath: vi.fn(),
  updateAdminLearningResource: vi.fn(),
  verifyAdminLearningResource: vi.fn(),
}))

const resource = {
  id: 21,
  slug: 'python-docs',
  category_id: 1,
  category: 'programming',
  title: 'The Python Tutorial',
  description: 'Official language documentation.',
  url: 'https://docs.python.org/3/tutorial/',
  type: 'course' as const,
  level: 'BEGINNER' as const,
  role_tags: ['python-developer'],
  topic_tags: ['python'],
  active: true,
  verified_at: null,
}

describe('AdminLearningLibraryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listAdminLearningCategories).mockResolvedValue([
      { id: 1, slug: 'programming', title: 'Programming', description: '', active: true },
    ])
    vi.mocked(listAdminLearningResources).mockResolvedValue([resource])
    vi.mocked(listAdminLearningPaths).mockResolvedValue([])
    vi.mocked(listAdminLearningAudit).mockResolvedValue([
      { id: 3, action: 'learning_resource_created', entity_type: 'learning_resource', entity_id: 21, summary: { verified: false }, created_at: '2025-01-01T00:00:00Z' },
    ])
    vi.mocked(verifyAdminLearningResource).mockResolvedValue({ ...resource, verified_at: '2025-01-02T00:00:00Z' })
  })

  it('distinguishes unverified resources and provides an explicit verification action', async () => {
    render(<AdminLearningLibraryPage />)

    expect(await screen.findByText(/Unverified/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))

    await waitFor(() => expect(verifyAdminLearningResource).toHaveBeenCalledWith(resource.id))
    expect(await screen.findByRole('status')).toHaveTextContent('Resource verified and available to students.')
  })

  it('shows learning-library audit entries without student attempt content', async () => {
    render(<AdminLearningLibraryPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Audit log' }))

    expect(await screen.findByText('learning_resource_created')).toBeInTheDocument()
    expect(screen.queryByText(/answer_text|transcript|student answer/i)).not.toBeInTheDocument()
  })
})
