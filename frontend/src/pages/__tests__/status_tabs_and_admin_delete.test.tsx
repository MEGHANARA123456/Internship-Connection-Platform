import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { AdminDashboardPage, AdminUsersPage, AdminVerificationsPage } from '../AdminPages'
import { InterviewsPage, NotificationsPage } from '../CommunicationPages'
import { ApplicationTimelinePage, ApplicationsPage } from '../StudentPages'
import { useAuthStore } from '../../store/auth'

vi.mock('../../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  downloadAuthenticatedFile: vi.fn(),
  getFullMediaUrl: (url: string) => url,
}))

const applications = Array.from({ length: 11 }, (_, index) => ({
  id: index + 1,
  internship_id: index + 100,
  internship_title: `Application ${index + 1}`,
  company_name: 'Example Company',
  status: index === 10 ? 'INTERVIEW_SCHEDULED' : 'APPLIED',
  created_at: '2026-06-01T12:00:00Z',
}))

const interviews = [
  ...Array.from({ length: 10 }, (_, index) => ({
    id: index + 1,
    interview_type: 'VIDEO',
    status: 'SCHEDULED',
    scheduled_at: new Date(Date.now() + 86_400_000 * (index + 1)).toISOString(),
    internship_title: `Scheduled Interview ${index + 1}`,
  })),
  {
    id: 11,
    interview_type: 'VIDEO',
    status: 'COMPLETED',
    scheduled_at: '2026-06-11T12:00:00Z',
    internship_title: 'Completed Interview',
  },
  {
    id: 12,
    interview_type: 'VIDEO',
    status: 'CANCELLED',
    scheduled_at: '2026-06-12T12:00:00Z',
    internship_title: 'Cancelled Interview',
  },
]

function CurrentUrl() {
  const location = useLocation()
  return <output data-testid="current-url">{location.pathname}{location.search}</output>
}

function setSession(role: 'STUDENT' | 'COMPANY' | 'ADMIN', userId = 1) {
  useAuthStore.getState().setSession({
    accessToken: 'test-token',
    refreshToken: 'test-refresh-token',
    userId,
    role,
    email: `${role.toLowerCase()}@example.com`,
    name: 'Test User',
  })
}

beforeEach(() => {
  setSession('STUDENT')
  vi.spyOn(api, 'get').mockImplementation(async (path) => {
    if (path === '/applications/student') return { data: applications } as never
    if (path === '/interviews/my') return { data: interviews } as never
    if (path === '/analytics/overview') {
      return {
        data: {
          role: 'STUDENT',
          has_activity: false,
          funnel: { applied: 11, screened: 0, interviews: 1, offers: 0 },
          domains: [],
          monthly_trends: [],
          total_active_internships: 0,
          total_verified_students: 0,
          total_companies: 0,
        },
      } as never
    }
    if (path === '/admin/users') return { data: [] } as never
    return { data: [] } as never
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useAuthStore.getState().logout()
})

describe('ApplicationsPage status menu and pagination', () => {
  it('deduplicates repeated application ids and labels every tracker stage', async () => {
    const duplicateApplication = {
      ...applications[0],
      id: 717,
      internship_id: 717,
      internship_title: 'Repeated role title',
      internship_location: 'Remote',
      internship_posted_at: '2026-05-01T12:00:00Z',
    }
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/applications/student') return { data: [duplicateApplication, duplicateApplication] } as never
      return { data: [] } as never
    })

    render(<MemoryRouter><ApplicationsPage /></MemoryRouter>)

    expect(await screen.findByText('Repeated role title')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Track application for Repeated role title' })).toHaveLength(1)
    expect(screen.getByText(/Remote · Posted .* · ID #717/)).toBeInTheDocument()
    const applicationCard = screen.getByRole('link', { name: 'Track application for Repeated role title' })
    for (const label of ['Applied', 'Under review', 'Shortlisted', 'Interview', 'Offer']) {
      expect(within(applicationCard).getByText(label)).toBeInTheDocument()
    }
  })

  it('shows a filtered empty state instead of the zero-applications state', async () => {
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/applications/student') return { data: [applications[0]] } as never
      return { data: [] } as never
    })

    render(
      <MemoryRouter initialEntries={['/applications?status=WiThDrAwN']}>
        <ApplicationsPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('No applications match this filter')).toBeInTheDocument()
    expect(screen.queryByText('No applications submitted yet')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(await screen.findByText('Application 1')).toBeInTheDocument()
  })

  it('uses the zero-applications empty state when the student has no applications', async () => {
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/applications/student') return { data: [] } as never
      return { data: [] } as never
    })

    render(
      <MemoryRouter initialEntries={['/applications?status=applied']}>
        <ApplicationsPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('No applications submitted yet')).toBeInTheDocument()
    expect(screen.queryByText('No applications match this filter')).toBeNull()
  })

  it('shows status counts, filters client-side, and resets pagination when the tab changes', async () => {
    render(<MemoryRouter><ApplicationsPage /></MemoryRouter>)

    expect(await screen.findByText('Application 1')).toBeTruthy()
    const statusFilter = screen.getByRole('button', { name: 'Status: All (11)' })
    expect(statusFilter).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('Application 11')).toBeTruthy()
    expect(screen.queryByText('Application 1')).toBeNull()

    fireEvent.click(statusFilter)
    expect(screen.getByRole('menuitem', { name: /Applied.*10/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Interview.*1/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /Interview.*1/ }))
    expect(await screen.findByText('Application 11')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Previous page' })).toBeNull()

    expect(screen.getByRole('button', { name: 'Status: Interview (1)' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Status: Interview (1)' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /All.*11/ }))
    expect(await screen.findByText('Application 1')).toBeTruthy()
  })

  it('enables withdrawal only for eligible statuses and provides an accessible disabled reason', async () => {
    const statusApplications = ['APPLIED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'SELECTED', 'REJECTED', 'WITHDRAWN'].map((status, index) => ({
          id: 100 + index,
          internship_id: 200 + index,
          internship_title: `${status} role`,
          status,
          created_at: '2026-06-01T12:00:00Z',
        }))
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/applications/student') return { data: statusApplications } as never
      return { data: [] } as never
    })

    render(<MemoryRouter><ApplicationsPage /></MemoryRouter>)

    const activeWithdraw = await screen.findByRole('button', {
      name: 'Withdraw application for APPLIED role',
    })
    expect(activeWithdraw).toBeEnabled()
    expect(activeWithdraw).toHaveClass('h-10', 'w-full', 'rounded-xl')
    expect(activeWithdraw).toHaveAttribute('title', 'Withdraw this application')
    for (const status of ['UNDER_REVIEW', 'SHORTLISTED']) {
      const withdraw = screen.getByRole('button', {
        name: `Withdraw application for ${status} role`,
      })
      expect(withdraw).toBeEnabled()
      expect(withdraw).toHaveAttribute('title', 'Withdraw this application')
    }

    for (const status of ['INTERVIEW_SCHEDULED', 'SELECTED', 'REJECTED', 'WITHDRAWN']) {
      const withdraw = screen.getByRole('button', {
        name: `Withdraw unavailable for ${status.toLowerCase().replaceAll('_', ' ')} application`,
      })
      expect(withdraw).toBeDisabled()
      expect(withdraw).toHaveAttribute(
        'title',
        `Withdrawal is unavailable for ${status.toLowerCase().replaceAll('_', ' ')} applications`,
      )
    }
    expect(screen.getAllByRole('button', { name: 'Message Recruiter' })).toHaveLength(7)
  })

  it('renders a mini tracker for each supported application outcome', async () => {
    const statuses = ['APPLIED', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'SELECTED', 'REJECTED', 'WITHDRAWN']
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/applications/student') return { data: statuses.map((status, index) => ({
        id: 300 + index,
        internship_id: 400 + index,
        internship_title: `${status} application`,
        company_name: 'Example Company',
        status,
        created_at: '2026-06-01T12:00:00Z',
      })) } as never
      return { data: [] } as never
    })

    render(<MemoryRouter><ApplicationsPage /></MemoryRouter>)
    for (const status of statuses) {
      expect((await screen.findAllByLabelText(`Application progress: ${status.replaceAll('_', ' ')}`)).length).toBeGreaterThan(0)
    }
  })

  it('syncs the status menu selection to the application URL', async () => {
    render(
      <MemoryRouter initialEntries={['/applications']}>
        <ApplicationsPage />
        <CurrentUrl />
      </MemoryRouter>,
    )
    await screen.findByText('Application 1')
    fireEvent.click(screen.getByRole('button', { name: 'Status: All (11)' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Shortlisted/ }))
    expect(screen.getByTestId('current-url')).toHaveTextContent('/applications?status=shortlisted')
  })
})

describe('ApplicationTimelinePage', () => {
  it('renders the ordered timeline, interview actions, and secure Gmail link', async () => {
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/applications/77/timeline') return {
        data: {
          summary: { id: 77, status: 'INTERVIEW_SCHEDULED', title: 'Software Intern', company_name: 'Example Company', applied_at: '2026-06-01T12:00:00Z' },
          steps: [
            { key: 'APPLIED', label: 'Applied', state: 'done', timestamp: '2026-06-01T12:00:00Z' },
            { key: 'INTERVIEW_SCHEDULED', label: 'Interview scheduled', state: 'current', timestamp: '2026-06-04T12:00:00Z', interview: { date: '2026-06-10', time: '12:00', type: 'VIDEO', link: 'https://meet.example.com/room' }, emails: [{ id: 1, gmail_url: 'https://mail.google.com/mail/?authuser=a%40gmail.com#search/rfc822msgid%3Aabc' }] },
          ],
        },
      } as never
      return { data: [] } as never
    })

    render(
      <MemoryRouter initialEntries={['/applications/77']}>
        <Routes>
          <Route path="/applications/:id" element={<ApplicationTimelinePage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Software Intern' })).toBeInTheDocument()
    expect(screen.getByText('Applied')).toBeInTheDocument()
    expect(screen.getByText('Interview scheduled')).toBeInTheDocument()
    expect(screen.getByText('Interview details')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View Email' })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByRole('link', { name: 'View Email' })).toHaveAttribute('target', '_blank')
    expect(screen.queryByText(/sign in to the recipient Gmail account/i)).not.toBeInTheDocument()
  })

  it('shows the closed-role banner and closure timeline note', async () => {
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/applications/77/timeline') {
        return {
          data: {
            summary: {
              id: 77,
              status: 'UNDER_REVIEW',
              title: 'Software Intern',
              company_name: 'Example Company',
              applied_at: '2026-06-01T12:00:00Z',
              internship_status: 'CLOSED',
              internship_closed_at: '2026-10-12T12:00:00Z',
            },
            steps: [{
              key: 'INTERNSHIP_CLOSED',
              label: 'Internship closed',
              state: 'done',
              timestamp: '2026-10-12T12:00:00Z',
              description: 'Internship closed on 2026-10-12.',
            }],
          },
        } as never
      }
      return { data: [] } as never
    })

    render(
      <MemoryRouter initialEntries={['/applications/77']}>
        <Routes>
          <Route path="/applications/:id" element={<ApplicationTimelinePage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('This internship is closed to new applications. Your application is unaffected.')).toBeInTheDocument()
    expect(screen.getByText('Internship closed on 2026-10-12.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Message Recruiter' })).toBeInTheDocument()
  })
})

describe('InterviewsPage status tabs and pagination', () => {
  it('shows status counts, filters interviews, and resets the page when switching tabs', async () => {
    render(<MemoryRouter><InterviewsPage /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: /Scheduled Interview 1$/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'All 12' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Upcoming 10' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Completed 1' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Cancelled 1' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByRole('heading', { name: /Completed Interview$/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Upcoming 10' }))
    expect(await screen.findByRole('heading', { name: /Scheduled Interview 1$/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /Completed Interview$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Previous page' })).toBeNull()
  })

  it('shows cancellation reasons and opens a future-only reschedule for the company', async () => {
    setSession('COMPANY', 31)
    const companyInterviews = [
      {
        id: 20,
        application_id: 77,
        candidate_name: 'Avery Candidate',
        internship_title: 'Frontend Engineering Internship',
        interview_type: 'VIDEO',
        status: 'SCHEDULED',
        scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
        meeting_link: 'https://meet.example.test/interview',
        notes: 'Bring a portfolio.',
      },
      {
        id: 21,
        application_id: 78,
        candidate_name: 'Jordan Candidate',
        internship_title: 'Backend Engineering Internship',
        interview_type: 'PHONE',
        status: 'CANCELLED',
        scheduled_at: new Date(Date.now() - 86_400_000).toISOString(),
        cancel_reason: 'TIME_PASSED',
        cancelled_at: new Date().toISOString(),
        notes: 'Discuss API design.',
      },
    ]
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/company/interviews') return { data: companyInterviews } as never
      return { data: [] } as never
    })

    render(<MemoryRouter><InterviewsPage /></MemoryRouter>)
    expect(await screen.findByRole('tab', { name: 'Upcoming 1' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Cancelled 1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Cancelled 1' }))
    expect(await screen.findByText('Cancelled automatically: time passed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {
      name: 'Reschedule Backend Engineering Internship interview',
    }))

    expect(await screen.findByRole('heading', { name: 'Reschedule Interview' })).toBeInTheDocument()
    expect(screen.getAllByText('Candidate: Jordan Candidate').length).toBeGreaterThan(1)
    expect(screen.getByLabelText('Date & Time')).toHaveAttribute('min')
    expect(screen.getByLabelText('Interview Format')).toHaveTextContent('Phone Call')
    expect(screen.getByLabelText('Meeting Link or Location')).toHaveValue('')
    expect(screen.getByLabelText('Instructions / Notes for Candidate')).toHaveValue('Discuss API design.')
  })

  describe('Email actions', () => {
    it('opens eligible direct and notification emails in Gmail and keeps non-Gmail mail in the app', async () => {
      useAuthStore.setState({
        session: {
          accessToken: 'student-access',
          refreshToken: 'student-refresh',
          role: 'STUDENT',
          userId: 44,
          email: 'student@gmail.com',
        },
      })
      vi.mocked(api.get).mockImplementation(async (path) => {
        if (path === '/notifications') {
          return { data: [{
            id: 4,
            application_id: 77,
            gmail_url: 'https://mail.google.com/mail/?authuser=student%40gmail.com#search/id',
            notification_type: 'APPLICATION_STATUS',
            title: 'Application update',
            body: 'Your status changed.',
            created_at: '2026-06-01T12:00:00Z',
            read_at: null,
          }] } as never
        }
        if (path === '/me/emails') {
          return { data: [
            { id: 1, subject: 'Interview update', to: 'student@gmail.com', from: 'recruiter@example.com', created_at: '2026-06-01T12:00:00Z', gmail_url: 'https://mail.google.com/mail/?authuser=student%40gmail.com#search/id', body: 'Invite' },
            { id: 2, subject: 'Demo update', to: 'student@gmail.com', from: 'noreply@internship.local', created_at: '2026-06-01T11:00:00Z', gmail_url: null, body: 'Demo' },
          ] } as never
        }
        return { data: [] } as never
      })

      render(<MemoryRouter><NotificationsPage /></MemoryRouter>)
      const notificationEmail = await screen.findByRole('link', { name: 'View Email' })
      expect(notificationEmail).toHaveAttribute('href', expect.stringContaining('mail.google.com'))
      expect(notificationEmail).toHaveAttribute('target', '_blank')
      expect(notificationEmail).toHaveAttribute('rel', 'noopener noreferrer')

      fireEvent.click(screen.getByRole('button', { name: /My Direct Emails/ }))
      const emailLink = await screen.findByRole('link', { name: 'View Email' })
      expect(emailLink).toHaveAttribute('href', expect.stringContaining('mail.google.com'))
      expect(emailLink).toHaveAttribute('rel', 'noopener noreferrer')
      expect(screen.getByRole('button', { name: 'View Email' })).toBeInTheDocument()
      expect(screen.queryByText(/sign in to the recipient Gmail account/i)).not.toBeInTheDocument()
    })
  })

  it('disables video launch for completed and cancelled interviews with accessible explanations', async () => {
    render(<MemoryRouter><InterviewsPage /></MemoryRouter>)

    const cancelledTab = await screen.findByRole('tab', { name: 'Cancelled 1' })
    fireEvent.click(cancelledTab)
    const cancelledLaunch = await screen.findByRole('button', {
      name: 'Launch In-App Video unavailable for cancelled interview',
    })
    expect(cancelledLaunch).toBeDisabled()
    expect(cancelledLaunch).toHaveClass('h-10', 'w-full', 'rounded-xl')
    expect(cancelledLaunch).toHaveAttribute('title', 'Video launch is unavailable for cancelled interviews')

    const sync = screen.getByRole('button', {
      name: 'Sync calendar invitation for Cancelled Interview interview',
    })
    expect(sync).toBeDisabled()
    expect(sync).toHaveAttribute('title', 'Calendar sync is unavailable for cancelled interviews')

    const google = screen.getByRole('button', {
      name: 'Add Cancelled Interview interview to Google Calendar',
    })
    expect(google).toBeDisabled()
    expect(google).toHaveAttribute('title', 'Google Calendar is unavailable for cancelled interviews')

    fireEvent.click(screen.getByRole('tab', { name: 'Completed 1' }))
    const completedLaunch = await screen.findByRole('button', {
      name: 'Launch In-App Video unavailable for completed interview',
    })
    expect(completedLaunch).toBeDisabled()
    expect(completedLaunch).toHaveAttribute('title', 'Video launch is unavailable for completed interviews')

    fireEvent.click(screen.getByRole('tab', { name: 'Upcoming 10' }))
    const scheduledLaunch = (await screen.findAllByRole('button', { name: 'Launch In-App Video' }))[0]
    expect(scheduledLaunch).toBeEnabled()
    expect(scheduledLaunch).toHaveClass('h-10', 'w-full', 'rounded-xl')
  })
})

describe('AdminUsersPage deletion confirmation', () => {
  it('enables permanent deletion only after reason and exact email are entered', async () => {
    setSession('ADMIN', 99)
    const target = {
      id: 22,
      email: 'delete-me@example.com',
      role: 'STUDENT',
      is_active: true,
      is_verified: true,
      mfa_enabled: false,
    }
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [target] } as never)
      .mockResolvedValueOnce({ data: [] } as never)
    vi.mocked(api.delete).mockResolvedValue({ data: { message: 'Deleted' } } as never)

    render(<MemoryRouter><AdminUsersPage /></MemoryRouter>)
    expect(await screen.findByText(target.email)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `Delete user ${target.email}` }))

    const deleteButton = screen.getByRole('button', { name: 'Delete permanently' })
    expect(deleteButton).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('Enter a reason (at least 5 characters)'), {
      target: { value: 'Policy violation' },
    })
    expect(deleteButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Type the exact email to confirm'), {
      target: { value: 'wrong@example.com' },
    })
    expect(deleteButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Type the exact email to confirm'), {
      target: { value: target.email },
    })
    expect(deleteButton).toBeEnabled()
    fireEvent.click(deleteButton)

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith(`/admin/users/${target.id}`, {
        data: { confirmation_email: target.email, reason: 'Policy violation' },
      })
      expect(screen.queryByText(target.email)).toBeNull()
    })
    expect(await screen.findByRole('status')).toHaveTextContent('was permanently deleted')
  })
})

describe('AdminUsersPage action controls', () => {
  it('uses fixed-size status actions, an icon-only delete control, and hides actions for the signed-in admin', async () => {
    setSession('ADMIN', 99)
    vi.mocked(api.get).mockResolvedValueOnce({
      data: [
        { id: 22, email: 'active@example.com', role: 'STUDENT', is_active: true, is_verified: true, mfa_enabled: false },
        { id: 23, email: 'paused@example.com', role: 'COMPANY', is_active: false, is_verified: false, email_verification_required: false, mfa_enabled: false },
        { id: 99, email: 'admin@example.com', role: 'ADMIN', is_active: true, is_verified: true, mfa_enabled: false },
      ],
    } as never)

    render(<MemoryRouter><AdminUsersPage /></MemoryRouter>)

    const suspend = await screen.findByRole('button', { name: 'Suspend' })
    const reactivate = screen.getByRole('button', { name: 'Reactivate' })
    const deleteButton = screen.getByRole('button', { name: 'Delete user active@example.com' })
    expect(suspend).toHaveClass('h-9', 'w-[112px]')
    expect(reactivate).toHaveClass('h-9', 'w-[112px]')
    expect(deleteButton).toHaveClass('h-9', 'w-9')
    expect(deleteButton).toHaveAttribute('title', 'Delete user')
    expect(deleteButton).not.toHaveTextContent('Delete')
    expect(screen.getByText('NOT REQUIRED')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete user admin@example.com' })).not.toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveClass('min-w-[1120px]')
    const pills = screen.getAllByText(/^(STUDENT|COMPANY|ADMIN|ACTIVE|SUSPENDED|VERIFIED|PENDING|NOT REQUIRED|ENABLED|DISABLED)$/)
    expect(pills.length).toBeGreaterThanOrEqual(12)
    for (const pill of pills) expect(pill).toHaveClass('h-7', 'w-28', 'text-[11px]', 'uppercase')
  })
})

describe('AdminDashboardPage header', () => {
  it('does not expose internal API availability or port information', async () => {
    setSession('ADMIN', 99)
    render(<MemoryRouter><AdminDashboardPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Platform Admin Dashboard' })).toBeInTheDocument()
    expect(screen.queryByText(/API: Online|8010|localhost/i)).not.toBeInTheDocument()
  })
})

describe('AdminVerificationsPage', () => {
  it('opens protected company documents and requires a rejection reason', async () => {
    const company = {
      id: 3,
      user_id: 31,
      company_name: 'Example Company',
      industry: 'Technology',
      verification_status: 'PENDING',
      submitted_at: '2026-09-20T12:00:00Z',
      documents: [{
        id: 88,
        document_type: 'BUSINESS_REGISTRATION',
        original_filename: 'registration.pdf',
        content_type: 'application/pdf',
      }],
    }
    vi.mocked(api.get).mockResolvedValueOnce({ data: [company] } as never)
    vi.mocked(api.post).mockResolvedValue({ data: {} } as never)

    render(<MemoryRouter><AdminVerificationsPage /></MemoryRouter>)
    expect(await screen.findByText('registration.pdf')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/admin/verifications')
    expect(screen.getByText((content) => content.includes(new Date(company.submitted_at).toLocaleDateString()))).toBeInTheDocument()
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:verification-document'),
      revokeObjectURL: vi.fn(),
    })
    vi.mocked(api.get).mockResolvedValueOnce({
      data: new Blob(['document'], { type: 'application/pdf' }),
      headers: { 'content-type': 'application/pdf' },
    } as never)
    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(
      '/admin/companies/31/documents/88/download',
      { responseType: 'blob' },
    ))
    expect(await screen.findByTitle('registration.pdf')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    const confirm = screen.getByRole('button', { name: 'Reject verification' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Reason for rejection/i), {
      target: { value: 'Please upload a readable registration certificate.' },
    })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/admin/companies/31/verification',
      { status: 'REJECTED', reason: 'Please upload a readable registration certificate.' },
    ))
  })
})
