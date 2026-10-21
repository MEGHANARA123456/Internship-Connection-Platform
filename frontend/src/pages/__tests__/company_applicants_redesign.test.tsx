import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
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

function renderPage(pipeline: boolean, path: string) {
  return render(<MemoryRouter initialEntries={[path]}><CompanyApplicantsRedesign pipeline={pipeline} /></MemoryRouter>)
}

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/internships/mine') return { data: [{ id: 12, title: 'Frontend Engineering Internship' }] } as never
    if (url === '/applications/company/search') return searchResponse([]) as never
    return { data: [] } as never
  })
  vi.mocked(api.patch).mockResolvedValue({ data: {} } as never)
})

afterEach(() => vi.clearAllMocks())

describe('company pipeline and shortlisted redesign', () => {
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
    for (const item of screen.getAllByRole('menuitem', { name: /^Shortlist/ })) {
      expect(item).toBeDisabled()
      expect(item).toHaveAttribute('title', 'Move to review first')
    }
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

    const row = await screen.findByRole('row', { name: /Avery Candidate/ })
    expect(within(row).getAllByRole('button').map((button) => button.textContent?.trim())).toEqual(['Actions'])
    expect(within(row).getByText('+2 more')).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: 'Actions' }))
    expect(screen.getAllByRole('menuitem', { name: /^Schedule interview/ })[0]).toBeEnabled()
    expect(screen.getAllByRole('menuitem', { name: /^Shortlist/ })[0]).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Message' })).toBeInTheDocument()
  })
})
