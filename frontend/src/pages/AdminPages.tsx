import { useState, useEffect, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, downloadAuthenticatedFile } from '../api/client'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { DropdownSelect } from '../components/ui/DropdownSelect'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { TableSkeleton, CardSkeleton } from '../components/ui/LoadingSkeleton'
import { ErrorState } from '../components/ui/ErrorState'
import { Modal } from '../components/ui/Modal'
import { Textarea } from '../components/ui/Textarea'
import { SearchBox } from '../components/ui/SearchBox'
import { searchTextMatches, stripMarkdownPreview } from '../lib/search'
import {
  Users,
  ShieldCheck,
  Briefcase,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Ban,
  RotateCcw,
  RefreshCw,
  Building2,
  X,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Activity,
  Eye,
  EyeOff,
  LayoutDashboard,
  Trash2,
  Award,
  Pencil,
  Plus,
  Upload,
} from 'lucide-react'
import { DesktopAnalysisVisuals } from '../components/analytics/DesktopAnalysisVisuals'
import { auditActionLabel } from '../lib/auditActionLabels'
import { WelcomeGreeting } from '../components/dashboard/WelcomeGreeting'
import { useAuthStore } from '../store/auth'
import { KpiCard } from '../components/dashboard/KpiCard'
import { confirmAction, showToast } from '../lib/feedback'
import { routes } from '../lib/routes'
import { AdminSkillTopicsPanel } from './admin/AdminSkillTopicsPanel'

// --- 1. Admin Dashboard ---

export function AdminDashboardPage() {
  const [stats, setStats] = useState({
    usersCount: 0,
    studentsCount: 0,
    companiesCount: 0,
    adminsCount: 0,
    unverifiedCompanies: 0,
    pendingJobs: 0,
    openReports: 0,
  })
  const [pendingCompanies, setPendingCompanies] = useState<any[]>([])
  const [pendingJobsList, setPendingJobsList] = useState<any[]>([])
  const [openReportsList, setOpenReportsList] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [analysisRefreshKey, setAnalysisRefreshKey] = useState(0)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchDashboardData = async () => {
    setLoading(true)
    try {
      const [usersResult, companiesResult, jobsResult, reportsResult] = await Promise.allSettled([
        api.get('/admin/users'),
        api.get('/admin/companies/unverified'),
        api.get('/admin/internships'),
        api.get('/admin/reports'),
      ])

      setStats((previous) => {
        const users = usersResult.status === 'fulfilled' ? usersResult.value.data || [] : null
        const companies = companiesResult.status === 'fulfilled' ? companiesResult.value.data || [] : null
        const jobs = jobsResult.status === 'fulfilled' ? jobsResult.value.data || [] : null
        const reports = reportsResult.status === 'fulfilled' ? reportsResult.value.data || [] : null
        return {
          usersCount: users ? users.length : previous.usersCount,
          studentsCount: users ? users.filter((item: any) => item.role === 'STUDENT').length : previous.studentsCount,
          companiesCount: users ? users.filter((item: any) => item.role === 'COMPANY').length : previous.companiesCount,
          adminsCount: users ? users.filter((item: any) => item.role === 'ADMIN').length : previous.adminsCount,
          unverifiedCompanies: companies ? companies.length : previous.unverifiedCompanies,
          pendingJobs: jobs ? jobs.filter((item: any) => item.status === 'PENDING_APPROVAL').length : previous.pendingJobs,
          openReports: reports ? reports.filter((item: any) => item.status === 'OPEN').length : previous.openReports,
        }
      })

      if (companiesResult.status === 'fulfilled') setPendingCompanies((companiesResult.value.data || []).slice(0, 4))
      if (jobsResult.status === 'fulfilled') setPendingJobsList((jobsResult.value.data || []).filter((item: any) => item.status === 'PENDING_APPROVAL').slice(0, 4))
      if (reportsResult.status === 'fulfilled') setOpenReportsList((reportsResult.value.data || []).filter((item: any) => item.status === 'OPEN').slice(0, 4))
    } catch {
      // handled
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    setAnalysisRefreshKey((prev) => prev + 1)
    await fetchDashboardData()
    setRefreshing(false)
  }

  const handleQuickVerify = async (userId: number, status: 'VERIFIED' | 'REJECTED') => {
    setActionLoading(`comp-${userId}`)
    try {
      await api.post(`/admin/companies/${userId}/verification`, { status })
      await fetchDashboardData()
    } catch {
      showToast('Verification status update failed', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleQuickModerate = async (jobId: number, status: 'PUBLISHED' | 'REJECTED') => {
    setActionLoading(`job-${jobId}`)
    try {
      await api.post(`/admin/internships/${jobId}/moderate`, { status })
      await fetchDashboardData()
    } catch {
      showToast('Job moderation status update failed', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 py-4 sm:py-8 w-full space-y-5 sm:space-y-8">
      <WelcomeGreeting
        role="ADMIN"
        customSubtitle="Platform operations dashboard. Oversee company verification, listing moderation, and ecosystem security."
      />

      {/* Header & Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Platform Admin Dashboard</h1>
            <Badge status="ADMIN" className="text-[10px] sm:text-[11px] font-semibold py-0.5 px-2">
              Admin
            </Badge>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 sm:line-clamp-none">
            Real-time ecosystem oversight, compliance enforcement, moderation, and user management.
          </p>
        </div>

        <div className="flex items-center justify-between gap-2.5 sm:justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={handleRefresh}
            isLoading={refreshing}
            leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />}
            className="text-xs py-1 px-2.5 h-auto"
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI Metrics Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        {[
          { label: 'Total users', value: stats.usersCount, caption: <><Link to={routes.adminStudents()} onClick={(event) => event.stopPropagation()} className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">{stats.studentsCount} students</Link> · <Link to={routes.adminCompanies} onClick={(event) => event.stopPropagation()} className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">{stats.companiesCount} companies</Link></>, href: routes.adminUsers(), icon: <Users className="h-4 w-4" />, info: 'Total accounts currently registered.' },
          { label: 'Verifications', value: stats.unverifiedCompanies, caption: 'Pending review', href: routes.adminVerifications, icon: <ShieldCheck className="h-4 w-4" />, info: 'Company profiles awaiting verification.' },
          { label: 'Job queue', value: stats.pendingJobs, caption: 'Pending approval', href: routes.adminModeration, icon: <Briefcase className="h-4 w-4" />, info: 'Internships awaiting moderation.' },
          { label: 'Disputes', value: stats.openReports, caption: stats.openReports ? 'Open reports' : 'No open reports', href: routes.adminReports(), icon: <AlertTriangle className="h-4 w-4" />, info: 'Reports currently in the open state.' },
        ].map((item) => (
          <KpiCard
            key={item.label}
            label={item.label}
            value={item.value.toLocaleString()}
            caption={item.caption}
            href={item.href}
            icon={item.icon}
            info={item.info}
            loading={loading}
          />
        ))}
      </div>

      {/* Ecosystem Analytics */}
      <div>
        <DesktopAnalysisVisuals
          variant="admin"
          fullAnalyticsMenu
          refreshKey={analysisRefreshKey}
          title="Platform Analytics"
          subtitle="User growth and administrative activity across the platform"
        />
      </div>

      <AdminAdministratorsSection />
      {/* Live Action Queues Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Company Verifications Queue */}
        <Card className="p-6 bg-white space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-600" />
              <h2 className="text-sm font-bold text-slate-900">Companies Awaiting Vetting</h2>
            </div>
            <Link to={routes.adminVerifications} className="text-xs text-purple-600 hover:text-purple-700 font-semibold">
              View All ({stats.unverifiedCompanies}) →
            </Link>
          </div>

          {pendingCompanies.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
              No companies awaiting verification. All vetted!
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {pendingCompanies.map((c) => (
                <div key={c.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 truncate">{c.company_name}</p>
                    <p className="text-slate-400 text-[11px]">{c.industry} • User #{c.user_id}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="primary"
                      className="text-[11px] py-1 px-2.5 bg-emerald-600 hover:bg-emerald-700 h-7"
                      isLoading={actionLoading === `comp-${c.user_id}`}
                      disabled={actionLoading !== null && actionLoading !== `comp-${c.user_id}`}
                      onClick={() => handleQuickVerify(c.user_id, 'VERIFIED')}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[11px] py-1 px-2.5 text-rose-600 hover:bg-rose-50 h-7"
                      isLoading={actionLoading === `comp-${c.user_id}`}
                      disabled={actionLoading !== null && actionLoading !== `comp-${c.user_id}`}
                      onClick={() => handleQuickVerify(c.user_id, 'REJECTED')}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Job Moderation Queue */}
        <Card className="p-6 bg-white space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-indigo-600" />
              <h2 className="text-sm font-bold text-slate-900">Internships in Review Queue</h2>
            </div>
            <Link to={routes.adminModeration} className="text-xs text-purple-600 hover:text-purple-700 font-semibold">
              View All ({stats.pendingJobs}) →
            </Link>
          </div>

          {pendingJobsList.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
              Moderation queue clear. No pending internship postings!
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {pendingJobsList.map((j) => (
                <div key={j.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 truncate">{j.title}</p>
                    <p className="text-slate-400 text-[11px]">Company #{j.company_id} • Status: PENDING</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="primary"
                      className="text-[11px] py-1 px-2.5 bg-indigo-600 hover:bg-indigo-700 h-7"
                      isLoading={actionLoading === `job-${j.id}`}
                      disabled={actionLoading !== null && actionLoading !== `job-${j.id}`}
                      onClick={() => handleQuickModerate(j.id, 'PUBLISHED')}
                    >
                      Publish
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[11px] py-1 px-2.5 text-rose-600 hover:bg-rose-50 h-7"
                      isLoading={actionLoading === `job-${j.id}`}
                      disabled={actionLoading !== null && actionLoading !== `job-${j.id}`}
                      onClick={() => handleQuickModerate(j.id, 'REJECTED')}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Open Disputes Queue */}
        <Card className="p-6 bg-white space-y-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <h2 className="text-sm font-bold text-slate-900">Recent Open Disputes & User Reports</h2>
            </div>
            <Link to={routes.adminReports()} className="text-xs text-purple-600 hover:text-purple-700 font-semibold">
              View All ({stats.openReports}) →
            </Link>
          </div>

          {openReportsList.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
              No open reports or user disputes pending review.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {openReportsList.map((r) => (
                <div key={r.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 truncate">Report #{r.id}: {r.reason}</p>
                    <p className="text-slate-400 text-[11px]">Reporter #{r.reporter_id} • Status: {r.status}</p>
                  </div>
                  <Link to={routes.adminReports()}>
                    <Button size="sm" variant="outline" className="text-[11px] py-1 px-2.5 h-7">
                      Investigate
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

    </div>
  )
}

export function AdminAdministratorsSection() {
  const { session } = useAuthStore()
  const [admins, setAdmins] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const fetchAdmins = async () => {
    try {
      const response = await api.get('/admin/users?role=ADMIN')
      setAdmins(response.data || [])
    } catch {
      setError('Failed to load administrators.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchAdmins()
  }, [])

  const handleToggleSuspend = async (admin: any) => {
    setActionId(admin.id)
    try {
      if (admin.is_active) {
        await api.post(`/admin/users/${admin.id}/suspend`)
      } else {
        await api.post(`/admin/users/${admin.id}/reactivate`)
      }
      await fetchAdmins()
    } catch {
      setError('Failed to update administrator status.')
    } finally {
      setActionId(null)
    }
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      await api.post('/admin/admins', { email: email.trim().toLowerCase(), password })
      setEmail('')
      setPassword('')
      setSuccess('Administrator added successfully.')
      await fetchAdmins()
    } catch (requestError: any) {
      setError(
        requestError.response?.status === 409
          ? 'Email already registered'
          : requestError.response?.data?.detail || 'Failed to add administrator.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="bg-white p-5 sm:p-6 space-y-5">
      <div>
        <h2 className="text-sm font-bold text-slate-900">Administrators</h2>
        <p className="text-xs text-slate-500 mt-1">Manage administrator access and add trusted administrators.</p>
      </div>

      {loading ? (
        <p className="text-xs text-slate-500">Loading administrators...</p>
      ) : admins.length === 0 ? (
        <p className="text-xs text-slate-500">No administrators found.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {admins.map((admin) => (
            <div key={admin.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
              <span className="font-semibold text-slate-800">{admin.email}</span>
              <div className="flex items-center gap-3 text-slate-500">
                <span>{admin.is_active ? 'Active' : 'Suspended'}</span>
                <span>
                  {admin.created_at
                    ? new Date(admin.created_at).toLocaleDateString()
                    : '—'}
                </span>
                {admin.id !== session?.userId && (
                  <Button
                    size="sm"
                    variant="outline"
                    isLoading={actionId === admin.id}
                    onClick={() => void handleToggleSuspend(admin)}
                    className={admin.is_active ? 'text-rose-600 hover:bg-rose-50' : 'text-emerald-600 hover:bg-emerald-50'}
                    leftIcon={admin.is_active ? <Ban className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  >
                    {admin.is_active ? 'Suspend' : 'Reactivate'}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3 border-t border-slate-100 pt-4">
        <h3 className="text-xs font-bold text-slate-800">Add administrator</h3>
        {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
        {success && <p role="status" className="text-xs text-emerald-600">{success}</p>}
        <label className="block space-y-1.5 text-xs font-semibold text-slate-700">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-normal focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </label>
        <label className="block space-y-1.5 text-xs font-semibold text-slate-700">
          <span>Password</span>
          <span className="relative block">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={10}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-xs font-normal focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-2 flex items-center text-slate-500"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </span>
        </label>
        <p className="text-[11px] text-slate-500">At least 10 characters, including a letter and a digit.</p>
        <Button type="submit" size="sm" isLoading={submitting}>
          Add administrator
        </Button>
      </form>
    </Card>
  )
}

// --- 2. User Management ---

function UserTablePill({ children, tone, icon }: { children: string; tone: 'emerald' | 'indigo' | 'purple' | 'green' | 'red' | 'amber' | 'slate'; icon?: ReactNode }) {
  const tones = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300',
    purple: 'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950/50 dark:text-purple-300',
    green: 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/50 dark:text-green-300',
    red: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300',
    amber: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
    slate: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  }
  return (
    <span className={`inline-flex h-7 w-28 shrink-0 items-center justify-center gap-1 rounded-full border px-2 text-center text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap ${tones[tone]}`}>
      {icon}
      {children}
    </span>
  )
}

export function AdminUsersPage() {
  const { session } = useAuthStore()
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [actionId, setActionId] = useState<number | null>(null)
  const [selectedUser, setSelectedUser] = useState<any | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [userToDelete, setUserToDelete] = useState<any | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [confirmationEmail, setConfirmationEmail] = useState('')
  const [deletingUser, setDeletingUser] = useState(false)
  const [successToast, setSuccessToast] = useState('')

  const fetchUsers = async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setError(null)
    try {
      const res = await api.get('/admin/users')
      setUsers(res.data || [])
    } catch {
      setError('Failed to fetch platform users.')
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  const handleToggleSuspend = async (user: any) => {
    setActionId(user.id)
    try {
      if (user.is_active) {
        await api.post(`/admin/users/${user.id}/suspend`)
      } else {
        await api.post(`/admin/users/${user.id}/reactivate`)
      }
      fetchUsers()
    } catch {
      showToast('Failed to update user status.', 'error')
    } finally {
      setActionId(null)
    }
  }

  const handleDeleteUser = async () => {
    if (!userToDelete) return

    setDeletingUser(true)
    try {
      await api.delete(`/admin/users/${userToDelete.id}`, {
        data: {
          confirmation_email: confirmationEmail,
          reason: deleteReason.trim(),
        },
      })
      const deletedUser = userToDelete
      setUsers((current) => current.filter((user) => user.id !== deletedUser.id))
      if (selectedUser?.id === deletedUser.id) setSelectedUser(null)
      setUserToDelete(null)
      setDeleteReason('')
      setConfirmationEmail('')
      setSuccessToast(`${deletedUser.email} was permanently deleted.`)
      window.setTimeout(() => setSuccessToast(''), 4000)
      void fetchUsers(false)
    } catch (error: any) {
      showToast(error.response?.data?.detail || 'Failed to permanently delete user.', 'error')
    } finally {
      setDeletingUser(false)
    }
  }

  const openUserDetail = async (userId: number) => {
    setDetailLoading(true)
    try {
      const res = await api.get(`/admin/users/${userId}`)
      setSelectedUser(res.data)
    } catch {
      showToast('Failed to load user details.', 'error')
    } finally {
      setDetailLoading(false)
    }
  }

  const filtered = users.filter((u) => {
    const matchesSearch = searchTextMatches(search, [u.email])
    const matchesRole = roleFilter ? u.role === roleFilter : true
    return matchesSearch && matchesRole
  })

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Platform Users</h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Audit user accounts and manage active status.</p>
        </div>
        <Link to={routes.admin}>
          <Button variant="outline" size="sm" leftIcon={<LayoutDashboard className="h-3.5 w-3.5" />}>
            Dashboard
          </Button>
        </Link>
      </div>

      {successToast && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          {successToast}
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900 sm:flex-row">
        <SearchBox
          ariaLabel="Search users by email"
          value={search}
          onChange={setSearch}
          scope="users"
          placeholder="Search users by email..."
          className="flex-1 text-xs"
        />

        <DropdownSelect aria-label="Filter users by role" value={roleFilter} onChange={setRoleFilter} options={[{ label: 'All Roles', value: '' }, { label: 'Student', value: 'STUDENT' }, { label: 'Company', value: 'COMPANY' }, { label: 'Admin', value: 'ADMIN' }]} />
        <span className="self-center whitespace-nowrap text-xs font-semibold text-slate-500 dark:text-slate-400">{users.length} users</span>
      </div>

      {loading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchUsers} />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching users found" description="Adjust your filters to see more results." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] table-fixed text-left text-xs">
              <colgroup>
                <col className="w-[70px]" />
                <col className="w-[250px]" />
                <col className="w-[140px]" />
                <col className="w-[140px]" />
                <col className="w-[160px]" />
                <col className="w-[140px]" />
                <col className="w-[220px]" />
              </colgroup>
              <thead className="border-b border-slate-200 bg-slate-50 font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-300">
                <tr>
                  <th className="p-3.5">ID</th>
                  <th className="p-3.5">Email</th>
                  <th className="p-3.5 text-center">Role</th>
                  <th className="p-3.5 text-center">Status</th>
                  <th className="p-3.5 text-center">Email Verified</th>
                  <th className="p-3.5 text-center">2FA / MFA</th>
                  <th className="p-3.5 w-[250px] text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((u) => (
                  <tr key={u.id} className="cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/50" onClick={() => openUserDetail(u.id)}>
                    <td className="p-3.5 font-medium text-slate-900 dark:text-slate-100">#{u.id}</td>
                    <td className="p-3.5 font-semibold text-slate-800 dark:text-slate-200">{u.email}{u.role === 'STUDENT' && <Link to={routes.adminStudentDetail(u.id)} onClick={(event) => event.stopPropagation()} className="ml-2 text-[11px] font-semibold text-indigo-700 hover:underline dark:text-indigo-300">View profile</Link>}{u.role === 'COMPANY' && <Link to={routes.adminCompanyDetail(u.id)} onClick={(event) => event.stopPropagation()} className="ml-2 text-[11px] font-semibold text-indigo-700 hover:underline dark:text-indigo-300">View profile</Link>}</td>
                    <td className="p-3.5 text-center">
                      <UserTablePill tone={u.role === 'STUDENT' ? 'emerald' : u.role === 'COMPANY' ? 'indigo' : 'purple'}>{u.role}</UserTablePill>
                    </td>
                    <td className="p-3.5 text-center">
                      <UserTablePill tone={u.is_active ? 'green' : 'red'}>{u.is_active ? 'ACTIVE' : 'SUSPENDED'}</UserTablePill>
                    </td>
                    <td className="p-3.5 text-center">
                      {u.role === 'COMPANY' && u.email_verification_required === false ? (
                        <UserTablePill tone="slate">NOT REQUIRED</UserTablePill>
                      ) : u.is_verified ? (
                        <UserTablePill tone="green">VERIFIED</UserTablePill>
                      ) : (
                        <UserTablePill tone="amber">PENDING</UserTablePill>
                      )}
                    </td>
                    <td className="p-3.5 text-center">
                      <UserTablePill tone={u.mfa_enabled ? 'green' : 'slate'}>{u.mfa_enabled ? 'ENABLED' : 'DISABLED'}</UserTablePill>
                    </td>
                    <td className="p-3.5 text-right whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
                      {u.id !== session?.userId && (
                        <div className="inline-flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            isLoading={actionId === u.id}
                            onClick={() => handleToggleSuspend(u)}
                            className={`h-9 w-[112px] shrink-0 justify-center whitespace-nowrap px-2 ${u.is_active ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40' : 'text-emerald-600 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40'}`}
                            leftIcon={u.is_active ? <Ban className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                          >
                            {u.is_active ? 'Suspend' : 'Reactivate'}
                          </Button>
                          <Button
                            variant="danger"
                            aria-label={`Delete user ${u.email}`}
                            title="Delete user"
                            onClick={() => {
                              setUserToDelete(u)
                              setDeleteReason('')
                              setConfirmationEmail('')
                            }}
                            className="h-9 w-9 shrink-0 p-0"
                          >
                            <Trash2 aria-hidden="true" className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        isOpen={!!userToDelete}
        onClose={() => {
          if (deletingUser) return
          setUserToDelete(null)
          setDeleteReason('')
          setConfirmationEmail('')
        }}
        title="Permanently delete user"
        description="This action cannot be undone."
      >
        {userToDelete && (
          <div className="space-y-4">
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm dark:border-rose-900 dark:bg-rose-950/30">
              <p className="font-semibold text-rose-800 dark:text-rose-300">{userToDelete.email}</p>
              <p className="mt-1 text-xs text-rose-700 dark:text-rose-400">Role: {userToDelete.role}</p>
              <p className="mt-3 text-xs leading-relaxed text-rose-800 dark:text-rose-300">
                Permanently delete this account and its profile, applications, saved internships, and related data. Company internships will also be removed. This cannot be reversed.
              </p>
            </div>
            <Textarea
              label="Reason for deletion"
              value={deleteReason}
              onChange={(event) => setDeleteReason(event.target.value)}
              placeholder="Enter a reason (at least 5 characters)"
              required
              minLength={5}
            />
            <div className="space-y-1.5">
              <label htmlFor="delete-confirmation-email" className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Type the exact email to confirm
              </label>
              <input
                id="delete-confirmation-email"
                type="email"
                value={confirmationEmail}
                onChange={(event) => setConfirmationEmail(event.target.value)}
                autoComplete="off"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
              <Button
                type="button"
                variant="outline"
                disabled={deletingUser}
                onClick={() => {
                  setUserToDelete(null)
                  setDeleteReason('')
                  setConfirmationEmail('')
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                isLoading={deletingUser}
                disabled={deleteReason.trim().length < 5 || confirmationEmail !== userToDelete.email}
                onClick={() => void handleDeleteUser()}
              >
                Delete permanently
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {selectedUser && (
        <div className="fixed inset-0 z-40 bg-slate-950/30" onClick={() => setSelectedUser(null)}>
          <aside className="absolute right-0 top-0 h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">User detail</p>
                <h2 className="mt-1 text-xl font-bold text-slate-900">{selectedUser.email}</h2>
                <Badge status={selectedUser.role}>{selectedUser.role}</Badge>
              </div>
              <Button variant="outline" size="sm" onClick={() => setSelectedUser(null)} leftIcon={<X className="h-4 w-4" />}>Close</Button>
            </div>
            {detailLoading ? <CardSkeleton /> : <div className="space-y-6 py-5">
              {selectedUser.student_profile && <section>
                <h3 className="mb-2 text-sm font-bold text-slate-900">Profile</h3>
                <p className="text-sm text-slate-700">{selectedUser.student_profile.full_name}</p>
                <p className="text-xs text-slate-500">{selectedUser.student_profile.university} · {selectedUser.student_profile.major}</p>
              </section>}
              {selectedUser.company_profile && <section>
                <h3 className="mb-2 text-sm font-bold text-slate-900">Company</h3>
                <p className="text-sm text-slate-700">{selectedUser.company_profile.company_name}</p>
                <p className="text-xs text-slate-500">{selectedUser.company_profile.industry} · {selectedUser.company_profile.posting_count} postings</p>
                <Badge status={selectedUser.company_profile.verification_status}>{selectedUser.company_profile.verification_status}</Badge>
              </section>}
              {selectedUser.applications && <section>
                <h3 className="mb-2 text-sm font-bold text-slate-900">Applications</h3>
                {selectedUser.applications.length === 0 ? <p className="text-xs text-slate-500">No applications.</p> : <div className="space-y-2">{selectedUser.applications.map((item: any) => <div key={item.id} className="rounded-lg border border-slate-200 p-3"><p className="text-sm font-semibold text-slate-800">{item.internship_title}</p><p className="text-xs text-slate-500">{item.company_name} · {item.status}</p></div>)}</div>}
              </section>}
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900"><Activity className="h-4 w-4" /> Recent actions</h3>
                {selectedUser.recent_audit_events?.length ? <div className="space-y-2">{selectedUser.recent_audit_events.map((item: any) => <div key={item.id} className="border-l-2 border-indigo-200 pl-3"><p className="text-xs font-semibold text-slate-800">{item.action}</p><p className="text-[11px] text-slate-500">{new Date(item.created_at).toLocaleString()}</p></div>)}</div> : <p className="text-xs text-slate-500">No audit events.</p>}
              </section>
            </div>}
          </aside>
        </div>
      )}
    </div>
  )
}

// --- 3. Company Verification Queue ---

export function AdminVerificationsPage() {
  const [companies, setCompanies] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionId, setActionId] = useState<number | null>(null)
  const [rejectingCompany, setRejectingCompany] = useState<any | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [documentError, setDocumentError] = useState('')
  const [openingDocument, setOpeningDocument] = useState<string | null>(null)
  const [documentPreview, setDocumentPreview] = useState<{
    url: string
    contentType: string
    filename: string
  } | null>(null)

  const fetchCompanies = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/admin/verifications')
      setCompanies(res.data || [])
    } catch {
      setError('Failed to fetch unverified companies.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCompanies()
  }, [])

  useEffect(() => () => {
    if (documentPreview) URL.revokeObjectURL(documentPreview.url)
  }, [documentPreview])

  const handleVerify = async (userId: number, status: 'VERIFIED' | 'REJECTED', reason?: string) => {
    setActionId(userId)
    try {
      await api.post(`/admin/companies/${userId}/verification`, { status, ...(reason ? { reason } : {}) })
      setRejectingCompany(null)
      setRejectionReason('')
      await fetchCompanies()
    } catch {
      setDocumentError('Failed to update company verification status.')
    } finally {
      setActionId(null)
    }
  }

  const viewDocument = async (doc: any, company: any) => {
    const url = doc.id != null
      ? `/admin/companies/${company.user_id}/documents/${doc.id}/download`
      : doc.download_url || doc.file_url || doc.url
    if (!url) {
      setDocumentError('This document does not include a view/download URL.')
      return
    }
    const key = `${company.user_id}:${doc.id ?? doc.document_type ?? doc.filename}`
    setOpeningDocument(key)
    setDocumentError('')
    try {
      const response = await api.get(url, { responseType: 'blob' })
      const contentType = String(response.headers['content-type'] || doc.content_type || '')
      const blobUrl = URL.createObjectURL(new Blob([response.data], { type: contentType }))
      setDocumentPreview({
        url: blobUrl,
        contentType,
        filename: doc.original_filename || doc.filename || 'company-document',
      })
    } catch (error: any) {
      setDocumentError(error.response?.data?.detail || 'Could not retrieve this document.')
    } finally {
      setOpeningDocument(null)
    }
  }

  const downloadDocument = async (doc: any, company: any) => {
    const url = doc.id != null
      ? `/admin/companies/${company.user_id}/documents/${doc.id}/download`
      : doc.download_url || doc.file_url || doc.url
    if (!url) {
      setDocumentError('This document does not include a download URL.')
      return
    }
    try {
      await downloadAuthenticatedFile(url, doc.original_filename || doc.filename || 'company-document')
    } catch (error: any) {
      setDocumentError(error.response?.data?.detail || 'Could not download this document.')
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Company Verifications</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Review newly registered employers before granting posting rights.</p>
        </div>
        <Link to={routes.admin}>
          <Button variant="outline" size="sm" leftIcon={<LayoutDashboard className="h-3.5 w-3.5" />}>
            Dashboard
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={fetchCompanies} />
      ) : companies.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Verification queue clear"
          description="All registered organizations have been reviewed. Excellent work!"
        />
      ) : (
        <div className="space-y-3">
          {documentError && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">{documentError}</div>}
          {companies.map((comp) => (
            <Card key={comp.user_id} className="p-5 bg-white dark:bg-slate-900">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-bold text-slate-900">{comp.company_name}</h3>
                    <Badge status="PENDING">Pending Review</Badge>
                  </div>
                  {comp.submitted_at && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Submitted {new Date(comp.submitted_at).toLocaleDateString()}
                    </p>
                  )}
                  <p className="text-xs text-slate-500">
                    Industry: <strong className="text-slate-700">{comp.industry}</strong>
                    {comp.website && (
                      <>
                        {' • '}
                        <a
                          href={comp.website}
                          target="_blank"
                          rel="noreferrer"
                          className="text-purple-600 hover:underline inline-flex items-center gap-1"
                        >
                          {comp.website}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </>
                    )}
                  </p>
                  {comp.description && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 p-2.5 rounded-md border border-slate-100 dark:border-slate-700 mt-2">
                      {comp.description}
                    </p>
                  )}
                  <div className="mt-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Verification documents</p>
                    {(comp.verification_documents || comp.documents || []).length ? (
                      <ul className="space-y-2">
                        {(comp.verification_documents || comp.documents).map((doc: any, index: number) => {
                          const key = `${comp.user_id}:${doc.id ?? doc.document_type ?? index}`
                          return <li key={key} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">{doc.original_filename || doc.filename || doc.document_type?.replace(/_/g, ' ') || `Document ${index + 1}`}</p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                {doc.document_type?.replace(/_/g, ' ') || 'Supporting document'}
                                {doc.file_size ? ` · ${(doc.file_size / (1024 * 1024)).toFixed(1)} MB` : ''}
                                {(doc.uploaded_at || doc.created_at || comp.created_at) ? ` · ${new Date(doc.uploaded_at || doc.created_at || comp.created_at).toLocaleDateString()}` : ''}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <Button size="sm" variant="outline" isLoading={openingDocument === key} onClick={() => void viewDocument(doc, comp)}>
                                View
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => void downloadDocument(doc, comp)}>
                                Download
                              </Button>
                            </div>
                          </li>
                        })}
                      </ul>
                    ) : <p className="text-xs text-slate-500 dark:text-slate-400">No verification document metadata was returned for this company.</p>}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="primary"
                    className="bg-emerald-600 hover:bg-emerald-700"
                    isLoading={actionId === comp.user_id}
                    onClick={() => handleVerify(comp.user_id, 'VERIFIED')}
                    leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
                  >
                    Verify Company
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    isLoading={actionId === comp.user_id}
                    onClick={() => {
                      setRejectingCompany(comp)
                      setRejectionReason('')
                      setDocumentError('')
                    }}
                    leftIcon={<XCircle className="w-3.5 h-3.5" />}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal
        isOpen={documentPreview !== null}
        onClose={() => setDocumentPreview(null)}
        title={documentPreview?.filename || 'Verification document'}
        description="Private company verification document"
        maxWidth="4xl"
      >
        {documentPreview && (
          documentPreview.contentType.startsWith('image/')
            ? <img src={documentPreview.url} alt={documentPreview.filename} className="mx-auto max-h-[70vh] max-w-full object-contain" />
            : documentPreview.contentType === 'application/pdf'
              ? <iframe title={documentPreview.filename} src={documentPreview.url} className="h-[70vh] w-full rounded-lg border border-slate-200 dark:border-slate-700" />
              : <p className="text-sm text-slate-600 dark:text-slate-300">Preview is not available for this file type. Use Download instead.</p>
        )}
      </Modal>

      <Modal
        isOpen={!!rejectingCompany}
        onClose={() => {
          if (actionId !== null) return
          setRejectingCompany(null)
          setRejectionReason('')
        }}
        title="Reject company verification"
        description="Provide specific feedback so the company knows what to correct."
      >
        <div className="space-y-4">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{rejectingCompany?.company_name}</p>
          <Textarea
            label="Reason for rejection"
            required
            minLength={5}
            value={rejectionReason}
            onChange={(event) => setRejectionReason(event.target.value)}
            placeholder="Explain which information or document needs correction."
          />
          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
            <Button variant="outline" disabled={actionId !== null} onClick={() => setRejectingCompany(null)}>Cancel</Button>
            <Button variant="danger" isLoading={actionId === rejectingCompany?.user_id} disabled={rejectionReason.trim().length < 5 || actionId !== null} onClick={() => rejectingCompany && void handleVerify(rejectingCompany.user_id, 'REJECTED', rejectionReason.trim())}>
              Reject verification
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// --- 4. Job Moderation Queue ---

export function AdminModerationPage() {
  const [jobs, setJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionId, setActionId] = useState<number | null>(null)

  const fetchJobs = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/admin/internships')
      setJobs(res.data || [])
    } catch {
      setError('Failed to fetch internships queue.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchJobs()
  }, [])

  const handleModerate = async (jobId: number, status: 'PUBLISHED' | 'REJECTED') => {
    setActionId(jobId)
    try {
      await api.post(`/admin/internships/${jobId}/moderation`, { status })
      fetchJobs()
    } catch {
      showToast('Failed to update internship status.', 'error')
    } finally {
      setActionId(null)
    }
  }

  const pendingList = jobs.filter((j) => j.status === 'PENDING_APPROVAL')

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Job Moderation Queue</h1>
          <p className="text-xs text-slate-500 mt-1">Review submitted internships to ensure legitimacy and compliance.</p>
        </div>
        <Link to={routes.admin}>
          <Button variant="outline" size="sm" leftIcon={<LayoutDashboard className="h-3.5 w-3.5" />}>
            Dashboard
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={fetchJobs} />
      ) : pendingList.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Moderation queue clear"
          description="All submitted internship postings have been reviewed."
        />
      ) : (
        <div className="space-y-3">
          {pendingList.map((job) => (
            <Card key={job.id} className="p-5 bg-white space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-bold text-slate-900">{job.title}</h3>
                    <Badge status="PENDING_APPROVAL">Pending Approval</Badge>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600">
                    <Building2 className="w-3.5 h-3.5" />
                    <span>{job.company_name || `Company #${job.company_id}`}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {job.industry} • {job.location} • ${job.stipend}/mo •{' '}
                    {job.duration_months} mo • {job.work_mode}
                  </p>
                  <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-md border border-slate-100 mt-2 leading-relaxed">
                    {stripMarkdownPreview(job.description || '')}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="primary"
                    className="bg-emerald-600 hover:bg-emerald-700"
                    isLoading={actionId === job.id}
                    onClick={() => handleModerate(job.id, 'PUBLISHED')}
                    leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
                  >
                    Approve & Publish
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    isLoading={actionId === job.id}
                    onClick={() => handleModerate(job.id, 'REJECTED')}
                    leftIcon={<XCircle className="w-3.5 h-3.5" />}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// --- 5. Dispute Reports Resolution ---

export function AdminReportsPage() {
  const [reports, setReports] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resolutionModalReport, setResolutionModalReport] = useState<any | null>(null)
  const [resolutionNotes, setResolutionNotes] = useState('')
  const [submittingResolution, setSubmittingResolution] = useState(false)

  const fetchReports = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/admin/reports')
      setReports(res.data || [])
    } catch {
      setError('Failed to fetch platform reports.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReports()
  }, [])

  const handleStartInvestigating = async (reportId: number) => {
    try {
      await api.patch(`/admin/reports/${reportId}`, {
        status: 'INVESTIGATING',
      })
      fetchReports()
    } catch {
      showToast('Failed to update report status.', 'error')
    }
  }

  const handleResolve = async () => {
    if (!resolutionModalReport) return
    setSubmittingResolution(true)
    try {
      await api.patch(`/admin/reports/${resolutionModalReport.id}`, {
        status: 'RESOLVED',
        resolution_notes: resolutionNotes.trim() || 'Resolved by administrator.',
      })
      setResolutionModalReport(null)
      setResolutionNotes('')
      fetchReports()
    } catch {
      showToast('Failed to resolve report.', 'error')
    } finally {
      setSubmittingResolution(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dispute & Flagged Reports</h1>
          <p className="text-xs text-slate-500 mt-1">Review complaints submitted by students and employers.</p>
        </div>
        <Link to={routes.admin}>
          <Button variant="outline" size="sm" leftIcon={<LayoutDashboard className="h-3.5 w-3.5" />}>
            Dashboard
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={fetchReports} />
      ) : reports.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No open dispute reports"
          description="There are currently no flagged listings or user complaints in the system."
        />
      ) : (
        <div className="space-y-3">
          {reports.map((rep) => (
            <Card key={rep.id} className="p-5 bg-white space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-bold text-slate-900">Report #{rep.id}</h3>
                    <Badge status={rep.status}>{rep.status}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">
                    Reporter: User #{rep.reporter_id}
                    {rep.internship_id && ` • Reported Internship #${rep.internship_id}`}
                    {rep.reported_user_id && ` • Reported User #${rep.reported_user_id}`}
                    {' • '}
                    {new Date(rep.created_at).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-md border border-slate-100 mt-2">
                    <strong className="text-slate-900">Details:</strong> {rep.reason}
                  </p>
                  {rep.resolution_notes && (
                    <p className="text-xs text-emerald-800 bg-emerald-50 p-2 rounded-md border border-emerald-100 mt-1">
                      <strong>Resolution:</strong> {rep.resolution_notes}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {rep.status === 'OPEN' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleStartInvestigating(rep.id)}
                    >
                      Investigate
                    </Button>
                  )}

                  {rep.status === 'INVESTIGATING' && (
                    <Button
                      size="sm"
                      variant="primary"
                      className="bg-purple-600 hover:bg-purple-700"
                      onClick={() => setResolutionModalReport(rep)}
                    >
                      Resolve Dispute
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Resolution Notes Modal */}
      {resolutionModalReport && (
        <Modal
          isOpen={!!resolutionModalReport}
          onClose={() => setResolutionModalReport(null)}
          title={`Resolve Report #${resolutionModalReport.id}`}
          description="Provide notes explaining the actions taken to address this report."
        >
          <div className="space-y-4">
            <Textarea
              label="Resolution Notes"
              placeholder="e.g. Reviewed internship content and confirmed it was updated by the employer..."
              rows={4}
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setResolutionModalReport(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="bg-purple-600 hover:bg-purple-700"
                isLoading={submittingResolution}
                onClick={handleResolve}
              >
                Mark as Resolved
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// --- 6. Company Directory ---

export function AdminCompaniesPage() {
  const [companies, setCompanies] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<number | null>(null)

  const fetchCompanies = async () => {
    setLoading(true)
    try {
      const res = await api.get('/admin/companies')
      setCompanies(res.data || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchCompanies() }, [])

  const verify = async (userId: number, status: 'VERIFIED' | 'REJECTED') => {
    setActionId(userId)
    try {
      await api.post(`/admin/companies/${userId}/verification`, { status })
      await fetchCompanies()
    } catch {
      showToast('Failed to update company verification status.', 'error')
    } finally {
      setActionId(null)
    }
  }

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-slate-900">Company Directory</h1><p className="mt-1 text-xs text-slate-500">Review verification status and posting activity.</p></div><Link to={routes.admin}><Button variant="outline" size="sm" leftIcon={<LayoutDashboard className="h-3.5 w-3.5" />}>Dashboard</Button></Link></div>
      {loading ? <TableSkeleton /> : companies.length === 0 ? <EmptyState title="No companies found" description="Registered companies will appear here." /> : <div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><table className="w-full text-left text-xs"><thead className="border-b border-slate-200 bg-slate-50 text-slate-500"><tr><th className="p-3">Company</th><th className="p-3">Industry</th><th className="p-3">Verification</th><th className="p-3">Postings</th><th className="p-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{companies.map((company) => <tr key={company.id}><td className="p-3 font-semibold text-slate-800"><Link className="hover:text-indigo-600" to={routes.adminCompanyPostings(company.user_id)}>{company.company_name}</Link></td><td className="p-3 text-slate-600">{company.industry}</td><td className="p-3"><Badge status={company.verification_status}>{company.verification_status}</Badge></td><td className="p-3 text-slate-600">{company.posting_count}</td><td className="p-3 text-right"><div className="flex justify-end gap-2">{company.verification_status !== 'VERIFIED' && <Button size="sm" variant="primary" isLoading={actionId === company.user_id} disabled={actionId !== null && actionId !== company.user_id} onClick={() => void verify(company.user_id, 'VERIFIED')} leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}>Verify</Button>}{company.verification_status !== 'REJECTED' && <Button size="sm" variant="outline" className="text-rose-600" isLoading={actionId === company.user_id} disabled={actionId !== null && actionId !== company.user_id} onClick={() => void verify(company.user_id, 'REJECTED')} leftIcon={<XCircle className="h-3.5 w-3.5" />}>Reject</Button>}</div></td></tr>)}</tbody></table></div>}
    </div>
  )
}

// --- 7. Company Postings ---

export function AdminCompanyPostingsPage() {
  const { companyId } = useParams()
  const [postings, setPostings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const fetchPostings = async () => {
    if (!companyId) return
    setLoading(true)
    try { const res = await api.get(`/admin/companies/${companyId}/postings`); setPostings(res.data || []) } finally { setLoading(false) }
  }
  useEffect(() => { fetchPostings() }, [companyId])

  const moderate = async (id: number, status: 'PUBLISHED' | 'REJECTED' | 'CLOSED') => {
    await api.post(`/admin/companies/${companyId}/postings/${id}/moderate`, { status })
    fetchPostings()
  }

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-slate-900">Company Postings</h1><p className="mt-1 text-xs text-slate-500">Inspect applicant volume and moderate listings.</p></div><Link to={routes.adminCompanies}><Button variant="outline" size="sm">Back to companies</Button></Link></div>
      {loading ? <TableSkeleton /> : postings.length === 0 ? <EmptyState title="No postings found" description="This company has no internship postings." /> : <div className="space-y-3">{postings.map((posting) => <Card key={posting.id} className="flex flex-col gap-3 bg-white p-5 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><h2 className="font-bold text-slate-900 dark:text-white">{posting.title}</h2><Badge status={posting.status}>{posting.status === 'CLOSED' ? 'Closed' : posting.status}</Badge></div><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{posting.applicant_count} applicants · Created {new Date(posting.created_at).toLocaleDateString()}</p></div><div className="flex gap-2">{posting.status !== 'PUBLISHED' && <Button size="sm" variant="primary" onClick={() => moderate(posting.id, 'PUBLISHED')}>Approve</Button>}{posting.status !== 'REJECTED' && <Button size="sm" variant="outline" className="text-rose-600" onClick={() => moderate(posting.id, 'REJECTED')}>Reject</Button>}{posting.status !== 'CLOSED' && <Button size="sm" variant="outline" onClick={() => moderate(posting.id, 'CLOSED')}>Close</Button>}</div></Card>)}</div>}
    </div>
  )
}

// --- 8. Audit Log Explorer ---

export function AdminAuditLogsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [logs, setLogs] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [actor, setActor] = useState('')
  const [action, setAction] = useState(() => searchParams.get('action') || '')
  const [range, setRange] = useState(() => searchParams.get('range') || '')
  const [targetType, setTargetType] = useState('')
  const [targetSearch, setTargetSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const pageSize = 25

  const fetchLogs = async () => {
    const params = { page, page_size: pageSize, actor: actor || undefined, action: action || undefined, range: range || undefined, target_type: targetType || undefined, search_target: targetSearch || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined }
    const res = await api.get('/admin/audit-logs', { params })
    setLogs(res.data.items || [])
    setTotal(res.data.total || 0)
  }
  useEffect(() => { fetchLogs() }, [page, actor, action, range, targetType, targetSearch, dateFrom, dateTo])

  useEffect(() => {
    setRange(searchParams.get('range') || '')
  }, [searchParams])

  useEffect(() => {
    const next = new URLSearchParams()
    if (action) next.set('action', action)
    if (range) next.set('range', range)
    setSearchParams(next, { replace: true })
  }, [action, range, setSearchParams])

  const actionColor = (value: string) => {
    const actionValue = value.toLowerCase()
    if (/(approved|verified|reinstated)/.test(actionValue)) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
    if (/(rejected|suspended)/.test(actionValue)) return 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
    if (actionValue.includes('closed')) return 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
    if (/(gdpr|export|erasure)/.test(actionValue)) return 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300'
    return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }
  const targetLabel = (value?: string | null) => {
    if (!value) return null
    if (value.toLowerCase() === 'posting' || value.toLowerCase() === 'internship') return 'Internship'
    if (value.toLowerCase() === 'skill_topic') return 'Skill topic'
    if (value.toLowerCase() === 'skill_question') return 'Skill question'
    if (value.toLowerCase() === 'skill_learning_resource') return 'Learning resource'
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
  }
  const activeWindow = range === 'all'
    ? 'All time'
    : range
      ? `Last ${range.replace('d', '')} days`
      : 'All time'

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-slate-900">Audit Logs</h1><p className="mt-1 text-xs text-slate-500">Search administrative actions and inspect their metadata.</p></div><Link to={routes.admin}><Button variant="outline" size="sm" leftIcon={<LayoutDashboard className="h-3.5 w-3.5" />}>Dashboard</Button></Link></div>
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:flex-wrap sm:items-center"> <input value={actor} onChange={(event) => { setPage(1); setActor(event.target.value) }} placeholder="Actor email" className="h-10 min-w-0 flex-[1.5] rounded-lg border border-slate-300 px-3 text-sm" />
        <DropdownSelect className="min-w-0 flex-1" aria-label="Filter audit logs by action" value={action} onChange={(value) => { setPage(1); setAction(value) }} options={[
          { label: 'All actions', value: '' },
          { label: 'User suspended', value: 'user_suspended' },
          { label: 'Users reinstated', value: 'user_reinstated' },
          { label: 'Company verified', value: 'company_verified' },
          { label: 'Company rejected', value: 'company_rejected' },
          { label: 'Postings approved', value: 'posting_approved' },
          { label: 'Posting rejected', value: 'posting_rejected' },
          { label: 'Posting removed', value: 'posting_removed' },
          { label: 'Report resolved', value: 'report_resolved' },
          { label: 'GDPR data export', value: 'gdpr_data_export' },
        ]} />
        <DropdownSelect className="min-w-0 flex-1" aria-label="Filter audit logs by target type" value={targetType} onChange={(value) => { setPage(1); setTargetType(value) }} options={[
          { label: 'Target type', value: '' },
          { label: 'User', value: 'user' },
          { label: 'Company', value: 'company' },
          { label: 'Internship', value: 'internship' },
          { label: 'Report', value: 'report' },
          { label: 'Skill topic', value: 'skill_topic' },
          { label: 'Skill question', value: 'skill_question' },
          { label: 'Learning resource', value: 'skill_learning_resource' },
        ]} />
        <SearchBox
          ariaLabel="Search audit targets"
          value={targetSearch}
          onChange={(value) => { setPage(1); setTargetSearch(value) }}
          scope="all"
          placeholder="Search target"
          className="h-10 min-w-0 flex-1"
        />

        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-slate-500">From<input type="date" value={dateFrom} onChange={(event) => { setPage(1); setDateFrom(event.target.value) }} className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-2 text-sm text-slate-700" />
        </label><label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-slate-500">To<input type="date" value={dateTo} onChange={(event) => { setPage(1); setDateTo(event.target.value) }} className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-2 text-sm text-slate-700" /></label></div>
      {logs.length === 0 ? <EmptyState icon={ClipboardList} title="No audit events" description="No actions match the current filters." /> : <div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><table className="w-full text-left text-xs"><thead className="border-b border-slate-200 bg-slate-50 text-slate-500"><tr><th className="p-3">Actor</th><th className="p-3">Action</th><th className="p-3">Target</th><th className="p-3">Timestamp</th><th className="p-3" /></tr></thead><tbody className="divide-y divide-slate-100">{logs.map((log) => {
        const typeLabel = targetLabel(log.target_type)
        const isDeleted = String(log.target_label || '').startsWith('Deleted ')
        const resolvedTarget = log.target_label
          || (log.target_type
            ? `${typeLabel || 'Target'}${log.target_id == null ? '' : ` #${log.target_id}`}`
            : null)
        return <tr key={log.id}>
          <td className="p-3 text-slate-700">{log.actor_email ? <span className="inline-flex flex-wrap items-center gap-1.5">{log.actor_email}{log.actor_role && <Badge status={log.actor_role} className="px-1.5 py-0 text-[9px]">{log.actor_role}</Badge>}</span> : 'System'}</td>
          <td className="p-3"><span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${actionColor(log.action)}`}>{auditActionLabel(log.action)}</span></td>
          <td className="p-3 text-slate-600">{!resolvedTarget ? '—' : <span className="inline-flex flex-wrap items-center gap-1.5">{log.target_type && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-300">{typeLabel || 'Target'}</span>}{log.target_url ? <Link to={log.target_url} className={`hover:underline ${isDeleted ? 'text-slate-400 italic' : 'font-medium text-indigo-600 dark:text-indigo-400'}`}>{resolvedTarget}</Link> : <span className={isDeleted ? 'text-slate-400 italic' : ''}>{resolvedTarget}</span>}</span>}</td>
          <td className="p-3 text-slate-500">{new Date(log.created_at).toLocaleString()}</td>
          <td className="p-3 text-right"><Button size="sm" variant="outline" onClick={() => setExpanded(expanded === log.id ? null : log.id)} leftIcon={expanded === log.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}>Metadata</Button>{expanded === log.id && <pre className="mt-2 max-w-xs overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-2 text-left text-[10px] text-emerald-300">{JSON.stringify(log.metadata || {}, null, 2)}</pre>}</td>
        </tr>
      })}</tbody></table></div>}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>{total} events · {activeWindow}</span><div className="flex items-center gap-2">{range && range !== 'all' && <Button size="sm" variant="outline" onClick={() => { setPage(1); setRange('') }}>Show all time</Button>}<Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><span className="px-2 py-2">Page {page}</span><Button size="sm" variant="outline" disabled={page * pageSize >= total} onClick={() => setPage((current) => current + 1)}>Next</Button></div></div>
    </div>
  )
}

type AdminSkillQuestion = {
  id: number
  topic: string
  subtopic: string
  prompt: string
  options: string[]
  correct_index: number
  correct_answers: number[] | null
  correct_option_number?: number
  correct_option_numbers?: number[]
  key_reviewed_at?: string | null
  key_reviewed_by?: number | null
  explanation: string
  difficulty: string
  question_type: string
  source: string
  active: boolean
}

type AdminLearningResource = {
  id: number
  topic: string
  subtopic: string
  title: string
  url: string
  active: boolean
}

type AdminPageNotice = {
  id: number
  kind: 'error' | 'success'
  title: string
  message: string
  details?: Array<{ row?: number; field?: string; message?: string }>
  retry?: () => void
  sectionKey?: string
}

type AdminPageNoticeInput = Omit<AdminPageNotice, 'id'>

const SKILL_FORM_FIELD_CLASS = 'h-10 w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-60'

const EMPTY_SKILL_QUESTION = {
  topic: '',
  subtopic: 'general',
  prompt: '',
  options: '',
  correct_index: '1',
  correct_answers: '',
  explanation: '',
  difficulty: 'MEDIUM',
  question_type: 'SINGLE',
  source: 'Admin curated question',
}

export function AdminSkillAssessmentsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { session } = useAuthStore()
  const sessionUserId = session?.userId
  const selectedTopic = searchParams.get('topic') ?? ''
  const [questions, setQuestions] = useState<AdminSkillQuestion[]>([])
  const [keyReviewQuestions, setKeyReviewQuestions] = useState<AdminSkillQuestion[]>([])
  const [keyReviewNumbers, setKeyReviewNumbers] = useState<Record<number, string>>({})
  const [topicOptions, setTopicOptions] = useState<string[]>([])
  const [subtopicOptions, setSubtopicOptions] = useState<string[]>(['general'])
  const [resources, setResources] = useState<AdminLearningResource[]>([])
  const [resourceSubtopicFilter, setResourceSubtopicFilter] = useState('ALL')
  const [resourceDraft, setResourceDraft] = useState({ topic: '', subtopic: 'general', title: '', url: '' })
  const [editingResourceId, setEditingResourceId] = useState<number | null>(null)
  const [draft, setDraft] = useState(EMPTY_SKILL_QUESTION)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [sectionLoading, setSectionLoading] = useState({
    questions: true,
    resources: true,
    keyReview: true,
  })
  const [sectionErrors, setSectionErrors] = useState({
    questions: false,
    resources: false,
    keyReview: false,
  })
  const [saving, setSaving] = useState(false)
  const [notices, setNotices] = useState<AdminPageNotice[]>([])
  const bannerRef = useRef<HTMLDivElement | null>(null)
  const nextNoticeId = useRef(0)
  const noticeTimers = useRef(new Map<number, number>())
  const importPartial = true
  const [importTopic, setImportTopic] = useState('')
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [resourceValidationErrors, setResourceValidationErrors] = useState<Record<string, string>>({})
  const loadController = useRef<AbortController | null>(null)
  const subtopicController = useRef<AbortController | null>(null)

  const dismissNotice = useCallback((noticeId: number) => {
    const timerId = noticeTimers.current.get(noticeId)
    if (timerId !== undefined) window.clearTimeout(timerId)
    noticeTimers.current.delete(noticeId)
    setNotices((current) => current.filter((notice) => notice.id !== noticeId))
  }, [])

  const addNotice = useCallback((notice: AdminPageNoticeInput) => {
    if (notice.sectionKey) {
      setNotices((current) => current.filter((item) => item.sectionKey !== notice.sectionKey))
    }
    const id = ++nextNoticeId.current
    setNotices((current) => [...current.filter((item) => !notice.sectionKey || item.sectionKey !== notice.sectionKey), { ...notice, id }])
    if (notice.kind === 'success') {
      const timerId = window.setTimeout(() => dismissNotice(id), 5000)
      noticeTimers.current.set(id, timerId)
    }
  }, [dismissNotice])

  const resolveSectionNotice = useCallback((sectionKey: string) => {
    setNotices((current) => current.filter((notice) => notice.sectionKey !== sectionKey))
  }, [])

  const reportError = useCallback((
    title: string,
    message: string,
    retry?: () => void,
    sectionKey?: string,
    details?: AdminPageNoticeInput['details'],
  ) => {
    addNotice({ kind: 'error', title, message, retry, sectionKey, details })
  }, [addNotice])

  const reportSuccess = useCallback((message: string) => {
    addNotice({ kind: 'success', title: 'Success', message })
  }, [addNotice])
  const setLoadedTopicOptions = useCallback((topics: string[]) => setTopicOptions(topics), [])

  useEffect(() => () => {
    for (const timerId of noticeTimers.current.values()) window.clearTimeout(timerId)
  }, [])

  const fieldClassName = (field: string) => `${SKILL_FORM_FIELD_CLASS} ${validationErrors[field] ? 'border-rose-400 focus-visible:ring-rose-500' : 'border-slate-300 focus-visible:border-indigo-500 focus-visible:ring-indigo-500 dark:border-slate-700'}`
  const resourceFieldClassName = (field: string) => `${SKILL_FORM_FIELD_CLASS} ${resourceValidationErrors[field] ? 'border-rose-400 focus-visible:ring-rose-500' : 'border-slate-300 focus-visible:border-indigo-500 focus-visible:ring-indigo-500 dark:border-slate-700'}`
  const ACCEPTED_IMPORT_TYPES = '.csv,.tsv,.txt,.json,.xlsx,.xls,.ods'

  const clearFieldError = (field: string) => {
    setValidationErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  const clearResourceFieldError = (field: string) => {
    setResourceValidationErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  const parseOptionNumbers = (values: string) => {
    const rawNumbers = values.split(',').map((value) => value.trim())
    if (!rawNumbers.length || rawNumbers.some((value) => !/^[1-9]\d*$/.test(value))) return []
    return rawNumbers.map(Number)
  }

  const validateQuestionDraft = (nextDraft: typeof draft = draft) => {
    const nextErrors: Record<string, string> = {}
    if (!nextDraft.topic.trim()) nextErrors.topic = 'Topic is required.'
    if (!nextDraft.subtopic.trim()) nextErrors.subtopic = 'Subtopic is required.'
    if (!nextDraft.prompt.trim()) nextErrors.prompt = 'Question prompt is required.'
    const optionLines = nextDraft.options.split(/\r?\n/).map((option) => option.trim()).filter(Boolean)
    if (optionLines.length < 2) nextErrors.options = 'Add at least two answer options.'
    if (!nextDraft.explanation.trim()) nextErrors.explanation = 'Explanation is required.'
    const optionNumbers = parseOptionNumbers(nextDraft.correct_answers)
    if (nextDraft.question_type === 'MULTI') {
      if (optionNumbers.length < 2 || optionNumbers.some((number) => number > optionLines.length)) {
        nextErrors.correct_answers = `Choose at least two option numbers from 1 to ${optionLines.length}.`
      } else if (new Set(optionNumbers).size !== optionNumbers.length) {
        nextErrors.correct_answers = 'Choose each correct option number only once.'
      }
    } else {
      const indexValue = Number(nextDraft.correct_index)
      if (!Number.isInteger(indexValue) || indexValue < 1 || indexValue > optionLines.length) {
        nextErrors.correct_index = `Choose a number from 1 to ${optionLines.length}.`
      }
    }
    if (!nextDraft.source.trim()) nextErrors.source = 'Source is required.'
    setValidationErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const validateResourceDraft = (nextResourceDraft: typeof resourceDraft = resourceDraft) => {
    const nextErrors: Record<string, string> = {}
    if (!nextResourceDraft.topic.trim()) nextErrors.topic = 'Topic is required.'
    if (!nextResourceDraft.subtopic.trim()) nextErrors.subtopic = 'Subtopic is required.'
    if (!nextResourceDraft.title.trim()) nextErrors.title = 'Resource title is required.'
    if (!nextResourceDraft.url.trim()) nextErrors.url = 'Resource URL is required.'
    else if (!/^https?:\/\//i.test(nextResourceDraft.url.trim())) nextErrors.url = 'Use a valid http:// or https:// URL.'
    setResourceValidationErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const loadQuestionBank = useCallback(async function loadQuestionBank(signal?: AbortSignal) {
    if (!selectedTopic) {
      setQuestions([])
      setSectionErrors((current) => ({ ...current, questions: false }))
      setSectionLoading((current) => ({ ...current, questions: false }))
      return
    }
    setSectionLoading((current) => ({ ...current, questions: true }))
    try {
      const response = await api.get<AdminSkillQuestion[]>(
        `/skills/admin/questions?topic_id=${encodeURIComponent(selectedTopic)}`,
        signal ? { signal } : undefined,
      )
      if (signal?.aborted) return
      if (!Array.isArray(response.data)) throw new Error('Question bank response was not a list.')
      setQuestions(response.data)
      setSectionErrors((current) => ({ ...current, questions: false }))
      resolveSectionNotice('question-bank')
    } catch (requestError) {
      if (signal?.aborted) return
      console.error(`Unable to load skill question bank for ${selectedTopic}.`, requestError)
      setSectionErrors((current) => ({ ...current, questions: true }))
      reportError(
        "Couldn't load question bank",
        `Questions for ${selectedTopic} could not be loaded.`,
        () => void loadQuestionBank(),
        'question-bank',
      )
    } finally {
      if (!signal?.aborted) setSectionLoading((current) => ({ ...current, questions: false }))
    }
  }, [selectedTopic, resolveSectionNotice, reportError])

  const loadStudyResources = useCallback(async function loadStudyResources(signal?: AbortSignal) {
    if (!selectedTopic) {
      setResources([])
      setSectionErrors((current) => ({ ...current, resources: false }))
      setSectionLoading((current) => ({ ...current, resources: false }))
      return
    }
    setSectionLoading((current) => ({ ...current, resources: true }))
    try {
      const response = await api.get<AdminLearningResource[]>(
        `/skills/admin/resources?topic_id=${encodeURIComponent(selectedTopic)}`,
        signal ? { signal } : undefined,
      )
      if (signal?.aborted) return
      if (!Array.isArray(response.data)) throw new Error('Study resources response was not a list.')
      setResources(response.data)
      setSectionErrors((current) => ({ ...current, resources: false }))
      resolveSectionNotice('study-resources')
    } catch (requestError) {
      if (signal?.aborted) return
      console.error(`Unable to load study resources for ${selectedTopic}.`, requestError)
      setSectionErrors((current) => ({ ...current, resources: true }))
      reportError(
        "Couldn't load study resources",
        `Study resources for ${selectedTopic} could not be loaded.`,
        () => void loadStudyResources(),
        'study-resources',
      )
    } finally {
      if (!signal?.aborted) setSectionLoading((current) => ({ ...current, resources: false }))
    }
  }, [selectedTopic, resolveSectionNotice, reportError])

  const loadKeyReview = useCallback(async function loadKeyReview(signal?: AbortSignal) {
    setSectionLoading((current) => ({ ...current, keyReview: true }))
    try {
      const response = await api.get<AdminSkillQuestion[]>(
        '/skills/admin/questions/key-review',
        signal ? { signal } : undefined,
      )
      if (signal?.aborted) return
      if (!Array.isArray(response.data)) throw new Error('Key-review response was not a list.')
      setKeyReviewQuestions(response.data)
      setKeyReviewNumbers(Object.fromEntries(response.data.map((question) => [
        question.id,
        (question.correct_option_numbers ?? [question.correct_option_number ?? question.correct_index + 1]).join(', '),
      ])))
      setSectionErrors((current) => ({ ...current, keyReview: false }))
      resolveSectionNotice('key-review')
    } catch (requestError) {
      if (signal?.aborted) return
      console.error('Unable to load answer keys requiring review.', requestError)
      setSectionErrors((current) => ({ ...current, keyReview: true }))
      reportError(
        "Couldn't load key review",
        'Questions requiring key verification could not be loaded.',
        () => void loadKeyReview(),
        'key-review',
      )
    } finally {
      if (!signal?.aborted) setSectionLoading((current) => ({ ...current, keyReview: false }))
    }
  }, [resolveSectionNotice, reportError])

  const load = useCallback(async () => {
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    await Promise.allSettled([
      loadQuestionBank(controller.signal),
      loadStudyResources(controller.signal),
      loadKeyReview(controller.signal),
    ])
  }, [loadQuestionBank, loadStudyResources, loadKeyReview])
  const lastNoticeId = notices[notices.length - 1]?.id

  const loadSubtopics = useCallback(async function loadSubtopics(signal?: AbortSignal) {
    if (!selectedTopic) {
      setSubtopicOptions(['general'])
      resolveSectionNotice('subtopics')
      return
    }
    try {
      const response = await api.get<Array<{ id: string; question_count: number }>>(
        `/skills/admin/skill-topics/${encodeURIComponent(selectedTopic)}/subtopics`,
        signal ? { signal } : undefined,
      )
      if (signal?.aborted) return
      const available = response.data.map((item) => item.id)
      const choices = available.length ? available : ['general']
      setSubtopicOptions(choices)
      let savedSubtopic: string | null = null
      try {
        savedSubtopic = window.sessionStorage.getItem(`admin-skill-subtopic:${sessionUserId ?? 'anonymous'}:${selectedTopic}`)
      } catch {
        savedSubtopic = null
      }
      const nextSubtopic = savedSubtopic && choices.includes(savedSubtopic) ? savedSubtopic : choices[0]
      setDraft((current) => ({ ...current, topic: selectedTopic, subtopic: nextSubtopic }))
      resolveSectionNotice('subtopics')
    } catch (requestError) {
      if (signal?.aborted) return
      console.error(`Unable to load subtopics for ${selectedTopic}.`, requestError)
      setSubtopicOptions(['general'])
      setDraft((current) => ({ ...current, topic: selectedTopic, subtopic: 'general' }))
      reportError(
        "Couldn't load subtopics",
        `Subtopic options for ${selectedTopic} could not be loaded. Using general for now.`,
        () => void loadSubtopics(),
        'subtopics',
      )
    }
  }, [selectedTopic, sessionUserId, resolveSectionNotice, reportError])

  useEffect(() => {
    if (notices.length === 0 || !bannerRef.current) return
    if (typeof bannerRef.current.scrollIntoView === 'function') {
      bannerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    bannerRef.current.focus()
  }, [notices.length, lastNoticeId])

  useEffect(() => {
    void load()
    return () => loadController.current?.abort()
  }, [load])
  useEffect(() => {
    if (selectedTopic) {
      setImportTopic(selectedTopic)
    }
    setResourceSubtopicFilter('ALL')
  }, [selectedTopic])

  useEffect(() => {
    setDraft((current) => ({ ...current, topic: selectedTopic, subtopic: 'general' }))
    setEditingId(null)
    setSubtopicOptions(['general'])
    subtopicController.current?.abort()
    const controller = new AbortController()
    subtopicController.current = controller
    void loadSubtopics(controller.signal)
    return () => controller.abort()
  }, [selectedTopic, loadSubtopics])

  const changeSelectedTopic = useCallback((topic: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (topic) next.set('topic', topic)
      else next.delete('topic')
      return next
    }, { replace: true })
  }, [setSearchParams])

  const resetDraft = () => {
    setDraft({ ...EMPTY_SKILL_QUESTION, topic: selectedTopic, subtopic: subtopicOptions[0] ?? 'general' })
    setEditingId(null)
    setValidationErrors({})
  }

  const beginEdit = (question: AdminSkillQuestion) => {
    setEditingId(question.id)
    setDraft({
      topic: selectedTopic,
      subtopic: question.subtopic,
      prompt: question.prompt,
      options: question.options.join('\n'),
      correct_index: String((question.correct_index ?? 0) + 1),
      correct_answers: question.correct_answers?.map((value) => value + 1).join(', ') ?? '',
      explanation: question.explanation,
      difficulty: question.difficulty,
      question_type: question.question_type,
      source: question.source,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const saveQuestion = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!validateQuestionDraft()) return

    setSaving(true)
    const options = draft.options.split(/\r?\n/).map((option) => option.trim()).filter(Boolean)
    const payload = {
      topic: draft.topic.trim(),
      subtopic: draft.subtopic.trim(),
      prompt: draft.prompt.trim(),
      options,
      correct_index: draft.question_type === 'MULTI' ? null : Math.max(0, Number(draft.correct_index) - 1),
      correct_answers: draft.question_type === 'MULTI'
        ? parseOptionNumbers(draft.correct_answers).sort((left, right) => left - right).map((number) => number - 1)
        : [],
      explanation: draft.explanation.trim(),
      difficulty: draft.difficulty,
      question_type: draft.question_type,
      source: draft.source.trim(),
    }
    try {
      if (editingId == null) await api.post('/skills/admin/questions', payload)
      else await api.patch(`/skills/admin/questions/${editingId}`, payload)
      reportSuccess(editingId == null ? 'Question created and audit logged.' : 'Question updated and audit logged.')
      setEditingId(null)
      setValidationErrors({})
      setDraft((current) => ({
        ...current,
        prompt: '',
        options: '',
        correct_index: '1',
        correct_answers: '',
        explanation: '',
      }))
      await load()
    } catch (requestError) {
      console.error('Unable to save admin skill assessment question.', requestError)
      const detail = (requestError as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      reportError("Couldn't save question", typeof detail === 'string' ? detail : 'Question could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const deleteQuestion = async (question: AdminSkillQuestion) => {
    if (!await confirmAction({
      title: 'Delete skill question?',
      message: `Delete this ${question.topic} question?`,
      confirmLabel: 'Delete question',
      destructive: true,
    })) return
    try {
      await api.delete(`/skills/admin/questions/${question.id}`)
      reportSuccess('Question deleted and audit logged.')
      await load()
    } catch (requestError) {
      console.error(`Unable to delete skill question ${question.id}.`, requestError)
      reportError("Couldn't delete question", 'Question could not be deleted.')
    }
  }

  const importQuestions = async (file: File | undefined) => {
    if (!file) return
    const payload = new FormData()
    payload.append('file', file)
    if (importTopic) payload.append('topic_id', importTopic)
    try {
      const query = new URLSearchParams()
      if (importPartial) query.set('partial', 'true')
      if (importTopic) query.set('topic_id', importTopic)
      const response = await api.post(`/skills/admin/questions/import${query.size ? `?${query}` : ''}`, payload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const imported = Number(response.data?.imported ?? 0)
      const errors = Array.isArray(response.data?.errors) ? response.data.errors : []
      if (errors.length > 0) {
        reportError(
          'Import review required',
          `${imported} questions were imported. ${errors.length} row(s) were skipped.`,
          undefined,
          undefined,
          errors.slice(0, 10),
        )
      } else {
        reportSuccess(`${imported} questions imported and audit logged.`)
      }
      if (importTopic && importTopic !== selectedTopic) changeSelectedTopic(importTopic)
      else await load()
    } catch (requestError) {
      console.error('Unable to import skill assessment questions.', requestError)
      const detail = (requestError as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      const fallback = 'Question import failed. Check the file format, headers, options, and correct_option number.'
      const message = typeof detail === 'string' ? detail : fallback
      reportError('Import failed', message)
    }
  }

  const resetResourceDraft = () => {
    setResourceDraft({ topic: '', subtopic: 'general', title: '', url: '' })
    setEditingResourceId(null)
    setResourceValidationErrors({})
  }

  const saveResource = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!validateResourceDraft()) return
    setSaving(true)
    try {
      if (editingResourceId == null) {
        await api.post('/skills/admin/resources', resourceDraft)
        reportSuccess('Learning resource added and audit logged.')
      } else {
        await api.patch(`/skills/admin/resources/${editingResourceId}`, {
          title: resourceDraft.title,
          url: resourceDraft.url,
        })
        reportSuccess('Learning resource updated and audit logged.')
      }
      resetResourceDraft()
      await load()
    } catch (requestError) {
      console.error('Unable to save skill assessment learning resource.', requestError)
      const detail = (requestError as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      reportError("Couldn't save study resource", typeof detail === 'string' ? detail : 'Learning resource could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const deleteResource = async (resource: AdminLearningResource) => {
    if (!await confirmAction({
      title: 'Delete learning resource?',
      message: `Delete the learning link "${resource.title}"?`,
      confirmLabel: 'Delete resource',
      destructive: true,
    })) return
    try {
      await api.delete(`/skills/admin/resources/${resource.id}`)
      reportSuccess('Learning resource deleted and audit logged.')
      if (editingResourceId === resource.id) resetResourceDraft()
      await load()
    } catch (requestError) {
      console.error(`Unable to delete learning resource ${resource.id}.`, requestError)
      reportError("Couldn't delete study resource", 'Learning resource could not be deleted.')
    }
  }

  const visibleQuestions = questions
  const resourceSubtopics = Array.from(new Set(resources.map((resource) => resource.subtopic))).sort()
  const visibleResources = resourceSubtopicFilter === 'ALL'
    ? resources
    : resources.filter((resource) => resource.subtopic === resourceSubtopicFilter)
  const optionPreview = draft.options.split(/\r?\n/).map((option) => option.trim()).filter(Boolean)
  const selectedOptionNumbers = draft.question_type === 'MULTI'
    ? parseOptionNumbers(draft.correct_answers)
    : [Number(draft.correct_index)]
  const correctAnswerPreview = selectedOptionNumbers
    .filter((number) => Number.isInteger(number) && number >= 1 && number <= optionPreview.length)
    .map((number) => `'${optionPreview[number - 1]}'`)

  const reviewQuestionKey = async (question: AdminSkillQuestion, fixKey: boolean) => {
    let payload: Record<string, number | number[]> = {}
    if (fixKey) {
      if (question.question_type === 'MULTI') {
        const numbers = parseOptionNumbers(keyReviewNumbers[question.id] ?? '')
          .sort((left, right) => left - right)
        if (numbers.length < 2 || numbers.some((number) => number > question.options.length) || new Set(numbers).size !== numbers.length) {
          reportError('Invalid answer key', `Choose unique correct option numbers from 1 to ${question.options.length}.`)
          return
        }
        payload = { correct_option_numbers: numbers }
      } else {
        const number = Number(keyReviewNumbers[question.id])
        if (!Number.isInteger(number) || number < 1 || number > question.options.length) {
          reportError('Invalid answer key', `Choose a number from 1 to ${question.options.length}.`)
          return
        }
        payload = { correct_option_number: number }
      }
    }

    try {
      await api.post(`/skills/admin/questions/${question.id}/key-review`, payload)
      reportSuccess(fixKey ? 'Answer key corrected and reviewed.' : 'Answer key confirmed.')
      await load()
    } catch (requestError) {
      console.error(`Unable to review answer key for question ${question.id}.`, requestError)
      const detail = (requestError as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      reportError("Couldn't review answer key", typeof detail === 'string' ? detail : 'Answer key could not be reviewed.')
    }
  }

  const downloadTemplate = async () => {
    if (!importTopic) {
      reportError('Choose a topic', 'Select a topic before downloading its question template.')
      return
    }
    try {
      const query = new URLSearchParams({ topic_id: importTopic })
      const filename = await downloadAuthenticatedFile(
        `/skills/admin/questions/import/template?${query}`,
        `skill-${importTopic}-template.csv`,
      )
      reportSuccess(`Template downloaded: ${filename}`)
    } catch (requestError) {
      console.error('Unable to download the import template.', requestError)
      reportError("Couldn't download template", 'The import template could not be downloaded.')
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Skill assessments</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Manage question banks, imports, and topic results.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownSelect
            className="min-w-40"
            aria-label="Template topic"
            value={importTopic}
            onChange={setImportTopic}
            options={[
              { label: 'Select topic', value: '' },
              ...topicOptions.map((topic) => ({ label: topic, value: topic })),
            ]}
          />
          <Button type="button" variant="outline" size="sm" disabled={!importTopic} onClick={() => void downloadTemplate()}>Download template</Button>
          <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
            <Upload className="h-4 w-4" /> Import questions
            <input
              type="file"
              accept={ACCEPTED_IMPORT_TYPES}
              className="sr-only"
              aria-label="Import assessment questions from a supported file type"
              onChange={(event) => {
                void importQuestions(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </label>
        </div>
      </header>

      {notices.length > 0 && (
        <div
          ref={bannerRef}
          tabIndex={-1}
          aria-label="Skill assessment notifications"
          className="sticky top-16 z-30 space-y-2 bg-slate-50/95 py-2 backdrop-blur dark:bg-slate-950/95"
        >
          {notices.map((notice) => (
            <div
              key={notice.id}
              role={notice.kind === 'error' ? 'alert' : undefined}
              aria-live={notice.kind === 'success' ? 'polite' : undefined}
              className={`rounded-xl border px-4 py-3 text-sm ${notice.kind === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/90 dark:text-rose-200' : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/90 dark:text-emerald-200'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{notice.title}</p>
                  <p className="mt-1">{notice.message}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {notice.retry && <Button type="button" size="sm" variant="outline" onClick={notice.retry}>Retry</Button>}
                  <button type="button" onClick={() => dismissNotice(notice.id)} className="rounded-md border border-current px-2 py-1 text-xs font-medium">Dismiss</button>
                </div>
              </div>
              {notice.details && notice.details.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs">
                  {notice.details.slice(0, 10).map((item, index) => (
                    <li key={`${item.row ?? 'row'}-${item.field ?? 'field'}-${index}`}>
                      {item.row != null ? `Row ${item.row}: ` : ''}{item.message || item.field || 'Unknown validation issue'}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <AdminSkillTopicsPanel
        selectedTopic={selectedTopic}
        onSelectedTopicChange={changeSelectedTopic}
        onNotice={addNotice}
        onResolveNotice={resolveSectionNotice}
        onTopicsLoaded={setLoadedTopicOptions}
        onTopicCreated={(topic) => {
          changeSelectedTopic(topic)
          window.setTimeout(() => {
            document.getElementById('skill-question-form')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
            document.getElementById('skill-question-prompt')?.focus()
          }, 100)
        }}
      />

      {sectionLoading.keyReview ? null : sectionErrors.keyReview ? (
        <section aria-label="Answer key verification" className="rounded-xl border border-dashed border-amber-300 p-4 text-sm text-amber-800 dark:border-amber-800 dark:text-amber-200">
          Answer keys could not be loaded. Use Retry above to try again.
        </section>
      ) : keyReviewQuestions.length > 0 ? (
        <section aria-label="Answer key verification" className="space-y-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-slate-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-slate-100">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-bold">{keyReviewQuestions.length} questions need key verification</h2>
              <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">Review legacy admin-entered answers. No key is changed unless you choose “Fix key.”</p>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-amber-200 dark:border-amber-900">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-white/70 text-xs uppercase text-slate-600 dark:bg-slate-900/70 dark:text-slate-300">
                <tr><th className="p-3">Question</th><th className="p-3">Numbered options</th><th className="p-3">Review answer key</th></tr>
              </thead>
              <tbody className="divide-y divide-amber-200 dark:divide-amber-900">
                {keyReviewQuestions.map((question) => {
                  const keyNumbers = question.correct_option_numbers ?? [question.correct_option_number ?? question.correct_index + 1]
                  return (
                    <tr key={question.id} className="align-top">
                      <td className="max-w-xs p-3">
                        <p className="font-semibold">{question.prompt}</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{question.topic} · {question.subtopic} · {question.source}</p>
                      </td>
                      <td className="p-3">
                        <p className="mb-1 text-xs font-semibold text-amber-900 dark:text-amber-200">Stored key number: {keyNumbers.join(', ') || 'invalid or missing'}</p>
                        <ol className="space-y-1">
                          {question.options.map((option, index) => {
                            const number = index + 1
                            const isCurrentKey = keyNumbers.includes(number)
                            return (
                              <li key={`${question.id}-${number}`} className={`rounded-md px-2 py-1 ${isCurrentKey ? 'bg-amber-200 font-semibold text-amber-950 ring-1 ring-amber-500 dark:bg-amber-900/70 dark:text-amber-100 dark:ring-amber-600' : 'text-slate-700 dark:text-slate-300'}`}>
                                {number}. {option}{isCurrentKey ? ' — Current key' : ''}
                              </li>
                            )
                          })}
                        </ol>
                      </td>
                      <td className="min-w-[220px] p-3">
                        <label className="block text-xs font-semibold" htmlFor={`question-key-${question.id}`}>
                          {question.question_type === 'MULTI' ? 'Correct option numbers, comma separated' : 'Correct option number'}
                          <input
                            id={`question-key-${question.id}`}
                            type="text"
                            inputMode="numeric"
                            aria-label={question.question_type === 'MULTI' ? 'Correct option numbers, comma separated' : 'Correct option number'}
                            value={keyReviewNumbers[question.id] ?? ''}
                            onChange={(event) => setKeyReviewNumbers((current) => ({ ...current, [question.id]: event.target.value }))}
                            className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          />
                        </label>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => void reviewQuestionKey(question, false)}>Key is correct</Button>
                          <Button type="button" size="sm" variant="primary" onClick={() => void reviewQuestionKey(question, true)}>Fix key</Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <Card id="skill-question-form" className="p-4 dark:bg-slate-900">
        <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
          {editingId == null ? <Plus className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          {editingId == null ? 'Add question' : `Edit question #${editingId}`}
        </h2>
        <form onSubmit={(event) => void saveQuestion(event)} className="grid gap-3 md:grid-cols-2">
          <label htmlFor="skill-question-topic" className="space-y-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
            Topic ID
            <input
              id="skill-question-topic"
              required
              readOnly={Boolean(selectedTopic)}
              value={draft.topic}
              aria-invalid={Boolean(validationErrors.topic)}
              className={fieldClassName('topic')}
            />
            {validationErrors.topic && <span className="text-[11px] font-medium text-rose-600">{validationErrors.topic}</span>}
          </label>
          <div>
            <DropdownSelect
              label="Subtopic ID"
              value={draft.subtopic}
              options={subtopicOptions.map((subtopic) => ({ value: subtopic, label: subtopic }))}
              onChange={(subtopic) => {
                setDraft((current) => ({ ...current, subtopic }))
                try {
                  window.sessionStorage.setItem(`admin-skill-subtopic:${session?.userId ?? 'anonymous'}:${selectedTopic}`, subtopic)
                } catch {
                  // Session storage is optional; the selection remains available for this page session.
                }
                clearFieldError('subtopic')
              }}
            />
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Choose an existing subtopic for this topic.</p>
            {validationErrors.subtopic && <span className="text-[11px] font-medium text-rose-600">{validationErrors.subtopic}</span>}
          </div>
          <label className="space-y-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
            Difficulty
            <DropdownSelect aria-label="Question difficulty" value={draft.difficulty} onChange={(difficulty) => setDraft((current) => ({ ...current, difficulty }))} options={[{ label: 'Easy (1 point)', value: 'EASY' }, { label: 'Medium (2 points)', value: 'MEDIUM' }, { label: 'Hard (3 points)', value: 'HARD' }]} />
          </label>
          <label className="space-y-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
            Question type
            <DropdownSelect aria-label="Question type" value={draft.question_type} onChange={(question_type) => setDraft((current) => ({ ...current, question_type }))} options={[{ label: 'Single answer', value: 'SINGLE' }, { label: 'Multiple answers', value: 'MULTI' }, { label: 'True / false', value: 'TRUE_FALSE' }]} />
          </label>
          <label htmlFor="skill-question-prompt" className="space-y-1 text-xs font-semibold text-slate-700 dark:text-slate-300 md:col-span-2">
            Question
            <Textarea
              required
              rows={2}
              value={draft.prompt}
              id="skill-question-prompt"
              error={validationErrors.prompt}
              className={SKILL_FORM_FIELD_CLASS}
              onChange={(event) => {
                setDraft((current) => ({ ...current, prompt: event.target.value }))
                clearFieldError('prompt')
              }}
            />
          </label>
          <label htmlFor="skill-question-options" className="space-y-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
            Answer options (one per line)
            <Textarea
              required
              rows={4}
              value={draft.options}
              id="skill-question-options"
              error={validationErrors.options}
              className={SKILL_FORM_FIELD_CLASS}
              onChange={(event) => {
                setDraft((current) => ({ ...current, options: event.target.value }))
                clearFieldError('options')
              }}
            />
          </label>
          <div className="space-y-3">
            <label htmlFor={draft.question_type === 'MULTI' ? 'skill-question-correct-answers' : 'skill-question-correct-index'} className="block space-y-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
              {draft.question_type === 'MULTI' ? 'Correct option numbers, comma separated' : 'Correct option number'}
              {draft.question_type === 'MULTI' ? (
                <input
                  required
                  type="text"
                  inputMode="numeric"
                  aria-label="Correct option numbers, comma separated"
                  value={draft.correct_answers}
                  id="skill-question-correct-answers"
                  aria-invalid={Boolean(validationErrors.correct_answers)}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, correct_answers: event.target.value }))
                    clearFieldError('correct_answers')
                  }}
                  placeholder="1, 2"
                  className={fieldClassName('correct_answers')}
                />
              ) : (
                <input
                  required
                  type="number"
                  min={1}
                  max={optionPreview.length || undefined}
                  aria-label="Correct option number"
                  value={draft.correct_index}
                  id="skill-question-correct-index"
                  aria-invalid={Boolean(validationErrors.correct_index)}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, correct_index: event.target.value }))
                    clearFieldError('correct_index')
                  }}
                  className={fieldClassName('correct_index')}
                />
              )}
              <p aria-live="polite" className="mt-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                Correct {draft.question_type === 'MULTI' ? 'answers' : 'answer'}: {correctAnswerPreview.length ? correctAnswerPreview.join(', ') : 'Choose a valid option number'}
              </p>
              {validationErrors.correct_index && <span className="mt-1 block text-[11px] font-medium text-rose-600">{validationErrors.correct_index}</span>}
              {validationErrors.correct_answers && <span className="mt-1 block text-[11px] font-medium text-rose-600">{validationErrors.correct_answers}</span>}
              <ol aria-label="Numbered answer options preview" className="mt-2 space-y-1">
                {optionPreview.map((option, index) => {
                  const number = index + 1
                  const isSelected = selectedOptionNumbers.includes(number)
                  return (
                    <li key={`option-preview-${number}`} className={`rounded-md px-2 py-1 font-normal ${isSelected ? 'bg-indigo-100 font-semibold text-indigo-950 ring-1 ring-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-100 dark:ring-indigo-700' : 'text-slate-600 dark:text-slate-400'}`}>
                      {number}. {option}
                    </li>
                  )
                })}
              </ol>
            </label>
            <label htmlFor="skill-question-explanation" className="block space-y-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
              Explanation
              <Textarea
                required
                rows={3}
                value={draft.explanation}
                id="skill-question-explanation"
                error={validationErrors.explanation}
                className={SKILL_FORM_FIELD_CLASS}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, explanation: event.target.value }))
                  clearFieldError('explanation')
                }}
              />
            </label>
            <label htmlFor="skill-question-source" className="block space-y-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
              Source
              <input
                required
                value={draft.source}
                id="skill-question-source"
                aria-invalid={Boolean(validationErrors.source)}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, source: event.target.value }))
                  clearFieldError('source')
                }}
                className={fieldClassName('source')}
              />
              {validationErrors.source && <span className="mt-1 block text-[11px] font-medium text-rose-600">{validationErrors.source}</span>}
            </label>
          </div>
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <Button type="submit" variant="primary" size="sm" isLoading={saving}>{editingId == null ? 'Create question' : 'Save question'}</Button>
            {editingId != null && <Button type="button" variant="outline" size="sm" onClick={resetDraft}>Cancel edit</Button>}
          </div>
        </form>
      </Card>

      <section aria-label="Question bank" className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Question bank{selectedTopic && !sectionLoading.questions && !sectionErrors.questions ? ` (${visibleQuestions.length})` : ''}
          </h2>
          <span className="text-sm text-slate-500 dark:text-slate-400">Topic: {selectedTopic || '—'}</span>
        </div>
        {sectionLoading.questions && selectedTopic ? <TableSkeleton rows={5} /> : sectionErrors.questions ? (
          <p className="rounded-lg border border-dashed border-rose-200 p-4 text-sm text-rose-700 dark:border-rose-900 dark:text-rose-300">Question bank is unavailable until it can be loaded.</p>
        ) : !selectedTopic ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">Select a topic to view its question bank.</p>
        ) : visibleQuestions.length === 0 ? (
          <EmptyState icon={Award} title="No questions found" description={`Add a question to ${selectedTopic || 'this'} topic.`} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-300"><tr><th className="p-3">Topic / prompt</th><th className="p-3">Options</th><th className="p-3">Type / difficulty</th><th className="p-3">State</th><th className="p-3 text-right">Actions</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleQuestions.map((question) => (
                  <tr key={question.id}>
                    <td className="max-w-lg p-3"><span className="font-semibold text-indigo-700 dark:text-indigo-300">{question.topic}</span><p className="mt-1 text-slate-800 dark:text-slate-200">{question.prompt}</p></td>
                    <td className="p-3 text-slate-600 dark:text-slate-300">{question.options.length} options · Correct:{' '}{(question.question_type === 'MULTI' ? question.correct_answers ?? [question.correct_index] : [question.correct_index]).map((index) => index + 1).join(', ')}</td>
                    <td className="p-3 text-slate-600 dark:text-slate-300">{question.question_type} · {question.difficulty}</td>
                    <td className="p-3"><Badge variant={question.active ? 'emerald' : 'slate'}>{question.active ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="p-3"><div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => beginEdit(question)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => void deleteQuestion(question)} aria-label={`Delete question ${question.id}`}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Card className="space-y-4 p-4 dark:bg-slate-900">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Study resources</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Curated links shown for weak assessment subtopics.</p>
        </div>
        <form noValidate onSubmit={(event) => void saveResource(event)} className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <DropdownSelect
              label="Topic ID"
              value={resourceDraft.topic}
              disabled={editingResourceId != null}
              options={[
                { label: 'Select a topic', value: '' },
                ...Array.from(new Set([...topicOptions, ...questions.map((item) => item.topic), ...(editingResourceId == null ? [] : [resourceDraft.topic])])).sort().map((topic) => ({ label: topic, value: topic })),
              ]}
              onChange={(topic) => {
                setResourceDraft((current) => ({ ...current, topic }))
                clearResourceFieldError('topic')
              }}
            />
            {resourceValidationErrors.topic && <span className="mt-1 block text-[11px] font-medium text-rose-600">{resourceValidationErrors.topic}</span>}
          </div>
          <label htmlFor="skill-resource-subtopic" className="block space-y-1.5 text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Subtopic ID
            <input
              id="skill-resource-subtopic"
              required
              disabled={editingResourceId != null}
              value={resourceDraft.subtopic}
              aria-invalid={Boolean(resourceValidationErrors.subtopic)}
              onChange={(event) => {
                setResourceDraft((current) => ({ ...current, subtopic: event.target.value }))
                clearResourceFieldError('subtopic')
              }}
              placeholder="general"
              aria-describedby="skill-resource-subtopic-hint"
              className={resourceFieldClassName('subtopic')}
            />
            <span id="skill-resource-subtopic-hint" className="block text-[11px] font-normal normal-case tracking-normal text-slate-500 dark:text-slate-400">Use "general" when the resource covers the whole topic.</span>
            {resourceValidationErrors.subtopic && <span className="text-[11px] font-medium text-rose-600">{resourceValidationErrors.subtopic}</span>}
          </label>
          <label htmlFor="skill-resource-title" className="block space-y-1.5 text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Title
            <input
              id="skill-resource-title"
              required
              value={resourceDraft.title}
              aria-invalid={Boolean(resourceValidationErrors.title)}
              onChange={(event) => {
                setResourceDraft((current) => ({ ...current, title: event.target.value }))
                clearResourceFieldError('title')
              }}
              placeholder="e.g. PyTorch tutorials"
              className={resourceFieldClassName('title')}
            />
            {resourceValidationErrors.title && <span className="text-[11px] font-medium text-rose-600">{resourceValidationErrors.title}</span>}
          </label>
          <label htmlFor="skill-resource-url" className="block space-y-1.5 text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            URL
            <input
              id="skill-resource-url"
              required
              type="text"
              value={resourceDraft.url}
              aria-invalid={Boolean(resourceValidationErrors.url)}
              onChange={(event) => {
                setResourceDraft((current) => ({ ...current, url: event.target.value }))
                clearResourceFieldError('url')
              }}
              placeholder="https://..."
              className={resourceFieldClassName('url')}
            />
            {resourceValidationErrors.url && <span className="text-[11px] font-medium text-rose-600">{resourceValidationErrors.url}</span>}
          </label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit" variant="primary" size="sm" isLoading={saving}>{editingResourceId == null ? 'Add resource' : 'Save resource'}</Button>
            {editingResourceId != null && <Button type="button" variant="outline" size="sm" onClick={resetResourceDraft}>Cancel edit</Button>}
          </div>
        </form>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          {!sectionLoading.resources && !sectionErrors.resources && selectedTopic
            && (visibleResources.length > 0 || resources.length === 0) && (
              <p className="text-xs text-slate-500 dark:text-slate-400">{visibleResources.length} resource{visibleResources.length === 1 ? '' : 's'} shown</p>
            )}
          <DropdownSelect
            className="w-full sm:max-w-xs"
            label="Filter resources by subtopic"
            value={resourceSubtopicFilter}
            onChange={setResourceSubtopicFilter}
            options={[
              { label: 'All subtopics', value: 'ALL' },
              ...resourceSubtopics.map((subtopic) => ({ label: subtopic, value: subtopic })),
            ]}
          />
        </div>
        {sectionLoading.resources && selectedTopic ? (
          <div aria-label="Loading study resources" className="h-20 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        ) : sectionErrors.resources ? (
          <p className="rounded-lg border border-dashed border-rose-200 p-4 text-sm text-rose-700 dark:border-rose-900 dark:text-rose-300">Study resources are unavailable until they can be loaded.</p>
        ) : !selectedTopic ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">Select a topic to view its study resources.</p>
        ) : (
          <>
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {visibleResources.map((resource) => (
                <li key={resource.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-white">{resource.title}</p>
                    <p className="break-all text-xs text-slate-500 dark:text-slate-400">{resource.topic} / {resource.subtopic} · {resource.url}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="outline" onClick={() => {
                      setEditingResourceId(resource.id)
                      setResourceDraft({ topic: resource.topic, subtopic: resource.subtopic, title: resource.title, url: resource.url })
                    }}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => void deleteResource(resource)} aria-label={`Delete learning resource ${resource.id}`}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
                  </div>
                </li>
              ))}
            </ul>
            {visibleResources.length === 0 && (
              <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-slate-700">
                {resources.length === 0 ? 'No study resources for this topic.' : 'No resources match this subtopic filter.'}
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
