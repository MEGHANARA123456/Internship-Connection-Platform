import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { TableSkeleton, CardSkeleton } from '../components/ui/LoadingSkeleton'
import { ErrorState } from '../components/ui/ErrorState'
import { Modal } from '../components/ui/Modal'
import { Textarea } from '../components/ui/Textarea'
import {
  Users,
  TrendingUp,
  ShieldCheck,
  Briefcase,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Search,
  ExternalLink,
  Ban,
  RotateCcw,
  RefreshCw,
  Building2,
  X,
  ClipboardList,
  BarChart2,
  ChevronDown,
  ChevronUp,
  Activity,
} from 'lucide-react'
import { DesktopAnalysisVisuals } from '../components/analytics/DesktopAnalysisVisuals'
import { WelcomeGreeting } from '../components/dashboard/WelcomeGreeting'
import { useAuthStore } from '../store/auth'
import { AccountSecurityCard } from '../components/auth/AccountSecurityCard'

// --- 1. Admin Console Dashboard ---

export function AdminDashboardPage() {
  const { session } = useAuthStore()
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
  const [apiOnline, setApiOnline] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [analysisRefreshKey, setAnalysisRefreshKey] = useState(0)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchDashboardData = async () => {
    try {
      // Check health
      try {
        const healthRes = await api.get('/health')
        setApiOnline(healthRes.data?.status === 'ok')
      } catch {
        setApiOnline(false)
      }

      const [usersRes, compRes, jobsRes, repRes] = await Promise.all([
        api.get('/admin/users'),
        api.get('/admin/companies/unverified'),
        api.get('/admin/internships'),
        api.get('/admin/reports'),
      ])

      const users = usersRes.data || []
      const unverified = compRes.data || []
      const jobs = jobsRes.data || []
      const reports = repRes.data || []

      const pending = jobs.filter((j: any) => j.status === 'PENDING_APPROVAL')
      const openReps = reports.filter((r: any) => r.status === 'OPEN')

      setStats({
        usersCount: users.length,
        studentsCount: users.filter((u: any) => u.role === 'STUDENT').length,
        companiesCount: users.filter((u: any) => u.role === 'COMPANY').length,
        adminsCount: users.filter((u: any) => u.role === 'ADMIN').length,
        unverifiedCompanies: unverified.length,
        pendingJobs: pending.length,
        openReports: openReps.length,
      })

      setPendingCompanies(unverified.slice(0, 4))
      setPendingJobsList(pending.slice(0, 4))
      setOpenReportsList(openReps.slice(0, 4))
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
      alert('Verification status update failed')
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
      alert('Job moderation status update failed')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-8">
      <WelcomeGreeting
        role="ADMIN"
        customSubtitle="Platform operations dashboard. Oversee company verification, listing moderation, and ecosystem security."
      />

      {/* Header & Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Platform Admin Console</h1>
            <Badge status="ADMIN" className="text-[11px] font-semibold">
              Super Admin
            </Badge>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-time ecosystem oversight, compliance enforcement, moderation, and user management.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-xs">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                apiOnline === true
                  ? 'bg-emerald-500 animate-pulse'
                  : apiOnline === false
                  ? 'bg-rose-500'
                  : 'bg-amber-400'
              }`}
            />
            <span className="font-medium text-slate-700">
              API Backend: {apiOnline === true ? 'Online (Port 8010)' : apiOnline === false ? 'Offline' : 'Connecting...'}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRefresh}
            isLoading={refreshing}
            leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link to="/admin/users">
          <Card className="p-5 bg-white hover:border-purple-300 transition-all group">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Total Users
              </span>
              <Users className="w-4 h-4 text-purple-600 group-hover:scale-110 transition-transform" />
            </div>
            <p className="text-2xl font-black text-slate-900 mt-2">
              {loading ? '...' : stats.usersCount}
            </p>
            <div className="flex items-center gap-2 mt-2 text-[11px] text-slate-500 font-medium">
              <span className="text-emerald-700">{stats.studentsCount} Students</span>
              <span>•</span>
              <span className="text-indigo-700">{stats.companiesCount} Companies</span>
              <span>•</span>
              <span className="text-purple-700">{stats.adminsCount} Admins</span>
            </div>
          </Card>
        </Link>

        <Link to="/admin/verifications">
          <Card className="p-5 bg-white hover:border-amber-300 transition-all group">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Company Verifications
              </span>
              <ShieldCheck className="w-4 h-4 text-amber-600 group-hover:scale-110 transition-transform" />
            </div>
            <p className="text-2xl font-black text-slate-900 mt-2">
              {loading ? '...' : stats.unverifiedCompanies}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">Pending vetting review</p>
          </Card>
        </Link>

        <Link to="/admin/moderation">
          <Card className="p-5 bg-white hover:border-indigo-300 transition-all group">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Job Moderation Queue
              </span>
              <Briefcase className="w-4 h-4 text-indigo-600 group-hover:scale-110 transition-transform" />
            </div>
            <p className="text-2xl font-black text-slate-900 mt-2">
              {loading ? '...' : stats.pendingJobs}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">Pending approval before publishing</p>
          </Card>
        </Link>

        <Link to="/admin/reports">
          <Card className="p-5 bg-white hover:border-rose-300 transition-all group">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Open Disputes & Reports
              </span>
              <AlertTriangle className="w-4 h-4 text-rose-600 group-hover:scale-110 transition-transform" />
            </div>
            <p className="text-2xl font-black text-slate-900 mt-2">
              {loading ? '...' : stats.openReports}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">Student & recruiter reports</p>
          </Card>
        </Link>
      </div>

      {/* Desktop Ecosystem Analysis Visuals */}
      <div className="hidden md:block">
        <DesktopAnalysisVisuals
          variant="admin"
          refreshKey={analysisRefreshKey}
          title="Platform Ecosystem & Placement Analytics"
          subtitle="Real-time tracking of candidate pipeline throughput, monthly placement velocity, and role demands"
        />
      </div>

      <AdminAnalyticsCharts refreshKey={analysisRefreshKey} />

      {/* Live Action Queues Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Company Verifications Queue */}
        <Card className="p-6 bg-white space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-600" />
              <h2 className="text-sm font-bold text-slate-900">Companies Awaiting Vetting</h2>
            </div>
            <Link to="/admin/verifications" className="text-xs text-purple-600 hover:text-purple-700 font-semibold">
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
                      disabled={actionLoading === `comp-${c.user_id}`}
                      onClick={() => handleQuickVerify(c.user_id, 'VERIFIED')}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[11px] py-1 px-2.5 text-rose-600 hover:bg-rose-50 h-7"
                      disabled={actionLoading === `comp-${c.user_id}`}
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
            <Link to="/admin/moderation" className="text-xs text-purple-600 hover:text-purple-700 font-semibold">
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
                      disabled={actionLoading === `job-${j.id}`}
                      onClick={() => handleQuickModerate(j.id, 'PUBLISHED')}
                    >
                      Publish
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[11px] py-1 px-2.5 text-rose-600 hover:bg-rose-50 h-7"
                      disabled={actionLoading === `job-${j.id}`}
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
            <Link to="/admin/reports" className="text-xs text-purple-600 hover:text-purple-700 font-semibold">
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
                  <Link to="/admin/reports">
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

      {/* Quick Credentials & Workflow Guide for Developers/Admins */}
      <div className="p-6 rounded-2xl bg-purple-50/70 border border-purple-200 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-700" />
            <h3 className="text-sm font-bold text-purple-950">
              Platform Admin Credentials & Ecosystem Guide
            </h3>
          </div>
          <span className="text-[11px] font-mono bg-purple-200 text-purple-900 px-2 py-0.5 rounded-md font-semibold">
            Admin Signup Key: change-admin-signup-key
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-700">
          <div className="p-3 bg-white rounded-xl border border-purple-100 shadow-2xs space-y-1">
            <span className="font-bold text-purple-900 block">Admin Registration</span>
            <p className="text-slate-600 text-[11px]">
              Register via <code className="bg-slate-100 px-1 py-0.5 rounded">/register-admin</code> with the secret key{' '}
              <code className="bg-purple-100 text-purple-800 px-1 py-0.5 rounded font-mono">change-admin-signup-key</code>.
            </p>
          </div>

          <div className="p-3 bg-white rounded-xl border border-purple-100 shadow-2xs space-y-1">
            <span className="font-bold text-indigo-900 block">Company Verification</span>
            <p className="text-slate-600 text-[11px]">
              Companies register at <code className="bg-slate-100 px-1 py-0.5 rounded">/register-company</code>. They cannot post jobs until vetted in the Verifications tab.
            </p>
          </div>

          <div className="p-3 bg-white rounded-xl border border-purple-100 shadow-2xs space-y-1">
            <span className="font-bold text-emerald-900 block">Mailpit Local Inbox</span>
            <p className="text-slate-600 text-[11px]">
              Email tokens deliver instantly to{' '}
              <a href="http://localhost:8025" target="_blank" rel="noreferrer" className="text-indigo-600 underline font-semibold">
                http://localhost:8025
              </a>.
            </p>
          </div>
        </div>
      </div>

      {/* Admin Account Security & Two-Factor Authentication */}
      <div className="pt-2">
        <AccountSecurityCard userEmail={session?.email} role="Admin" />
      </div>
    </div>
  )
}

function AdminAnalyticsCharts({ refreshKey }: { refreshKey: number }) {
  const [growth, setGrowth] = useState<any[]>([])
  const [actions, setActions] = useState<any[]>([])

  useEffect(() => {
    Promise.all([
      api.get('/analytics/admin/user-growth?granularity=month&periods=6'),
      api.get('/analytics/admin/admin-action-volume?days=14'),
    ]).then(([growthRes, actionsRes]) => {
      setGrowth(growthRes.data || [])
      setActions(actionsRes.data || [])
    }).catch(() => {
      setGrowth([])
      setActions([])
    })
  }, [refreshKey])

  const maxGrowth = Math.max(...growth.map((item) => item.students + item.companies), 1)
  const maxAction = Math.max(...actions.map((item) => item.count), 1)
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card className="bg-white p-6">
        <div className="mb-5 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-indigo-600" /><h2 className="text-sm font-bold text-slate-900">User growth</h2></div>
        {growth.length === 0 ? <p className="text-xs text-slate-500">No signup data for this period.</p> : <div className="space-y-3">{growth.map((item) => <div key={item.period} className="flex items-center gap-3 text-xs"><span className="w-16 text-slate-500">{item.period}</span><div className="h-6 flex-1 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-indigo-500" style={{ width: `${Math.max(3, ((item.students + item.companies) / maxGrowth) * 100)}%` }} /></div><span className="w-12 text-right font-semibold text-slate-700">{item.students + item.companies}</span></div>)}</div>}
      </Card>
      <Card className="bg-white p-6">
        <div className="mb-5 flex items-center gap-2"><BarChart2 className="h-4 w-4 text-amber-600" /><h2 className="text-sm font-bold text-slate-900">Admin action volume</h2></div>
        {actions.length === 0 ? <p className="text-xs text-slate-500">No admin actions for this period.</p> : <div className="space-y-3">{actions.slice(-8).map((item, index) => <div key={`${item.period}-${item.action}-${index}`} className="flex items-center gap-3 text-xs"><span className="w-28 truncate text-slate-500">{item.action}</span><div className="h-6 flex-1 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-amber-500" style={{ width: `${Math.max(5, (item.count / maxAction) * 100)}%` }} /></div><span className="w-8 text-right font-semibold text-slate-700">{item.count}</span></div>)}</div>}
      </Card>
    </div>
  )
}

// --- 2. User Management ---

export function AdminUsersPage() {
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [actionId, setActionId] = useState<number | null>(null)
  const [selectedUser, setSelectedUser] = useState<any | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const fetchUsers = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/admin/users')
      setUsers(res.data || [])
    } catch {
      setError('Failed to fetch platform users.')
    } finally {
      setLoading(false)
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
      alert('Failed to update user status.')
    } finally {
      setActionId(null)
    }
  }

  const openUserDetail = async (userId: number) => {
    setDetailLoading(true)
    try {
      const res = await api.get(`/admin/users/${userId}`)
      setSelectedUser(res.data)
    } catch {
      alert('Failed to load user details.')
    } finally {
      setDetailLoading(false)
    }
  }

  const filtered = users.filter((u) => {
    const matchesSearch = u.email.toLowerCase().includes(search.toLowerCase())
    const matchesRole = roleFilter ? u.role === roleFilter : true
    return matchesSearch && matchesRole
  })

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Platform Users</h1>
          <p className="text-xs text-slate-500 mt-1">Audit user accounts and manage active status.</p>
        </div>
        <Link to="/admin">
          <Button variant="outline" size="sm">
            Console
          </Button>
        </Link>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search users by email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
        >
          <option value="">All Roles</option>
          <option value="STUDENT">Student</option>
          <option value="COMPANY">Company</option>
          <option value="ADMIN">Admin</option>
        </select>
      </div>

      {loading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchUsers} />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching users found" description="Adjust your filters to see more results." />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="p-3.5">ID</th>
                  <th className="p-3.5">Email</th>
                  <th className="p-3.5">Role</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5">Email Verified</th>
                  <th className="p-3.5">2FA / MFA</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/50 cursor-pointer" onClick={() => openUserDetail(u.id)}>
                    <td className="p-3.5 font-medium text-slate-900">#{u.id}</td>
                    <td className="p-3.5 font-semibold text-slate-800">{u.email}</td>
                    <td className="p-3.5">
                      <Badge status={u.role}>{u.role}</Badge>
                    </td>
                    <td className="p-3.5">
                      <Badge status={u.is_active ? 'ACTIVE' : 'SUSPENDED'}>
                        {u.is_active ? 'Active' : 'Suspended'}
                      </Badge>
                    </td>
                    <td className="p-3.5">
                      {u.is_verified ? (
                        <span className="text-emerald-600 font-medium">Verified</span>
                      ) : (
                        <span className="text-slate-400">Pending</span>
                      )}
                    </td>
                    <td className="p-3.5">
                      <Badge variant={u.mfa_enabled ? 'emerald' : 'slate'}>
                        {u.mfa_enabled ? 'Active' : 'Disabled'}
                      </Badge>
                    </td>
                    <td className="p-3.5 text-right" onClick={(event) => event.stopPropagation()}>
                      {u.role !== 'ADMIN' && (
                        <Button
                          size="sm"
                          variant="outline"
                          isLoading={actionId === u.id}
                          onClick={() => handleToggleSuspend(u)}
                          className={u.is_active ? 'text-rose-600 hover:bg-rose-50' : 'text-emerald-600 hover:bg-emerald-50'}
                          leftIcon={u.is_active ? <Ban className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        >
                          {u.is_active ? 'Suspend' : 'Reactivate'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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

  const fetchCompanies = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/admin/companies/unverified')
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

  const handleVerify = async (userId: number, status: 'VERIFIED' | 'REJECTED') => {
    setActionId(userId)
    try {
      await api.post(`/admin/companies/${userId}/verification`, { status })
      fetchCompanies()
    } catch {
      alert('Failed to update company verification status.')
    } finally {
      setActionId(null)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Company Verifications</h1>
          <p className="text-xs text-slate-500 mt-1">Review newly registered employers before granting posting rights.</p>
        </div>
        <Link to="/admin">
          <Button variant="outline" size="sm">
            Console
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
          {companies.map((comp) => (
            <Card key={comp.user_id} className="p-5 bg-white">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-bold text-slate-900">{comp.company_name}</h3>
                    <Badge status="PENDING">Pending Review</Badge>
                  </div>
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
                    <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-md border border-slate-100 mt-2">
                      {comp.description}
                    </p>
                  )}
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
                    onClick={() => handleVerify(comp.user_id, 'REJECTED')}
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
      alert('Failed to update internship status.')
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
        <Link to="/admin">
          <Button variant="outline" size="sm">
            Console
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
                    {job.description}
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
      alert('Failed to update report status.')
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
      alert('Failed to resolve report.')
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
        <Link to="/admin">
          <Button variant="outline" size="sm">
            Console
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
    await api.post(`/admin/companies/${userId}/verification`, { status })
    fetchCompanies()
  }

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-slate-900">Company Directory</h1><p className="mt-1 text-xs text-slate-500">Review verification status and posting activity.</p></div><Link to="/admin"><Button variant="outline" size="sm">Console</Button></Link></div>
      {loading ? <TableSkeleton /> : companies.length === 0 ? <EmptyState title="No companies found" description="Registered companies will appear here." /> : <div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><table className="w-full text-left text-xs"><thead className="border-b border-slate-200 bg-slate-50 text-slate-500"><tr><th className="p-3">Company</th><th className="p-3">Industry</th><th className="p-3">Verification</th><th className="p-3">Postings</th><th className="p-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{companies.map((company) => <tr key={company.id}><td className="p-3 font-semibold text-slate-800"><Link className="hover:text-indigo-600" to={`/admin/companies/${company.user_id}/postings`}>{company.company_name}</Link></td><td className="p-3 text-slate-600">{company.industry}</td><td className="p-3"><Badge status={company.verification_status}>{company.verification_status}</Badge></td><td className="p-3 text-slate-600">{company.posting_count}</td><td className="p-3 text-right"><div className="flex justify-end gap-2">{company.verification_status !== 'VERIFIED' && <Button size="sm" variant="primary" onClick={() => verify(company.user_id, 'VERIFIED')} leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}>Verify</Button>}{company.verification_status !== 'REJECTED' && <Button size="sm" variant="outline" className="text-rose-600" onClick={() => verify(company.user_id, 'REJECTED')} leftIcon={<XCircle className="h-3.5 w-3.5" />}>Reject</Button>}</div></td></tr>)}</tbody></table></div>}
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
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-slate-900">Company Postings</h1><p className="mt-1 text-xs text-slate-500">Inspect applicant volume and moderate listings.</p></div><Link to="/admin/companies"><Button variant="outline" size="sm">Back to companies</Button></Link></div>
      {loading ? <TableSkeleton /> : postings.length === 0 ? <EmptyState title="No postings found" description="This company has no internship postings." /> : <div className="space-y-3">{postings.map((posting) => <Card key={posting.id} className="flex flex-col gap-3 bg-white p-5 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><h2 className="font-bold text-slate-900">{posting.title}</h2><Badge status={posting.status}>{posting.status}</Badge></div><p className="mt-1 text-xs text-slate-500">{posting.applicant_count} applicants · Created {new Date(posting.created_at).toLocaleDateString()}</p></div><div className="flex gap-2">{posting.status !== 'PUBLISHED' && <Button size="sm" variant="primary" onClick={() => moderate(posting.id, 'PUBLISHED')}>Approve</Button>}{posting.status !== 'REJECTED' && <Button size="sm" variant="outline" className="text-rose-600" onClick={() => moderate(posting.id, 'REJECTED')}>Reject</Button>}{posting.status !== 'CLOSED' && <Button size="sm" variant="outline" onClick={() => moderate(posting.id, 'CLOSED')}>Remove</Button>}</div></Card>)}</div>}
    </div>
  )
}

// --- 8. Audit Log Explorer ---

export function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  const [targetType, setTargetType] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const pageSize = 25

  const fetchLogs = async () => {
    const params = { page, page_size: pageSize, actor: actor || undefined, action: action || undefined, target_type: targetType || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined }
    const res = await api.get('/admin/audit-logs', { params })
    setLogs(res.data.items || [])
    setTotal(res.data.total || 0)
  }
  useEffect(() => { fetchLogs() }, [page, actor, action, targetType, dateFrom, dateTo])

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-slate-900">Audit Logs</h1><p className="mt-1 text-xs text-slate-500">Search administrative actions and inspect their metadata.</p></div><Link to="/admin"><Button variant="outline" size="sm">Console</Button></Link></div>
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:flex-wrap"><input value={actor} onChange={(event) => { setPage(1); setActor(event.target.value) }} placeholder="Actor email" className="rounded-lg border border-slate-300 px-3 py-2 text-xs" /><select value={action} onChange={(event) => { setPage(1); setAction(event.target.value) }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs"><option value="">All actions</option><option value="user_suspended">User suspended</option><option value="user_reinstated">User reinstated</option><option value="company_verified">Company verified</option><option value="company_rejected">Company rejected</option><option value="posting_approved">Posting approved</option><option value="posting_rejected">Posting rejected</option><option value="posting_removed">Posting removed</option><option value="report_resolved">Report resolved</option></select><select value={targetType} onChange={(event) => { setPage(1); setTargetType(event.target.value) }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs"><option value="">All targets</option><option value="user">User</option><option value="company">Company</option><option value="posting">Posting</option></select><label className="flex items-center gap-2 text-xs text-slate-500">From<input type="date" value={dateFrom} onChange={(event) => { setPage(1); setDateFrom(event.target.value) }} className="rounded-lg border border-slate-300 px-2 py-2 text-xs text-slate-700" /></label><label className="flex items-center gap-2 text-xs text-slate-500">To<input type="date" value={dateTo} onChange={(event) => { setPage(1); setDateTo(event.target.value) }} className="rounded-lg border border-slate-300 px-2 py-2 text-xs text-slate-700" /></label></div>
      {logs.length === 0 ? <EmptyState icon={ClipboardList} title="No audit events" description="No actions match the current filters." /> : <div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><table className="w-full text-left text-xs"><thead className="border-b border-slate-200 bg-slate-50 text-slate-500"><tr><th className="p-3">Actor</th><th className="p-3">Action</th><th className="p-3">Target</th><th className="p-3">Timestamp</th><th className="p-3" /></tr></thead><tbody className="divide-y divide-slate-100">{logs.map((log) => <tr key={log.id}><td className="p-3 text-slate-700">{log.actor_email || 'System'}</td><td className="p-3"><Badge status="ADMIN">{log.action}</Badge></td><td className="p-3 text-slate-600">{log.target_type || '—'} #{log.target_id || '—'}</td><td className="p-3 text-slate-500">{new Date(log.created_at).toLocaleString()}</td><td className="p-3 text-right"><Button size="sm" variant="outline" onClick={() => setExpanded(expanded === log.id ? null : log.id)} leftIcon={expanded === log.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}>Metadata</Button>{expanded === log.id && <pre className="mt-2 max-w-xs overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-2 text-left text-[10px] text-emerald-300">{JSON.stringify(log.metadata || {}, null, 2)}</pre>}</td></tr>)}</tbody></table></div>}
      <div className="flex items-center justify-between text-xs text-slate-500"><span>{total} total events</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><span className="px-2 py-2">Page {page}</span><Button size="sm" variant="outline" disabled={page * pageSize >= total} onClick={() => setPage((current) => current + 1)}>Next</Button></div></div>
    </div>
  )
}