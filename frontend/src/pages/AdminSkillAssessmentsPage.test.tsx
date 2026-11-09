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
    if (url === '/skills/admin/questions/key-review') return { data: [] } as never
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
  it('hides the key review section when the successful response is empty', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.queryByLabelText('Loading answer key review')).not.toBeInTheDocument()
      expect(api.get).toHaveBeenCalledWith('/skills/admin/questions/key-review', expect.anything())
    })
    expect(screen.queryByRole('region', { name: 'Answer key verification' })).not.toBeInTheDocument()
    expect(screen.queryByText('No questions need key verification.')).not.toBeInTheDocument()
  })

  it('uses visible labeled fields and validates resource URLs inline', async () => {
    const { container } = renderPage()

    expect(await screen.findByRole('heading', { name: 'Study resources' })).toBeInTheDocument()
    const topic = screen.getByRole('combobox', { name: 'Topic ID' })
    const subtopic = container.querySelector<HTMLInputElement>('#skill-resource-subtopic')!
    const title = screen.getByLabelText('Title')
    const url = screen.getByLabelText('URL')

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
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.test/course' } })
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
    expect(screen.getByLabelText('URL')).toHaveValue('')
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
    fireEvent.click(await screen.findByRole('option', { name: 'React' }))

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
    fireEvent.click(await screen.findByRole('option', { name: 'Python' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Subtopic ID' })).toHaveTextContent('async-io'))
    fireEvent.click(screen.getByRole('combobox', { name: 'Assessment topic' }))
    fireEvent.click(await screen.findByRole('option', { name: 'React' }))
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
      if (url === '/skills/admin/questions/key-review') return { data: [] } as never
      if (url.startsWith('/skills/admin/questions?') || url.startsWith('/skills/admin/resources?')) return { data: [] } as never
      return { data: topicStats } as never
    })
    vi.mocked(api.post).mockResolvedValue({ data: { imported: 1, errors: [] } } as never)
    renderPage()

    const importTopic = await screen.findByRole('combobox', { name: 'Template topic' })
    expect(importTopic).toHaveTextContent('python')
    fireEvent.click(importTopic)
    fireEvent.click(within(await screen.findByRole('listbox', { name: 'Template topic' })).getByRole('option', { name: 'react' }))
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

  it('uses 1-based option numbers in the form and list while sending zero-based keys', async () => {
    const storedQuestion = {
      id: 8,
      topic: 'python',
      subtopic: 'syntax',
      prompt: 'What is the complexity?',
      options: ['O(n)', 'O(1)'],
      correct_index: 1,
      correct_answers: null,
      explanation: 'Constant time.',
      difficulty: 'EASY',
      question_type: 'SINGLE',
      source: 'Admin curated question',
      active: true,
    }
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url.startsWith('/skills/admin/questions?')) return { data: [storedQuestion] } as never
      if (url === '/skills/admin/questions/key-review') return { data: [] } as never
      if (url.startsWith('/skills/admin/stats?')) return { data: topicStats } as never
      if (url.startsWith('/skills/admin/skill-topics?')) return { data: topicStats } as never
      if (url.startsWith('/skills/admin/resources?')) return { data: [] } as never
      if (url.includes('/subtopics')) return { data: [] } as never
      if (url.includes('/attempts?')) return { data: { items: [], total: 0, filtered_total: 0, page: 1, page_size: 10 } } as never
      return { data: topicStats[0] } as never
    })
    vi.mocked(api.post).mockResolvedValue({ data: {} } as never)
    renderPage()

    expect(await screen.findByText("2 options · Correct: 2 - 'O(1)'")).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const numberField = await screen.findByLabelText('Correct option number')
    expect(numberField).toHaveValue(2)
    expect(numberField).toHaveAttribute('min', '1')
    expect(numberField).toHaveAttribute('max', '2')
    expect(screen.getByText("Correct answer: 'O(1)'")).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Which is constant time?' } })
    fireEvent.change(screen.getByLabelText('Answer options (one per line)'), { target: { value: 'O(n)\nO(1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save question' }))
    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/skills/admin/questions/8', expect.objectContaining({
        correct_index: 1,
        correct_answers: [],
        options: ['O(n)', 'O(1)'],
      }))
    })
  })

  it('defaults the answer to option 1, updates max, and converts MULTI numbers to sorted indexes', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} } as never)
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Add question' })).toBeInTheDocument()

    const correctNumber = screen.getByLabelText('Correct option number')
    expect(correctNumber).toHaveValue(1)
    fireEvent.change(screen.getByLabelText('Answer options (one per line)'), { target: { value: 'A\nB\nC' } })
    expect(correctNumber).toHaveAttribute('max', '3')

    fireEvent.click(screen.getByRole('combobox', { name: 'Question type' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Multiple answers' }))
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Choose two' } })
    fireEvent.change(screen.getByLabelText('Answer options (one per line)'), { target: { value: 'A\nB\nC' } })
    fireEvent.change(screen.getByLabelText('Correct option numbers, comma separated'), { target: { value: '3, 1' } })
    fireEvent.change(screen.getByLabelText('Explanation'), { target: { value: 'Two answers are correct.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create question' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/skills/admin/questions', expect.objectContaining({
        correct_index: null,
        correct_answers: [0, 2],
        options: ['A', 'B', 'C'],
      }))
    })
  })

  it('converts the TRUE_FALSE form number to the stored zero-based index', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} } as never)
    renderPage()
    await screen.findByRole('heading', { name: 'Add question' })
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Is this true?' } })
    fireEvent.change(screen.getByLabelText('Answer options (one per line)'), { target: { value: 'True\nFalse' } })
    fireEvent.change(screen.getByLabelText('Explanation'), { target: { value: 'False is correct.' } })
    fireEvent.click(screen.getByRole('combobox', { name: 'Question type' }))
    fireEvent.click(await screen.findByRole('option', { name: 'True / false' }))
    fireEvent.change(screen.getByLabelText('Correct option number'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create question' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/skills/admin/questions', expect.objectContaining({
        question_type: 'TRUE_FALSE',
        correct_index: 1,
        correct_answers: [],
      }))
    })
  })

  it('shows legacy keys in a review table and submits the selected one-based correction', async () => {
    const unreviewed = {
      id: 21,
      topic: 'python',
      subtopic: 'syntax',
      prompt: 'Which option is correct?',
      options: ['First', 'Second'],
      correct_index: 0,
      correct_answers: null,
      correct_option_number: 1,
      correct_option_numbers: [1],
      explanation: 'Explanation',
      difficulty: 'EASY',
      question_type: 'SINGLE',
      source: 'Admin curated question',
      active: true,
    }
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/skills/admin/questions/key-review') return { data: [unreviewed] } as never
      if (url.startsWith('/skills/admin/skill-topics?')) return { data: topicStats } as never
      if (url.startsWith('/skills/admin/questions?')) return { data: [] } as never
      if (url.startsWith('/skills/admin/stats?')) return { data: topicStats } as never
      if (url.startsWith('/skills/admin/resources?') || url.includes('/subtopics')) return { data: [] } as never
      if (url.includes('/attempts?')) return { data: { items: [], total: 0, filtered_total: 0, page: 1, page_size: 10 } } as never
      return { data: topicStats[0] } as never
    })
    vi.mocked(api.post).mockResolvedValue({ data: {} } as never)
    renderPage()

    const reviewRegion = await screen.findByRole('region', { name: 'Answer key verification' })
    expect(within(reviewRegion).getByText('1 questions need key verification')).toBeInTheDocument()
    expect(within(reviewRegion).getByText('1. First — Current key')).toBeInTheDocument()
    fireEvent.change(within(reviewRegion).getByLabelText('Correct option number'), { target: { value: '2' } })
    fireEvent.click(within(reviewRegion).getByRole('button', { name: 'Fix key' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/skills/admin/questions/21/key-review', {
        correct_option_number: 2,
      })
    })
  })

  it('keeps sections visible when key review fails and retries only that section from the top notice', async () => {
    let keyReviewCalls = 0
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/skills/admin/questions/key-review') {
        keyReviewCalls += 1
        if (keyReviewCalls === 1) throw new Error('request failed')
        return { data: [] } as never
      }
      if (url.startsWith('/skills/admin/skill-topics?')) return { data: topicStats } as never
      if (url.startsWith('/skills/admin/stats?')) return { data: topicStats } as never
      if (url.startsWith('/skills/admin/questions?')) return { data: [] } as never
      if (url.startsWith('/skills/admin/resources?')) return { data: [] } as never
      if (url.includes('/subtopics')) return { data: [] } as never
      if (url.includes('/attempts?')) {
        return { data: { items: [], total: 0, filtered_total: 0, page: 1, page_size: 10 } } as never
      }
      return { data: topicStats[0] } as never
    })
    renderPage()

    const noticeRegion = await screen.findByLabelText('Skill assessment notifications')
    expect(within(noticeRegion).getByText("Couldn't load key review")).toBeInTheDocument()
    expect(noticeRegion.parentElement?.children[1]).toBe(noticeRegion)
    expect(screen.getByText('Answer keys could not be loaded. Use Retry above to try again.')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Question bank (0)' })).toBeInTheDocument()
    expect(screen.getByText('0 resources shown')).toBeInTheDocument()
    expect(screen.queryByText('No assessment topics are configured yet.')).not.toBeInTheDocument()

    fireEvent.click(within(noticeRegion).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(keyReviewCalls).toBe(2))
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url.startsWith('/skills/admin/questions?'))).toHaveLength(1)
    expect(screen.queryByLabelText('Skill assessment notifications')).not.toBeInTheDocument()
  })

  it('renders difficulty pool counts as whole nowrap chips', async () => {
    const readyTopic = [{
      ...topicStats[0],
      difficulty_pool_sizes: { EASY: 4, MEDIUM: 9, HARD: 2 },
    }]
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url.startsWith('/skills/admin/skill-topics?') || url.startsWith('/skills/admin/stats?')) {
        return { data: readyTopic } as never
      }
      if (url === '/skills/admin/questions/key-review') return { data: [] } as never
      if (url.startsWith('/skills/admin/questions?') || url.startsWith('/skills/admin/resources?')) return { data: [] } as never
      if (url.includes('/subtopics')) return { data: [] } as never
      if (url.includes('/attempts?')) return { data: { items: [], total: 0, filtered_total: 0, page: 1, page_size: 10 } } as never
      return { data: readyTopic[0] } as never
    })
    renderPage()

    for (const [label, width] of [['Easy 4', 360], ['Medium 9', 768], ['Hard 2', 1280]] as const) {
      window.innerWidth = width
      fireEvent(window, new Event('resize'))
      await waitFor(() => expect(screen.getAllByLabelText('Question pool by difficulty')).toHaveLength(2))
      for (const pool of screen.getAllByLabelText('Question pool by difficulty')) {
        const chip = Array.from(pool.querySelectorAll('span')).find((item) => item.textContent?.trim() === label)
        expect(chip).toHaveClass('whitespace-nowrap', 'shrink-0')
        expect(pool).toHaveClass('flex-wrap')
      }
    }
  })
})
