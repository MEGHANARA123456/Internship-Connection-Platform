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
      { id: 12, title: 'Sales Manager', location: 'Pune', created_at: '2026-10-12T00:00:00Z', applicant_count: 3 },
      { id: 13, title: 'Sales Manager', location: 'Mumbai', created_at: '2026-10-12T00:00:00Z', applicant_count: 2 },
      { id: 14, title: 'Sales Manager', location: 'Pune', created_at: '2026-10-12T00:00:00Z', applicant_count: 3 },
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
    const { unmount } = renderPage(false, '/company/applicants', 'applicants')

    const filters = screen.getByRole('group', { name: 'Candidate filters' })
    expect(await within(filters).findByRole('combobox', { name: 'Sort candidates' })).toHaveClass('h-10')
    expect(within(filters).getByRole('combobox', { name: 'Search candidate' })).toHaveClass('h-10')
    for (const name of ['Filter by skills', 'Filter by education']) {
      expect(within(filters).getByRole('textbox', { name })).toHaveClass('h-10')
    }
    for (const name of ['Filter by internship', 'Filter by verified skill']) {
      expect(within(filters).getByRole('combobox', { name })).toHaveClass('h-10')
    }
    expect(within(filters).getByRole('button', { name: 'Apply' })).toHaveClass('h-10', 'bg-indigo-600')
    expect(within(filters).getByRole('button', { name: 'Clear filters' })).toHaveClass('h-10')
    expect(filters).toHaveClass('items-end', 'xl:grid-cols-4', '2xl:grid-cols-[repeat(5,minmax(0,1fr))_minmax(160px,1fr)_auto]')

    unmount()
    renderPage(false, '/company/shortlisted', 'shortlisted')
    const shortlistedFilters = screen.getByRole('group', { name: 'Candidate filters' })
    expect(within(shortlistedFilters).getByRole('combobox', { name: 'Sort candidates' })).toHaveClass('h-10')
    expect(within(shortlistedFilters).getByRole('button', { name: 'Apply' })).toHaveClass('h-10', 'bg-indigo-600')
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
    fireEvent.click(await screen.findByRole('option', { name: /Sales Manager · Pune · 12 Oct \(3\) · #12/ }))
    await waitFor(() => {
      expect(screen.getByTestId('current-query')).toHaveTextContent('internship=12')
      expect(api.get).toHaveBeenCalledWith('/applications/company/search', {
        params: expect.objectContaining({ internship: '12' }),
      })
    })

    fireEvent.click(screen.getByRole('combobox', { name: 'Filter by verified skill' }))
    fireEvent.click(screen.getByRole('option', { name: 'High match (70%+)' }))
    await waitFor(() => {
      expect(screen.getByTestId('current-query')).toHaveTextContent('applicant_filter=high_match')
      expect(api.get).toHaveBeenCalledWith('/applications/company/search', {
        params: expect.objectContaining({ internship: '12', applicant_filter: 'high_match' }),
      })
    })

    fireEvent.click(screen.getByRole('combobox', { name: 'Sort candidates' }))
    fireEvent.click(screen.getByRole('option', { name: 'Name A-Z' }))
    await waitFor(() => {
      expect(screen.getByTestId('current-query')).toHaveTextContent('sort=name')
      expect(api.get).toHaveBeenCalledWith('/applications/company/search', {
        params: expect.objectContaining({ internship: '12', applicant_filter: 'high_match', sort: 'name' }),
      })
    })
  })

  it('keeps duplicate internship titles distinguishable and displays a clear empty state', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/internships/mine') return { data: [
        { id: 12, title: 'Sales Manager', location: 'Pune', created_at: '2026-10-12T00:00:00Z', applicant_count: 3 },
        { id: 14, title: 'Sales Manager', location: 'Pune', created_at: '2026-10-12T00:00:00Z', applicant_count: 3 },
        { id: 13, title: 'Sales Manager', location: 'Mumbai', created_at: '2026-10-12T00:00:00Z', applicant_count: 2 },
      ] } as never
      if (url === '/applications/company/search') return searchResponse([]) as never
      return { data: [] } as never
    })
    renderPage(true, '/company/pipeline?internship=12&search=missing&sort=name')

    fireEvent.click(await screen.findByRole('combobox', { name: 'Filter by internship' }))
    expect(await screen.findByRole('option', { name: /Sales Manager · Pune · 12 Oct \(3\) · #12/ })).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /Sales Manager · Pune · 12 Oct \(3\) · #14/ })).toBeInTheDocument()
    expect(await screen.findByText('No candidates match these filters')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0])
    await waitFor(() => expect(screen.getByTestId('current-query')).toHaveTextContent(''))
  })

  it('shows enabled and disabled actions using backend-provided transition permissions', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/internships/mine') return { data: [] } as never
      if (url === '/applications/company/search') return searchResponse([application()]) as never
      return { data: [] } as never
    })
    renderPage(true, '/company/pipeline')
    await screen.findByText('Avery Candidate')
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))

    expect(screen.getByRole('menuitem', { name: 'Move to review' })).toBeEnabled()
    expect(screen.queryByRole('menuitem', { name: /^Shortlist/ })).not.toBeInTheDocument()
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
})
