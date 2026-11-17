import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { api } from '../../api/client'
import { CompanyApplicantsRedesign } from '../CompanyApplicantsRedesign'

vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
  downloadAuthenticatedFile: vi.fn(),
}))

const application = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  internship_id: 12,
  internship_title: 'Frontend Engineering Internship',
  student_id: 42,
  student_name: 'Avery Candidate',
  student_university: 'Example University',
  student_skills: ['React', 'TypeScript', 'CSS', 'Testing', 'Accessibility', 'Node', 'SQL'],
  status: 'APPLIED',
  allowed_next: ['UNDER_REVIEW'],
  allowed_actions: ['MOVE_TO_REVIEW'],
  created_at: '2026-10-12T12:00:00Z',
  resume_id: 8,
  match_score: 76,
  ...overrides,
})

function searchResponse(items: ReturnType<typeof application>[]) {
  return { data: { items, total: items.length, status_counts: {} } }
}

function CurrentQuery() {
  const location = useLocation()
  return <output data-testid="current-query">{location.search}</output>
}

function renderPage(pipeline: boolean, path: string, view: 'applicants' | 'shortlisted' = 'shortlisted') {
  return render(<MemoryRouter initialEntries={[path]}><CompanyApplicantsRedesign pipeline={pipeline} view={view} /><CurrentQuery /></MemoryRouter>)
}

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/internships/mine') return { data: [
      { id: 12, title: 'Sales Manager', location: 'Pune', created_at: '2026-10-10T00:00:00Z', applicant_count: 3 },
      { id: 13, title: 'Sales Manager', location: 'Mumbai', created_at: '2026-10-12T00:00:00Z', applicant_count: 2 },
      { id: 14, title: 'Sales Manager', location: 'Pune', created_at: '2026-10-11T00:00:00Z', applicant_count: 3 },
    ] } as never
    if (url === '/applications/company/search') return searchResponse([]) as never
    return { data: [] } as never
  })
  vi.mocked(api.patch).mockResolvedValue({ data: {} } as never)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('company pipeline and shortlisted redesign', () => {
  it('uses local calendar days for relative application dates', async () => {
    const previousTimezone = process.env.TZ
    try {
      process.env.TZ = 'UTC'
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-11T12:00:00Z'))
      vi.mocked(api.get).mockImplementation(async (url) => {
        if (url === '/internships/mine') return { data: [] } as never
        if (url === '/applications/company/search') return searchResponse([
          application({ id: 1, created_at: '2026-11-11T11:00:00Z' }),
          application({ id: 2, created_at: '2026-11-10T19:00:00Z' }),
          application({ id: 3, created_at: '2026-10-22T12:00:00Z' }),
          application({ id: 4, created_at: '2026-11-10T23:45:00' }),
        ]) as never
        return { data: [] } as never
      })
      renderPage(false, '/company/applicants', 'applicants')

      await waitFor(() => expect(screen.getAllByText('20 days ago').length).toBeGreaterThan(0))
      expect(screen.getAllByText('today').length).toBeGreaterThan(0)
      expect(screen.getAllByText('yesterday').length).toBeGreaterThan(0)
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ
      else process.env.TZ = previousTimezone
    }
  })

  it('compares dates across midnight in the Asia/Kolkata timezone', async () => {
    const previousTimezone = process.env.TZ
    try {
      process.env.TZ = 'Asia/Kolkata'
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-11T18:40:00Z'))
      vi.mocked(api.get).mockImplementation(async (url) => {
        if (url === '/internships/mine') return { data: [] } as never
        if (url === '/applications/company/search') return searchResponse([
          application({ id: 5, created_at: '2026-11-11T18:10:00Z' }),
        ]) as never
        return { data: [] } as never
      })
      renderPage(false, '/company/applicants', 'applicants')

      await waitFor(() => expect(screen.getByText('yesterday')).toBeInTheDocument())
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ
      else process.env.TZ = previousTimezone
    }
  })

  it('formats the applied-column date day-first in Indian English', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/internships/mine') return { data: [] } as never
      if (url === '/applications/company/search') return searchResponse([
        application({ created_at: '2026-10-12T12:00:00Z' }),
      ]) as never
      return { data: [] } as never
    })
    renderPage(false, '/company/applicants', 'applicants')

    expect(await screen.findByText('12 Oct 2026')).toBeInTheDocument()
  })

  it('keeps applicant filters and actions aligned in one responsive control group', async () => {
    let { unmount } = renderPage(false, '/company/applicants', 'applicants')

    const filters = screen.getByRole('group', { name: 'Candidate filters' })
    expect(await within(filters).findByRole('combobox', { name: 'Sort by' })).toHaveClass('h-10')
    const search = within(filters).getByRole('combobox', { name: 'Search name, skill, education or internship' })
    expect(search).toHaveClass('h-10')
    expect(search).toHaveAttribute('placeholder', 'Search name, skill, education or internship')
    expect(within(filters).queryByRole('textbox', { name: /skills|education/i })).not.toBeInTheDocument()
    for (const name of ['Filter by internship', 'Filter by verified skill']) {
      expect(within(filters).getByRole('combobox', { name })).toHaveClass('h-10')
    }
    expect(within(filters).getByRole('button', { name: 'Apply' })).toHaveClass('h-10', 'bg-indigo-600')
    expect(within(filters).getByRole('button', { name: 'Clear filters' })).toHaveClass('h-10')
    expect(filters).toHaveClass('items-end', 'xl:grid-cols-[minmax(16rem,1fr)_minmax(12rem,1fr)_minmax(10rem,1fr)_minmax(9rem,1fr)_minmax(13rem,auto)]')

    unmount()
    ;({ unmount } = renderPage(false, '/company/shortlisted', 'shortlisted'))
    const shortlistedFilters = screen.getByRole('group', { name: 'Candidate filters' })
    expect(within(shortlistedFilters).getByRole('combobox', { name: 'Sort by' })).toHaveClass('h-10')
    expect(within(shortlistedFilters).getByRole('combobox', { name: 'Search name, skill, education or internship' })).toHaveAttribute('placeholder', 'Search name, skill, education or internship')
    expect(within(shortlistedFilters).queryByPlaceholderText('Skills')).not.toBeInTheDocument()
    expect(within(shortlistedFilters).queryByPlaceholderText('Education')).not.toBeInTheDocument()
    expect(within(shortlistedFilters).getByRole('button', { name: 'Apply' })).toHaveClass('h-10', 'bg-indigo-600')

    unmount()
    renderPage(true, '/company/pipeline')
    const pipelineFilters = await screen.findByRole('combobox', { name: 'Search name, skill, education or internship' })
    expect(pipelineFilters).toHaveAttribute('placeholder', 'Search name, skill, education or internship')
    expect(screen.queryByPlaceholderText('Skills')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Education')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toBeInTheDocument()
  })

  it('folds legacy skills and education URL filters into the unified search once', async () => {
    renderPage(false, '/company/applicants?search=Avery&skills=React&education=Computer+Science', 'applicants')

    const search = screen.getByRole('combobox', { name: 'Search name, skill, education or internship' })
    await waitFor(() => {
      expect(search).toHaveValue('Avery React Computer Science')
      const params = new URLSearchParams(screen.getByTestId('current-query').textContent ?? '')
      expect(params.get('search')).toBe('Avery React Computer Science')
      expect(params.has('skills')).toBe(false)
      expect(params.has('education')).toBe(false)
    })
  })

  it('uses the compact search placeholder at mobile widths while retaining its full accessible name', async () => {
    const originalWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
    let unmount: (() => void) | undefined
    try {
      ;({ unmount } = renderPage(false, '/company/applicants', 'applicants'))
      const search = screen.getByRole('combobox', { name: 'Search name, skill, education or internship' })
      expect(search).toHaveAttribute('placeholder', 'Name, skill, education...')
      await waitFor(() => expect(api.get).toHaveBeenCalledWith(
        '/applications/company/search',
        expect.objectContaining({ params: expect.any(Object) }),
      ))
    } finally {
      unmount?.()
      if (originalWidth) Object.defineProperty(window, 'innerWidth', originalWidth)
      else Reflect.deleteProperty(window, 'innerWidth')
    }
  })

  it('renders the seven pipeline columns with candidate counts', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/internships/mine') return { data: [] } as never
      if (url === '/applications/company/search') return searchResponse([
        application(),
        application({ id: 2, status: 'SHORTLISTED', allowed_next: ['INTERVIEW_SCHEDULED', 'REJECTED'] }),
      ]) as never
      return { data: [] } as never
    })
    renderPage(true, '/company/pipeline')

    expect(await screen.findByRole('region', { name: 'Applied applicants' })).toBeInTheDocument()
    for (const label of ['Applied', 'Under Review', 'Shortlisted', 'Interview', 'Selected', 'Accepted', 'Rejected']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(within(screen.getByRole('region', { name: 'Applied applicants' })).getByText('1')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Shortlisted applicants' })).getByText('1')).toBeInTheDocument()
  })

  it('updates the URL and sends internship, applicant, and sort filters to the server', async () => {
    renderPage(true, '/company/pipeline')
    const internship = screen.getByRole('combobox', { name: 'Filter by internship' })
    fireEvent.click(internship)
    const sameTitleOptions = await screen.findAllByRole('option', { name: 'Sales Manager' })
    expect(sameTitleOptions).toHaveLength(3)
    fireEvent.click(sameTitleOptions[0])
    await waitFor(() => {
      expect(screen.getByTestId('current-query')).toHaveTextContent('internship=13')
      expect(api.get).toHaveBeenCalledWith('/applications/company/search', {
        params: expect.objectContaining({ internship: '13' }),
      })
    })

    fireEvent.click(screen.getByRole('combobox', { name: 'Filter by verified skill' }))
    fireEvent.click(screen.getByRole('option', { name: 'High match (70%+)' }))
    await waitFor(() => {
      expect(screen.getByTestId('current-query')).toHaveTextContent('applicant_filter=high_match')
      expect(api.get).toHaveBeenCalledWith('/applications/company/search', {
        params: expect.objectContaining({ internship: '13', applicant_filter: 'high_match' }),
      })
    })

    fireEvent.click(screen.getByRole('combobox', { name: 'Sort by' }))
    fireEvent.click(screen.getByRole('option', { name: 'Name A-Z' }))
    await waitFor(() => {
      expect(screen.getByTestId('current-query')).toHaveTextContent('sort=name')
      expect(api.get).toHaveBeenCalledWith('/applications/company/search', {
        params: expect.objectContaining({ internship: '13', applicant_filter: 'high_match', sort: 'name' }),
      })
    })
  })

  it('shows title-only internship options on Applicants, Shortlisted, and Hiring Pipeline', async () => {
    const pages = [
      { pipeline: false, path: '/company/applicants', view: 'applicants' as const },
      { pipeline: false, path: '/company/shortlisted', view: 'shortlisted' as const },
      { pipeline: true, path: '/company/pipeline', view: 'applicants' as const },
    ]

    for (const page of pages) {
      const { unmount } = renderPage(page.pipeline, page.path, page.view)
      fireEvent.click(await screen.findByRole('combobox', { name: 'Filter by internship' }))
      const options = await screen.findAllByRole('option')
      expect(options.map((option) => option.textContent?.trim())).toEqual([
        'All internships',
        'Sales Manager',
        'Sales Manager',
        'Sales Manager',
      ])
      expect(options.slice(1).every((option) => !/#|\(\d+\)/.test(option.textContent ?? ''))).toBe(true)
      unmount()
    }
  })

  it('sorts title-only internship options alphabetically with repeated titles adjacent and newest first', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/internships/mine') return { data: [
        { id: 12, title: 'Sales Manager', location: 'Pune', created_at: '2026-10-10T00:00:00Z', applicant_count: 3 },
        { id: 14, title: 'Sales Manager', location: 'Pune', created_at: '2026-10-12T00:00:00Z', applicant_count: 3 },
        { id: 13, title: 'Sales Manager', location: 'Mumbai', created_at: '2026-10-13T00:00:00Z', applicant_count: 2 },
        { id: 15, title: 'Unique role', location: 'Delhi', created_at: '2026-10-09T00:00:00Z', applicant_count: 0 },
        { id: 16, title: 'Business Development Associate', location: 'Remote', created_at: '2026-10-15T00:00:00Z', applicant_count: 5 },
      ] } as never
      if (url === '/applications/company/search') return searchResponse([]) as never
      return { data: [] } as never
    })
    renderPage(true, '/company/pipeline?internship=12&search=missing&sort=name')

    fireEvent.click(await screen.findByRole('combobox', { name: 'Filter by internship' }))
    const options = await screen.findAllByRole('option')
    const labels = options.map((option) => option.textContent?.trim())
    expect(labels).toEqual([
      'All internships',
      'Business Development Associate',
      'Sales Manager',
      'Sales Manager',
      'Sales Manager',
      'Unique role',
    ])
    expect(labels.slice(1).every((label) => !label?.includes('#') && !/\(\d+\)/.test(label ?? ''))).toBe(true)
    expect(await screen.findByText('No candidates match these filters')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0])
    await waitFor(() => expect(screen.getByTestId('current-query')).toHaveTextContent(''))
  })

  it('filters repeated title options by their own ids and retains each posting result count', async () => {
    vi.mocked(api.get).mockImplementation(async (url, config) => {
      if (url === '/internships/mine') return { data: [
        { id: 12, title: 'Sales Manager', created_at: '2026-10-10T00:00:00Z', applicant_count: 3 },
        { id: 14, title: 'Sales Manager', created_at: '2026-10-12T00:00:00Z', applicant_count: 3 },
        { id: 13, title: 'Sales Manager', created_at: '2026-10-13T00:00:00Z', applicant_count: 2 },
      ] } as never
      if (url === '/applications/company/search') {
        const params = config?.params as { internship?: string } | undefined
        if (params?.internship === '13') return searchResponse([
          application({ id: 130, internship_id: 13, student_name: 'Newest posting candidate one' }),
          application({ id: 131, internship_id: 13, student_name: 'Newest posting candidate two' }),
        ]) as never
        if (params?.internship === '12') return searchResponse([
          application({ id: 120, internship_id: 12, student_name: 'Oldest posting candidate one' }),
          application({ id: 121, internship_id: 12, student_name: 'Oldest posting candidate two' }),
          application({ id: 122, internship_id: 12, student_name: 'Oldest posting candidate three' }),
        ]) as never
        return searchResponse([]) as never
      }
      return { data: [] } as never
    })
    renderPage(true, '/company/pipeline')

    const filter = await screen.findByRole('combobox', { name: 'Filter by internship' })
    fireEvent.click(filter)
    const newestTitleOption = (await screen.findAllByRole('option', { name: 'Sales Manager' }))[0]
    fireEvent.click(newestTitleOption)
    await waitFor(() => {
      expect(screen.getByTestId('current-query')).toHaveTextContent('internship=13')
      expect(screen.getByText('2 candidates across your internships')).toBeInTheDocument()
      expect(api.get).toHaveBeenCalledWith('/applications/company/search', {
        params: expect.objectContaining({ internship: '13' }),
      })
    })
    expect(screen.getByText('Newest posting candidate one')).toBeInTheDocument()
    expect(screen.getByText('Newest posting candidate two')).toBeInTheDocument()

    fireEvent.click(filter)
    const titleOptions = await screen.findAllByRole('option', { name: 'Sales Manager' })
    fireEvent.click(titleOptions[2])
    await waitFor(() => {
      expect(screen.getByTestId('current-query')).toHaveTextContent('internship=12')
      expect(screen.getByText('3 candidates across your internships')).toBeInTheDocument()
      expect(api.get).toHaveBeenCalledWith('/applications/company/search', {
        params: expect.objectContaining({ internship: '12' }),
      })
    })
    expect(screen.getByText('Oldest posting candidate one')).toBeInTheDocument()
    expect(screen.getByText('Oldest posting candidate three')).toBeInTheDocument()
  })

  it('shows enabled and disabled actions using backend-provided transition permissions', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/internships/mine') return { data: [] } as never
      if (url === '/applications/company/search') return searchResponse([application()]) as never
      return { data: [] } as never
    })
    renderPage(true, '/company/pipeline')
    await screen.findByText('Avery Candidate')
    const trigger = screen.getByRole('button', { name: 'Actions' })
    const focus = vi.spyOn(trigger, 'focus')
    fireEvent.click(trigger)

    expect(screen.getByRole('menuitem', { name: 'Move to review' })).toBeEnabled()
    expect(screen.queryByRole('menuitem', { name: /^Shortlist/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to review' }))
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/applications/1/status', { status: 'UNDER_REVIEW' }))
    focus.mockRestore()
  })

  it('uses the status endpoint for valid drops and ignores invalid drops', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/internships/mine') return { data: [] } as never
      if (url === '/applications/company/search') return searchResponse([application()]) as never
      return { data: [] } as never
    })
    renderPage(true, '/company/pipeline')
    const card = await screen.findByLabelText('Avery Candidate application')
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      getData: vi.fn(() => '1'),
    }

    fireEvent.dragStart(card, { dataTransfer })
    fireEvent.drop(screen.getByRole('region', { name: 'Under Review applicants' }), { dataTransfer })
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/applications/1/status', { status: 'UNDER_REVIEW' }))

    vi.mocked(api.patch).mockClear()
    fireEvent.dragStart(card, { dataTransfer })
    fireEvent.drop(screen.getByRole('region', { name: 'Selected applicants' }), { dataTransfer })
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('does not render a Move to menu for Accepted applications', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/internships/mine') return { data: [] } as never
      if (url === '/applications/company/search') return searchResponse([application({ status: 'ACCEPTED', allowed_next: [] })]) as never
      return { data: [] } as never
    })
    renderPage(true, '/company/pipeline')

    await screen.findByText('Avery Candidate')
    expect(screen.getByRole('button', { name: 'Actions' })).toBeInTheDocument()
  })

  it('stacks shortlisted actions, removes Shortlist, and caps visible skill chips', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/internships/mine') return { data: [] } as never
      if (url === '/applications/company/search') return searchResponse([application({ status: 'SHORTLISTED', allowed_next: ['INTERVIEW_SCHEDULED', 'REJECTED'], allowed_actions: ['SCHEDULE_INTERVIEW', 'REJECT'] })]) as never
      return { data: [] } as never
    })
    renderPage(false, '/company/shortlisted')

    const rows = await screen.findAllByRole('row', { name: /Avery Candidate/ })
    const row = rows[0]
    expect(within(row).getAllByRole('button').map((button) => button.textContent?.trim())).toEqual(['Actions'])
    expect(within(row).getByText('+2 more')).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: 'Actions' }))
    expect(screen.getAllByRole('menuitem', { name: /^Schedule interview/ })[0]).toBeEnabled()
    expect(screen.queryByRole('menuitem', { name: /^Shortlist/ })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Message' })).toBeInTheDocument()
  })

  it('renders one Actions menu in each Applicants row and omits invalid actions for accepted candidates', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/internships/mine') return { data: [] } as never
      if (url === '/applications/company/search') return searchResponse([
        application({ id: 1 }),
        application({ id: 2, status: 'ACCEPTED', allowed_next: [], allowed_actions: [] }),
      ]) as never
      return { data: [] } as never
    })
    renderPage(false, '/company/applicants', 'applicants')

    const rows = await screen.findAllByRole('row', { name: /Avery Candidate/ })
    const row = rows[0]
    expect(within(row).getAllByRole('button').map((button) => button.textContent?.trim())).toEqual(['Actions'])
    fireEvent.click(within(row).getByRole('button', { name: 'Actions' }))
    expect(screen.queryByRole('menuitem', { name: 'Shortlist' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Move to review' })).toBeInTheDocument()

    const acceptedRow = rows[1]
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.click(within(acceptedRow).getByRole('button', { name: 'Actions' }))
    expect(screen.queryByRole('menuitem', { name: 'Shortlist' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Move to review' })).not.toBeInTheDocument()
  })

  it('portals the action menu and flips it above its trigger near the viewport bottom', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/internships/mine') return { data: [] } as never
      if (url === '/applications/company/search') return searchResponse([application()]) as never
      return { data: [] } as never
    })
    renderPage(false, '/company/shortlisted')
    const row = await screen.findByRole('row', { name: /Avery Candidate/ })
    const trigger = within(row).getByRole('button', { name: 'Actions' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 200, y: 710, top: 710, bottom: 750, left: 200, right: 300, width: 100, height: 40,
      toJSON: () => ({}),
    })
    fireEvent.click(trigger)
    const menu = await screen.findByRole('menu', { name: 'Applicant actions' })
    expect(menu.parentElement).toBe(document.body)
    expect(menu).toHaveAttribute('data-placement', 'above')
    expect(menu).toHaveStyle({ position: 'fixed' })
  })

  it('keeps action menus scroll-safe in Applicants, Shortlisted, and Hiring Pipeline', async () => {
    const originalScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY')
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 320 })
    const header = document.createElement('header')
    header.className = 'sticky top-0'
    document.body.prepend(header)
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, bottom: 64, left: 0, right: 1280, width: 1280, height: 64,
      toJSON: () => ({}),
    })
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')

    try {
      const views: Array<{ path: string; pipeline: boolean; view: 'applicants' | 'shortlisted'; status: string }> = [
        { path: '/company/applicants', pipeline: false, view: 'applicants', status: 'APPLIED' },
        { path: '/company/shortlisted', pipeline: false, view: 'shortlisted', status: 'SHORTLISTED' },
        { path: '/company/pipeline', pipeline: true, view: 'applicants', status: 'APPLIED' },
      ]

      for (const page of views) {
        vi.mocked(api.get).mockImplementation(async (url) => {
          if (url === '/internships/mine') return { data: [] } as never
          if (url === '/applications/company/search') return searchResponse([
            application({
              status: page.status,
              allowed_next: page.status === 'SHORTLISTED' ? ['INTERVIEW_SCHEDULED', 'REJECTED'] : ['UNDER_REVIEW'],
            }),
          ]) as never
          return { data: [] } as never
        })
        const { unmount } = renderPage(page.pipeline, page.path, page.view)
        const trigger = (await screen.findAllByRole('button', { name: 'Actions' }))[0]
        const triggerRect = {
          x: 200, y: 680, top: 680, bottom: 720, left: 200, right: 300, width: 100, height: 40,
          toJSON: () => ({}),
        }
        const observedHiddenPosition = vi.fn()
        vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(() => {
          const menu = document.querySelector<HTMLElement>('[role="menu"]')
          if (menu) observedHiddenPosition(menu.style.position, menu.style.visibility)
          return triggerRect
        })

        fireEvent.click(trigger)
        const menu = await screen.findByRole('menu', { name: 'Applicant actions' })
        const top = Number.parseFloat(menu.style.top)
        const visibleHeight = Math.min(menu.scrollHeight || menu.children.length * 40 + 16, Number.parseFloat(menu.style.maxHeight))
        expect(observedHiddenPosition).toHaveBeenCalledWith('fixed', 'hidden')
        expect(menu).toHaveStyle({ visibility: 'visible' })
        expect(menu).toHaveAttribute('data-placement', 'above')
        expect(top).toBeGreaterThanOrEqual(72)
        expect(top + visibleHeight).toBeLessThanOrEqual(triggerRect.top - 4)
        expect(focus).toHaveBeenCalledWith({ preventScroll: true })
        expect(window.scrollY).toBe(320)

        fireEvent.keyDown(menu, { key: 'End' })
        expect(screen.getByRole('menuitem', { name: 'Notes' })).toHaveFocus()
        expect(window.scrollY).toBe(320)
        fireEvent.keyDown(menu, { key: 'Home' })
        expect(screen.getByRole('menuitem', { name: 'View profile and resume' })).toHaveFocus()
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
        expect(trigger).toHaveFocus()
        expect(window.scrollY).toBe(320)
        expect(focus).toHaveBeenCalledWith({ preventScroll: true })

        unmount()
        focus.mockClear()
      }
    } finally {
      focus.mockRestore()
      header.remove()
      if (originalScrollY) Object.defineProperty(window, 'scrollY', originalScrollY)
      else Reflect.deleteProperty(window, 'scrollY')
    }
  })

  it('opens an action menu downward below the sticky header for a top row', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/internships/mine') return { data: [] } as never
      if (url === '/applications/company/search') return searchResponse([application()]) as never
      return { data: [] } as never
    })
    const header = document.createElement('header')
    header.className = 'sticky top-0'
    document.body.prepend(header)
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, bottom: 64, left: 0, right: 1280, width: 1280, height: 64,
      toJSON: () => ({}),
    })
    const { unmount } = renderPage(false, '/company/applicants', 'applicants')
    try {
      const trigger = (await screen.findAllByRole('button', { name: 'Actions' }))[0]
      vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
        x: 200, y: 80, top: 80, bottom: 120, left: 200, right: 300, width: 100, height: 40,
        toJSON: () => ({}),
      })

      fireEvent.click(trigger)
      const menu = await screen.findByRole('menu', { name: 'Applicant actions' })
      expect(menu).toHaveAttribute('data-placement', 'below')
      expect(Number.parseFloat(menu.style.top)).toBeGreaterThanOrEqual(72)
      expect(Number.parseFloat(menu.style.top)).toBeGreaterThan(120)
    } finally {
      unmount()
      header.remove()
    }
  })
})
