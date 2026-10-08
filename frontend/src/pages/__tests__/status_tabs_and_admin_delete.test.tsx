import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { AdminUsersPage, AdminVerificationsPage } from '../AdminPages'
import { InterviewsPage } from '../CommunicationPages'
import { ApplicationsPage } from '../StudentPages'
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
    scheduled_at: '2026-06-10T12:00:00Z',
    internship_title: `Scheduled Interview ${index + 1}`,
  })),
  {
    id: 11,
    interview_type: 'PHONE',
    status: 'COMPLETED',
    scheduled_at: '2026-06-11T12:00:00Z',
    internship_title: 'Completed Interview',
  },
  {
    id: 12,
    interview_type: 'PHONE',
    status: 'CANCELLED',
    scheduled_at: '2026-06-12T12:00:00Z',
    internship_title: 'Cancelled Interview',
  },
]

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

describe('ApplicationsPage status tabs and pagination', () => {
  it('shows status counts, filters client-side, and resets pagination when the tab changes', async () => {
    render(<MemoryRouter><ApplicationsPage /></MemoryRouter>)

    expect(await screen.findByText('Application 1')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'All 11' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Applied 10' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Interview 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('Application 11')).toBeTruthy()
    expect(screen.queryByText('Application 1')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Interview 1' }))
    expect(await screen.findByText('Application 11')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Previous page' })).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'All 11' }))
    expect(await screen.findByText('Application 1')).toBeTruthy()
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
    expect(screen.getByText('Not required')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete user admin@example.com' })).not.toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveClass('min-w-[1040px]')
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
