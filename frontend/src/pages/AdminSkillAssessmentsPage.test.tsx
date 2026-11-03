import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { api } from '../api/client'
import { AdminSkillAssessmentsPage } from './AdminPages'

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  downloadAuthenticatedFile: vi.fn(),
}))

const topicStats = [{
  topic: 'python',
  name: 'Python',
  description: 'Python skills',
  icon: '🐍',
  badge_title: 'Python expert',
  active: true,
  archived_at: null,
  archived_by: null,
  attempts: 0,
  attempt_status_counts: { completed: 0, expired: 0, in_progress: 0 },
  pass_rate: 0,
  average_score: null,
  score_sample_size: 0,
  analytics_ready: false,
  active_questions: 0,
  difficulty_pool_sizes: { EASY: 0, MEDIUM: 0, HARD: 0 },
  question_pool_sizes: {
    EASY: { active: 0, inactive: 0 },
    MEDIUM: { active: 0, inactive: 0 },
    HARD: { active: 0, inactive: 0 },
  },
  bank_warnings: [],
  weakest_subtopics: [],
  hardest_questions: [],
}]

const mockPageRequests = () => {
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url.startsWith('/skills/admin/questions?')) return { data: [] } as never
    if (url.startsWith('/skills/admin/stats?')) return { data: topicStats } as never
    if (url.startsWith('/skills/admin/resources?')) return { data: [] } as never
    if (url.startsWith('/skills/admin/skill-topics?')) return { data: topicStats } as never
    if (url.includes('/subtopics')) return { data: [] } as never
    if (url.includes('/attempts?')) return { data: { items: [], total: 0, filtered_total: 0, page: 1, page_size: 10 } } as never
    return { data: topicStats[0] } as never
  })
}

const renderPage = () => render(
  <MemoryRouter initialEntries={['/admin/skill-assessments?topic=python']}>
    <AdminSkillAssessmentsPage />
    <LocationSearch />
  </MemoryRouter>,
)

function LocationSearch() {
  const location = useLocation()
  return <output data-testid="location-search">{location.search}</output>
}

beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
  mockPageRequests()
})

describe('AdminSkillAssessmentsPage resource form', () => {
  it('uses visible labeled fields and validates resource URLs inline', async () => {
    const { container } = renderPage()

    expect(await screen.findByRole('heading', { name: 'Study resources' })).toBeInTheDocument()
    const topic = screen.getByRole('combobox', { name: 'Topic ID' })
    const subtopic = container.querySelector<HTMLInputElement>('#skill-resource-subtopic')!
    const title = screen.getByLabelText('Title')
    const url = screen.getByLabelText('HTTPS / HTTP URL')

    expect(topic).toHaveTextContent('Select a topic')
    expect(subtopic).toHaveValue('general')
    expect(title).toHaveAttribute('placeholder', 'e.g. PyTorch tutorials')
    expect(url).toHaveAttribute('placeholder', 'https://...')
    for (const field of [topic, subtopic, title, url]) {
      expect(field).toHaveClass('border', 'bg-white')
      expect(field.className).toMatch(/dark:bg-slate-(800|900)/)
    }

    const form = screen.getByRole('button', { name: 'Add resource' }).closest('form')!
    fireEvent.submit(form)
    expect(await screen.findByText('Topic is required.')).toBeInTheDocument()
    expect(screen.getByText('Resource title is required.')).toBeInTheDocument()
    expect(screen.getByText('Resource URL is required.')).toBeInTheDocument()

    fireEvent.click(topic)
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Topic ID' })).getByRole('option', { name: 'python' }))
    fireEvent.change(title, { target: { value: 'PyTorch tutorials' } })
    fireEvent.change(url, { target: { value: 'ftp://example.test/course' } })
    fireEvent.submit(form)

    expect(await screen.findByText('Use a valid http:// or https:// URL.')).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('saves a resource, clears the form, and shows success', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} } as never)
    const { container } = renderPage()

    const topic = await screen.findByRole('combobox', { name: 'Topic ID' })
    fireEvent.click(topic)
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Topic ID' })).getByRole('option', { name: 'python' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'PyTorch tutorials' } })
    fireEvent.change(screen.getByLabelText('HTTPS / HTTP URL'), { target: { value: 'https://example.test/course' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add resource' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/skills/admin/resources', {
        topic: 'python',
        subtopic: 'general',
        title: 'PyTorch tutorials',
        url: 'https://example.test/course',
      })
    })
    expect(await screen.findByText('Learning resource added and audit logged.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Topic ID' })).toHaveTextContent('Select a topic')
    expect(container.querySelector<HTMLInputElement>('#skill-resource-subtopic')).toHaveValue('general')
    expect(screen.getByLabelText('Title')).toHaveValue('')
    expect(screen.getByLabelText('HTTPS / HTTP URL')).toHaveValue('')
  })

  it('updates topic-scoped cards, aborts stale topic data, and keeps the selected topic in the URL', async () => {
    const pythonStats = { ...topicStats[0], attempts: 4, attempt_status_counts: { completed: 4, expired: 0, in_progress: 0 } }
    const reactStats = { ...topicStats[0], topic: 'react', name: 'React', attempts: 9, attempt_status_counts: { completed: 7, expired: 1, in_progress: 1 } }
    const availableTopics = [pythonStats, reactStats]
    const pendingPython: Array<(value: { data: typeof topicStats }) => void> = []
    vi.mocked(api.get).mockImplementation((url) => {
      if (url.startsWith('/skills/admin/skill-topics?')) return Promise.resolve({ data: availableTopics }) as never
      if (url.includes('/subtopics')) {
        return Promise.resolve({ data: url.includes('/react/') ? [{ id: 'components', question_count: 2 }, { id: 'hooks', question_count: 3 }] : [{ id: 'async-io', question_count: 1 }, { id: 'syntax', question_count: 2 }] }) as never
      }
      if (url.includes('/attempts?')) {
        return Promise.resolve({ data: { items: [], total: 0, filtered_total: 0, page: 1, page_size: 10 } }) as never
      }
      if (url === '/skills/admin/questions?topic_id=python' || url === '/skills/admin/resources?topic_id=python') {
        return Promise.resolve({ data: [] }) as never
      }
      if (url === '/skills/admin/questions?topic_id=react' || url === '/skills/admin/resources?topic_id=react') {
        return Promise.resolve({ data: [] }) as never
      }
      if (url === '/skills/admin/stats?topic_id=python') {
        return new Promise((resolve) => pendingPython.push(resolve)) as never
      }
      if (url === '/skills/admin/stats?topic_id=react') return Promise.resolve({ data: [reactStats] }) as never
      return Promise.resolve({ data: [] }) as never
    })

    renderPage()
    const topicSelect = await screen.findByRole('combobox', { name: 'Assessment topic' })
    fireEvent.click(topicSelect)
    fireEvent.click(await screen.findByRole('option', { name: 'React (Active)' }))

    expect(await screen.findByRole('article', { name: 'React analytics' })).toHaveTextContent('9')
    const subtopicSelect = screen.getByRole('combobox', { name: 'Subtopic ID' })
    fireEvent.click(subtopicSelect)
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Subtopic ID' })).getByRole('option', { name: 'hooks' }))
    expect(subtopicSelect).toHaveTextContent('hooks')
    expect(screen.getByTestId('location-search')).toHaveTextContent('topic=react')
    expect(api.get).toHaveBeenCalledWith(
      expect.stringMatching(/\/skills\/admin\/topics\/react\/attempts\?.*topic_id=react/),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )

    fireEvent.click(topicSelect)
    fireEvent.click(await screen.findByRole('option', { name: 'Python (Active)' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Subtopic ID' })).toHaveTextContent('async-io'))
    fireEvent.click(screen.getByRole('combobox', { name: 'Assessment topic' }))
    fireEvent.click(await screen.findByRole('option', { name: 'React (Active)' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Subtopic ID' })).toHaveTextContent('hooks'))

    pendingPython.forEach((resolve) => resolve({ data: [pythonStats] }))
    await waitFor(() => {
      expect(screen.getByRole('article', { name: 'React analytics' })).toHaveTextContent('9')
      expect(screen.queryByRole('article', { name: 'Python analytics' })).not.toBeInTheDocument()
    })
  })

  it('preselects the current import topic and refreshes the selected pool after importing', async () => {
    const reactStats = { ...topicStats[0], topic: 'react', name: 'React' }
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url.startsWith('/skills/admin/skill-topics?')) return { data: [topicStats[0], reactStats] } as never
      if (url.includes('/subtopics')) return { data: [] } as never
      if (url.includes('/attempts?')) {
        return { data: { items: [], total: 0, filtered_total: 0, page: 1, page_size: 10 } } as never
      }
      if (url === '/skills/admin/stats?topic_id=react') return { data: [reactStats] } as never
      if (url.startsWith('/skills/admin/questions?') || url.startsWith('/skills/admin/resources?')) return { data: [] } as never
      return { data: topicStats } as never
    })
    vi.mocked(api.post).mockResolvedValue({ data: { imported: 1, errors: [] } } as never)
    renderPage()

    const importTopic = await screen.findByRole('combobox', { name: 'Import and template topic' })
    expect(importTopic).toHaveTextContent('python')
    fireEvent.click(importTopic)
    fireEvent.click(within(await screen.findByRole('listbox', { name: 'Import and template topic' })).getByRole('option', { name: 'react' }))
    const file = new File(['question data'], 'questions.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText('Import assessment questions from a supported file type'), {
      target: { files: [file] },
    })

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/skills/admin/questions/import?partial=true&topic_id=react',
        expect.any(FormData),
        expect.objectContaining({ headers: { 'Content-Type': 'multipart/form-data' } }),
      )
    })
    expect(await screen.findByRole('article', { name: 'React analytics' })).toBeInTheDocument()
    expect(screen.getByTestId('location-search')).toHaveTextContent('topic=react')
    expect(api.get).toHaveBeenCalledWith('/skills/admin/stats?topic_id=react', expect.any(Object))
  })
})
