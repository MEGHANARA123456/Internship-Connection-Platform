import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLearningPath,
  getLearningPreference,
  getLearningProgress,
  getLearningRecommendations,
  listLearningCategories,
  listLearningPaths,
  listLearningResources,
  setLearningBookmark,
  updateLearningPreference,
  updateLearningResourceProgress,
} from '../../services/learningLibraryService'
import { StudentLearningLibraryPage } from './StudentLearningLibraryPage'

vi.mock('../../services/learningLibraryService', () => ({
  getLearningPath: vi.fn(),
  getLearningPreference: vi.fn(),
  getLearningProgress: vi.fn(),
  getLearningRecommendations: vi.fn(),
  listLearningCategories: vi.fn(),
  listLearningPaths: vi.fn(),
  listLearningResources: vi.fn(),
  setLearningBookmark: vi.fn(),
  updateLearningPreference: vi.fn(),
  updateLearningResourceProgress: vi.fn(),
}))

const resource = {
  id: 8,
  slug: 'python-tutorial',
  category_id: 1,
  category: 'programming',
  title: 'The Python Tutorial',
  description: 'An official guide to Python fundamentals.',
  url: 'https://docs.python.org/3/tutorial/',
  type: 'course' as const,
  level: 'BEGINNER' as const,
  role_tags: ['python-developer'],
  topic_tags: ['python', 'courses'],
  verified_at: '2025-01-01T00:00:00Z',
  progress: null,
  bookmarked: false,
}

const path = {
  id: 4,
  slug: 'python-developer',
  category: 'programming',
  title: 'Python Developer',
  description: 'Build practical Python development skills.',
  role_tags: ['python-developer'],
  topic_tags: ['python'],
  resource_count: 1,
  completed_count: 0,
  progress_percent: 0,
  resources: [resource],
}

describe('StudentLearningLibraryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listLearningCategories).mockResolvedValue([
      { id: 1, slug: 'programming', title: 'Programming', description: '' },
    ])
    vi.mocked(getLearningPreference).mockResolvedValue({ target_role: null })
    vi.mocked(listLearningPaths).mockResolvedValue([path])
    vi.mocked(listLearningResources).mockResolvedValue({ items: [resource], total: 1 })
    vi.mocked(getLearningProgress).mockResolvedValue({ viewed_count: 0, completed_count: 0, items: [] })
    vi.mocked(getLearningRecommendations).mockResolvedValue({
      target_role: null,
      weakest_skill: null,
      resources: [],
      paths: [],
    })
    vi.mocked(getLearningPath).mockResolvedValue(path)
    vi.mocked(updateLearningPreference).mockImplementation(async (target_role) => ({ target_role }))
    vi.mocked(setLearningBookmark).mockResolvedValue({ resource_id: resource.id, bookmarked: true })
    vi.mocked(updateLearningResourceProgress).mockResolvedValue({ resource_id: resource.id, status: 'COMPLETED' })
  })

  it('shows role-based paths and opens verified resources with safe external-link attributes', async () => {
    render(<StudentLearningLibraryPage />)

    const pathButton = (await screen.findAllByRole('button', { name: /View Python Developer learning path/ }))[0]
    expect(pathButton).toBeInTheDocument()
    fireEvent.click(pathButton)

    const link = (await screen.findAllByRole('link', { name: 'Open The Python Tutorial' }))[0]
    expect(link).toHaveAttribute('href', resource.url)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('saves target-role preferences and resource completion', async () => {
    render(<StudentLearningLibraryPage />)
    fireEvent.change(await screen.findByLabelText('Your target role'), {
      target: { value: 'python-developer' },
    })
    await waitFor(() => expect(updateLearningPreference).toHaveBeenCalledWith('python-developer'))

    fireEvent.click(screen.getByRole('button', { name: 'Coding Practice' }))
    fireEvent.click((await screen.findAllByRole('button', { name: 'Mark The Python Tutorial complete' }))[0])
    await waitFor(() => expect(updateLearningResourceProgress).toHaveBeenCalledWith(resource.id, 'COMPLETED'))
    expect(await screen.findByRole('status')).toHaveTextContent('Progress saved.')
  })

  it('toggles a bookmark through the student service', async () => {
    render(<StudentLearningLibraryPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Interview Questions' }))
    fireEvent.click((await screen.findAllByRole('button', { name: 'Bookmark The Python Tutorial' }))[0])

    await waitFor(() => expect(setLearningBookmark).toHaveBeenCalledWith(resource.id, true))
    expect((await screen.findAllByRole('button', { name: 'Remove The Python Tutorial bookmark' })).length).toBeGreaterThan(0)
  })
})
