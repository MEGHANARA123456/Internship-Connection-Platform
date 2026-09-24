import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AdminAuditLogsPage } from '../AdminPages'
import { AdminCompaniesPage } from '../AdminPages'
import { AdminCompanyPostingsPage } from '../AdminPages'
import { AdminUsersPage } from '../AdminPages'
import { api } from '../../api/client'
import { useAuthStore } from '../../store/auth'

// ── Mock API client ──────────────────────────────────────────────────────────

vi.mock('../../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  downloadAuthenticatedFile: vi.fn(),
  getFullMediaUrl: (url: string) => url,
}))

// ── Auth state: logged-in admin ──────────────────────────────────────────────

beforeEach(() => {
  useAuthStore.setState({
    session: {
      accessToken: 'mock-admin-token',
      refreshToken: 'mock-refresh',
      role: 'ADMIN',
      userId: 1,
      name: 'Platform Admin',
    },
  })
  vi.clearAllMocks()
})

// ── 1. AdminAuditLogsPage — empty state ──────────────────────────────────────

describe('AdminAuditLogsPage', () => {
  it('renders empty state when audit log has no items', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: { items: [], total: 0, page: 1, page_size: 25 },
    })

    render(
      <BrowserRouter>
        <AdminAuditLogsPage />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Audit Logs')).toBeDefined()
    })
    expect(screen.getByText('No audit events')).toBeDefined()
  })

  it('renders log rows and metadata toggle when logs are present', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 1,
            actor_email: 'admin@test.com',
            action: 'user_suspended',
            target_type: 'user',
            target_id: 42,
            metadata: { email: 'bad@actor.com' },
            ip_address: '127.0.0.1',
            created_at: new Date().toISOString(),
          },
        ],
        total: 1,
        page: 1,
        page_size: 25,
      },
    })

    render(
      <BrowserRouter>
        <AdminAuditLogsPage />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('admin@test.com')).toBeDefined()
    })
    // Action badge
    expect(screen.getByText('user_suspended')).toBeDefined()
    // Target cell — /user/ matches both the badge and the target cell, use getAllByText
    expect(screen.getAllByText(/user/).length).toBeGreaterThanOrEqual(1)

    // Metadata expand toggle
    const metaBtn = screen.getByRole('button', { name: /metadata/i })
    expect(metaBtn).toBeDefined()
    fireEvent.click(metaBtn)
    await waitFor(() => {
      // JSON.stringify of metadata object appears after expanding
      expect(screen.getByText(/bad@actor\.com/)).toBeDefined()
    })
  })

  it('renders filter controls', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: { items: [], total: 0, page: 1, page_size: 25 },
    })

    render(
      <BrowserRouter>
        <AdminAuditLogsPage />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Actor email')).toBeDefined()
    })
    // Action select
    expect(screen.getByRole('option', { name: 'All actions' })).toBeDefined()
    // Target type select
    expect(screen.getByRole('option', { name: 'All targets' })).toBeDefined()
  })
})

// ── 2. AdminCompaniesPage ────────────────────────────────────────────────────

describe('AdminCompaniesPage', () => {
  it('renders company list with verification badges', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: [
        {
          id: 10,
          user_id: 20,
          company_name: 'Acme Corp',
          industry: 'Technology',
          verification_status: 'VERIFIED',
          posting_count: 5,
        },
        {
          id: 11,
          user_id: 21,
          company_name: 'Beta Ltd',
          industry: 'Finance',
          verification_status: 'PENDING',
          posting_count: 0,
        },
      ],
    })

    render(
      <BrowserRouter>
        <AdminCompaniesPage />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeDefined()
    })
    expect(screen.getByText('Beta Ltd')).toBeDefined()
    // VERIFIED badge
    expect(screen.getByText('VERIFIED')).toBeDefined()
    // PENDING badge
    expect(screen.getByText('PENDING')).toBeDefined()
    // Verify button for PENDING company
    const verifyBtns = screen.getAllByRole('button', { name: /verify/i })
    expect(verifyBtns.length).toBeGreaterThanOrEqual(1)
  })

  it('renders empty state when no companies', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: [] })

    render(
      <BrowserRouter>
        <AdminCompaniesPage />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('No companies found')).toBeDefined()
    })
  })
})

// ── 3. AdminCompanyPostingsPage ──────────────────────────────────────────────

describe('AdminCompanyPostingsPage', () => {
  it('renders postings with applicant count and moderation buttons', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: [
        {
          id: 100,
          title: 'ML Research Intern',
          status: 'PENDING_APPROVAL',
          applicant_count: 7,
          created_at: new Date().toISOString(),
        },
      ],
    })

    render(
      <MemoryRouter initialEntries={['/admin/companies/20/postings']}>
        <Routes>
          <Route path="/admin/companies/:companyId/postings" element={<AdminCompanyPostingsPage />} />
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('ML Research Intern')).toBeDefined()
    })
    expect(screen.getByText(/7 applicants/)).toBeDefined()
    // Approve, Reject, Remove buttons
    expect(screen.getByRole('button', { name: /approve/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /reject/i })).toBeDefined()
  })

  it('renders empty state when no postings', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: [] })

    render(
      <MemoryRouter initialEntries={['/admin/companies/20/postings']}>
        <Routes>
          <Route path="/admin/companies/:companyId/postings" element={<AdminCompanyPostingsPage />} />
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('No postings found')).toBeDefined()
    })
  })
})

// ── 4. AdminUsersPage — row click opens detail drawer ────────────────────────

describe('AdminUsersPage — UserDetailDrawer', () => {
  it('clicking a user row fetches detail and opens the slide-over drawer', async () => {
    // First call: list of users
    vi.mocked(api.get).mockImplementationOnce(async () => ({
      data: [
        {
          id: 5,
          email: 'student@example.com',
          role: 'STUDENT',
          is_active: true,
          is_verified: true,
          mfa_enabled: false,
          suspended_at: null,
        },
      ],
    }))

    // Second call: user detail (triggered by row click)
    vi.mocked(api.get).mockImplementationOnce(async () => ({
      data: {
        id: 5,
        email: 'student@example.com',
        role: 'STUDENT',
        is_active: true,
        is_verified: true,
        mfa_enabled: false,
        suspended_at: null,
        student_profile: {
          full_name: 'Alice Smith',
          university: 'MIT',
          major: 'CS',
          graduation_year: 2025,
        },
        applications: [
          {
            id: 1,
            status: 'APPLIED',
            internship_title: 'SWE Intern',
            company_name: 'TechCorp',
            created_at: new Date().toISOString(),
          },
        ],
        recent_audit_events: [],
      },
    }))

    render(
      <BrowserRouter>
        <AdminUsersPage />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('student@example.com')).toBeDefined()
    })

    // Click the row to open the drawer
    fireEvent.click(screen.getByText('student@example.com'))

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeDefined()
    })
    // Application in drawer
    expect(screen.getByText('SWE Intern')).toBeDefined()
    expect(screen.getByText(/TechCorp/)).toBeDefined()
  })
})
