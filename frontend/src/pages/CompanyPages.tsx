import { useState, useEffect } from 'react'
import { Link, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api, downloadAuthenticatedFile } from '../api/client'
import { Input } from '../components/ui/Input'
import { DropdownSelect } from '../components/ui/DropdownSelect'
import { Textarea } from '../components/ui/Textarea'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { CardSkeleton, TableSkeleton } from '../components/ui/LoadingSkeleton'
import { ErrorState } from '../components/ui/ErrorState'
import { CardActionButton, CardActions } from '../components/ui/CardActions'
import { CandidateActions } from '../components/company/CandidateActions'
import { ScheduleInterviewModal } from '../components/modals/ScheduleInterviewModal'
import { Modal } from '../components/ui/Modal'
import { useAuthStore } from '../store/auth'
import { WelcomeGreeting } from '../components/dashboard/WelcomeGreeting'
import { KpiCard } from '../components/dashboard/KpiCard'
import { routes } from '../lib/routes'
import { confirmAction, showToast } from '../lib/feedback'
import { AvatarUploadCard } from '../components/ui/AvatarUploadCard'
import {
  Plus,
  Briefcase,
  Users,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Send,
  Kanban,
  LayoutList,
  CheckSquare,
  FileSpreadsheet,
  UserCheck,
  XCircle,
  GripVertical,
  FileText,
  UploadCloud,
  LayoutDashboard,
  Settings,
  Menu,
  X,
  BarChart3,
  Search,
  ArrowUpDown,
  ChevronDown,
} from 'lucide-react'
import { DesktopAnalysisVisuals } from '../components/analytics/DesktopAnalysisVisuals'
import { AccountSecurityCard } from '../components/security/AccountSecurityCard'
import { StatusFilterMenu } from '../components/applications/StatusFilterMenu'
import { CompanyApplicantsRedesign } from './CompanyApplicantsRedesign'

// --- 1. Company Jobs Management ---

const companyPortalLinks = [
  { label: 'Overview', to: routes.company, icon: LayoutDashboard },
  { label: 'Company Profile', to: routes.companyProfile, icon: UserCheck },
  { label: 'My Internships', to: routes.companyJobs(), icon: Briefcase },
  { label: 'Post Internship', to: routes.newCompanyInternship, icon: Plus },
  { label: 'Applicants', to: routes.companyApplicants(), icon: Users, count: 'new_applicants' },
  { label: 'Hiring Pipeline', to: routes.companyPipeline, icon: Kanban },
  { label: 'Interviews', to: routes.interviews({ tab: 'upcoming' }), icon: Calendar, count: 'upcoming_interviews' },
  { label: 'Shortlisted', to: routes.companyShortlisted, icon: UserCheck },
  { label: 'Notifications', to: routes.notifications, icon: AlertCircle, count: 'unread_notifications' },
  { label: 'Analytics', to: routes.companyAnalytics, icon: BarChart3 },
  { label: 'Settings', to: routes.companySettings, icon: Settings },
]

export function CompanyPortalShell() {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [counts, setCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    let active = true
    api.get('/navigation/counts')
      .then(({ data }) => { if (active) setCounts(data ?? {}) })
      .catch((error: unknown) => console.error('Unable to load company navigation counts.', error))
    return () => { active = false }
  }, [])

  const navItems = (compact = false) => companyPortalLinks.map(({ label, to, icon: Icon, count }) => {
    const selected = location.pathname === to || (to !== '/company' && location.pathname.startsWith(`${to}/`))
    return (
      <Link
        key={to}
        to={to}
        onClick={() => setDrawerOpen(false)}
        title={compact ? label : undefined}
        aria-current={selected ? 'page' : undefined}
        className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
          selected
            ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300'
            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!compact && <span className="min-w-0 flex-1 truncate">{label}</span>}
        {count && counts[count] > 0 && (
          <span className="ml-auto rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold tabular-nums text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
            {counts[count]}
          </span>
        )}
      </Link>
    )
  })

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 items-start gap-4 px-3 py-4 sm:px-5 lg:gap-6 lg:px-6">
      <aside className={`sticky top-20 hidden max-h-[calc(100dvh-6rem)] shrink-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:block ${collapsed ? 'w-[4.5rem]' : 'w-60'}`}>
        <div className={`mb-2 flex items-center ${collapsed ? 'justify-center' : 'justify-between px-2'}`}>
          {!collapsed && <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Company portal</span>}
          <button type="button" aria-label={collapsed ? 'Expand company navigation' : 'Collapse company navigation'} onClick={() => setCollapsed((value) => !value)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-slate-800">
            <Menu className="h-4 w-4" />
          </button>
        </div>
        <nav aria-label="Company portal navigation" className="space-y-1">{navItems(collapsed)}</nav>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex items-center justify-between lg:hidden">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Company portal</span>
          <button type="button" aria-label="Open company navigation" onClick={() => setDrawerOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold dark:border-slate-700 dark:bg-slate-900">
            <Menu className="h-4 w-4" /> Menu
          </button>
        </div>
        <Outlet />
      </div>
      {drawerOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 lg:hidden" onMouseDown={(event) => { if (event.target === event.currentTarget) setDrawerOpen(false) }}>
          <aside aria-label="Company portal navigation" className="h-full w-[min(20rem,88vw)] overflow-y-auto bg-white p-4 shadow-xl dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-bold text-slate-900 dark:text-white">Company portal</span>
              <button type="button" aria-label="Close company navigation" onClick={() => setDrawerOpen(false)} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
            </div>
            <nav className="space-y-1">{navItems()}</nav>
          </aside>
        </div>
      )}
    </div>
  )
}

interface CompanyOverviewData {
  kpis: Record<string, number>
  pending_actions: {
    applications_waiting_over_three_days: number
    interviews_today: number
    drafts_not_submitted: number
    missing_verification_documents: string[]
  }
  recent_applications: Array<{
    id: number
    student_id: number
    student_name: string
    student_university: string | null
    internship_id: number
    internship_title: string
    status: string
    created_at: string
  }>
  company_name: string | null
  period_label: string
}

export function CompanyOverviewPage() {
  const [data, setData] = useState<CompanyOverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      const response = await api.get('/company/overview')
      setData(response.data as CompanyOverviewData)
    } catch (requestError) {
      console.error('Unable to load company overview.', requestError)
      setError(true)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  const cards = [
    ['Active internships', 'active_internships', routes.companyJobs({ status: 'PUBLISHED' }), <Briefcase className="h-4 w-4" />],
    ['Total internships', 'total_internships', routes.companyJobs(), <FileText className="h-4 w-4" />],
    ['Total applicants', 'total_applicants', routes.companyApplicants(), <Users className="h-4 w-4" />],
    ['New applications this week', 'new_applications_this_week', routes.companyApplicants({ created: 'week' }), <Calendar className="h-4 w-4" />],
    ['Shortlisted', 'shortlisted', routes.companyApplicants({ status: 'SHORTLISTED' }), <UserCheck className="h-4 w-4" />],
    ['Interviews scheduled', 'interviews_scheduled', routes.interviews({ tab: 'upcoming' }), <Calendar className="h-4 w-4" />],
  ] as const

  if (loading || error || !data) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map(([label, key, to, icon]) => (
          <KpiCard
            key={key}
            label={label}
            value="0"
            caption={label === 'Interviews scheduled' ? 'None scheduled' : 'Current total'}
            icon={icon}
            href={to}
            loading={loading}
            error={!loading}
            onRetry={() => void load()}
          />
        ))}
      </div>
    )
  }

  const pending = [
    { label: 'Applications waiting over 3 days', value: data.pending_actions.applications_waiting_over_three_days, to: routes.companyApplicants({ status: 'APPLIED' }) },
    { label: 'Interviews today', value: data.pending_actions.interviews_today, to: routes.interviews({ tab: 'upcoming' }) },
    { label: 'Drafts not submitted', value: data.pending_actions.drafts_not_submitted, to: routes.companyJobs({ status: 'DRAFT' }) },
    { label: 'Missing verification documents', value: data.pending_actions.missing_verification_documents.length, to: routes.companyProfile },
  ]
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-1 py-2 sm:px-2">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">Company overview</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Welcome{data.company_name ? `, ${data.company_name}` : ''}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Your hiring activity and next steps.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={routes.newCompanyInternship}><Button leftIcon={<Plus className="h-4 w-4" />}>Post Internship</Button></Link>
          <Link to={routes.companyApplicants()}><Button variant="outline" leftIcon={<Users className="h-4 w-4" />}>View Applicants</Button></Link>
        </div>
      </header>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map(([label, key, to, icon]) => (
          <KpiCard
            key={key}
            label={label}
            value={(data.kpis[key] ?? 0).toLocaleString()}
            caption={key === 'interviews_scheduled' && !data.kpis[key] ? 'None scheduled' : 'Current total'}
            icon={icon}
            href={to}
            info={key === 'interviews_scheduled'
              ? 'Future interviews in SCHEDULED or RESCHEDULED status.'
              : `Current ${label.toLowerCase()} count.`}
          />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="bg-white p-5 dark:bg-slate-900">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Pending actions</h2>
          <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {pending.map((item) => (
              <Link key={item.label} to={item.to} className="flex min-h-12 items-center justify-between gap-3 py-2 text-sm hover:text-indigo-600 dark:hover:text-indigo-300">
                <span>{item.label}</span><Badge variant={item.value ? 'amber' : 'slate'}>{item.value}</Badge>
              </Link>
            ))}
          </div>
          {data.pending_actions.missing_verification_documents.length > 0 && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Missing: {data.pending_actions.missing_verification_documents.join(', ')}</p>}
        </Card>
        <Card className="bg-white p-5 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Recent applications</h2>
            <Link className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400" to={routes.companyApplicants()}>View all</Link>
          </div>
          {data.recent_applications.length === 0 ? <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">Not enough data yet. New applications will appear here.</p> : (
            <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {data.recent_applications.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{item.student_name}</p>
                    <Link to={routes.companyApplicants({ internship: item.internship_id })} className="block truncate text-xs text-slate-500 hover:text-indigo-600 dark:text-slate-400">{item.internship_title}{item.student_university ? ` · ${item.student_university}` : ''}</Link>
                  </div>
                  <Badge status={item.status}>{item.status.replaceAll('_', ' ')}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

export function CompanyAnalyticsPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-1 py-2 sm:px-2">
      <DesktopAnalysisVisuals variant="company" fullAnalyticsMenu title="Company hiring analytics" subtitle="Real applicant and internship data for your company." />
    </div>
  )
}

export function CompanySettingsPage() {
  const session = useAuthStore((state) => state.session)
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-1 py-2 sm:px-2">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Company settings</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Manage account security and company preferences.</p>
      </header>
      <AccountSecurityCard userEmail={session?.email} role="Company" />
      <Card className="bg-white p-5 dark:bg-slate-900">
        <h2 className="font-bold text-slate-900 dark:text-white">Recruiter account and email preferences</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Update company contact information on your profile and manage email preferences in the privacy center.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to={routes.companyProfile}><Button variant="outline">Company profile</Button></Link>
          <Link to={routes.privacySecurity}><Button variant="outline">Privacy &amp; email preferences</Button></Link>
        </div>
      </Card>
    </div>
  )
}

interface CompanyApplicant {
  id: number
  internship_id: number
  internship_title: string | null
  student_id: number
  student_name: string | null
  student_university: string | null
  student_skills: string[]
  status: string
  created_at: string
  resume_id: number | null
  has_resume?: boolean
  resume_filename?: string | null
  resume_size?: number | null
  match_score: number | null
  match_explanation?: string | null
  verified_badges?: Array<{ id: number; topic: string; title: string; level: string; score: number; expires_at: string }>
}

const applicantStages = [
  { key: 'APPLIED', label: 'Applied' },
  { key: 'UNDER_REVIEW', label: 'Under Review' },
  { key: 'SHORTLISTED', label: 'Shortlisted' },
  { key: 'INTERVIEW_SCHEDULED', label: 'Interview' },
  { key: 'SELECTED', label: 'Selected' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'REJECTED', label: 'Rejected' },
]

export function LegacyCompanyApplicantsPage({
  pipeline = false,
  initialStatus,
}: {
  pipeline?: boolean
  initialStatus?: string
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [items, setItems] = useState<CompanyApplicant[]>([])
  const [total, setTotal] = useState(0)
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [processingId, setProcessingId] = useState<number | null>(null)
  const [downloadingResumeId, setDownloadingResumeId] = useState<number | null>(null)
  const [activeInterview, setActiveInterview] = useState<CompanyApplicant | null>(null)
  const [notesApplicant, setNotesApplicant] = useState<CompanyApplicant | null>(null)
  const [applicationNotes, setApplicationNotes] = useState<Array<{ id: number; body: string; created_at: string }>>([])
  const [noteDraft, setNoteDraft] = useState('')
  const [noteError, setNoteError] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [skills, setSkills] = useState(searchParams.get('skills') ?? '')
  const [education, setEducation] = useState(searchParams.get('education') ?? '')
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1)
  const pageSize = 20
  const status = searchParams.get('status') ?? initialStatus ?? 'ALL'
  const queryString = searchParams.toString()

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = Object.fromEntries(searchParams.entries())
      if (!params.status && initialStatus) params.status = initialStatus
      const response = await api.get('/applications/company/search', {
        params: { ...params, page, page_size: pageSize },
      })
      setItems(response.data?.items ?? [])
      setTotal(response.data?.total ?? 0)
      setStatusCounts(response.data?.status_counts ?? {})
    } catch (requestError) {
      console.error('Unable to load company applicants.', requestError)
      setError('Could not load applicants for this company.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [queryString])
  useEffect(() => {
    setSearch(searchParams.get('search') ?? '')
    setSkills(searchParams.get('skills') ?? '')
    setEducation(searchParams.get('education') ?? '')
  }, [queryString])

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value && value !== 'ALL') next.set(key, value)
    else next.delete(key)
    next.delete('page')
    setSearchParams(next)
  }
  const applyFilters = () => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of [['search', search], ['skills', skills], ['education', education]]) {
      if (value.trim()) next.set(key, value.trim())
      else next.delete(key)
    }
    next.delete('page')
    setSearchParams(next)
  }

  const changeStatus = async (item: CompanyApplicant, nextStatus: string) => {
    setProcessingId(item.id)
    try {
      if (nextStatus === 'INTERVIEW_SCHEDULED') {
        setActiveInterview(item)
        return
      }
      const endpoint = nextStatus === 'SHORTLISTED'
        ? `/applications/${item.id}/shortlist`
        : nextStatus === 'REJECTED'
          ? `/applications/${item.id}/reject`
          : nextStatus === 'UNDER_REVIEW'
            ? `/applications/${item.id}/review`
            : `/applications/${item.id}/status`
      if (endpoint.endsWith('/status')) await api.patch(endpoint, { status: nextStatus })
      else await api.patch(endpoint)
      await load()
    } catch (requestError) {
      console.error(`Unable to move applicant ${item.id} to ${nextStatus}.`, requestError)
      showToast('That status change was refused. Refresh the list and try a valid next step.', 'error')
    } finally {
      setProcessingId(null)
    }
  }

  const downloadResume = async (item: CompanyApplicant) => {
    if (!item.has_resume && !item.resume_id) {
      showToast('Resume not uploaded by the student', 'error')
      return
    }
    if (!item.resume_id) {
      showToast('Resume not uploaded by the student', 'error')
      return
    }
    setDownloadingResumeId(item.id)
    try {
      const filename = await downloadAuthenticatedFile(`/profiles/resume/${item.resume_id}/download`, item.resume_filename || `resume_candidate_${item.student_id}.pdf`)
      showToast(`Resume downloaded: ${filename}`, 'success')
    } catch (requestError) {
      console.error(`Unable to download resume for applicant ${item.id}.`, requestError)
      const status = (requestError as any)?.response?.status
      showToast(status === 404
        ? 'Resume not uploaded by the student'
        : status === 403
          ? "You don't have access to this resume"
          : "Couldn't download the resume, please try again", 'error')
    } finally {
      setDownloadingResumeId(null)
    }
  }

  const openNotes = async (item: CompanyApplicant) => {
    setNotesApplicant(item)
    setNoteDraft('')
    setNoteError('')
    try {
      const response = await api.get(`/applications/${item.id}/notes`)
      setApplicationNotes(response.data ?? [])
    } catch {
      setApplicationNotes([])
      setNoteError('Could not load private recruiter notes.')
    }
  }

  const saveNote = async () => {
    if (!notesApplicant || !noteDraft.trim()) return
    setSavingNote(true)
    setNoteError('')
    try {
      const response = await api.post(`/applications/${notesApplicant.id}/notes`, { body: noteDraft.trim() })
      setApplicationNotes((current) => [...current, response.data])
      setNoteDraft('')
    } catch {
      setNoteError('Could not save this private note. Please retry.')
    } finally {
      setSavingNote(false)
    }
  }

  const actions = (item: CompanyApplicant) => (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" isLoading={downloadingResumeId === item.id} title={item.has_resume || item.resume_id ? `Download ${item.resume_filename || 'resume'}` : 'Resume not uploaded by the student'} className={!item.has_resume && !item.resume_id ? 'text-slate-400 dark:text-slate-500' : ''} onClick={() => void downloadResume(item)}>Resume</Button>
      <Button size="sm" variant="outline" disabled={processingId === item.id} onClick={() => void changeStatus(item, 'UNDER_REVIEW')}>Review</Button>
      <Button size="sm" variant="outline" disabled={processingId === item.id} onClick={() => void changeStatus(item, 'SHORTLISTED')}>Shortlist</Button>
      <Button size="sm" variant="outline" onClick={() => void openNotes(item)}>Notes</Button>
      <Button size="sm" variant="outline" disabled={processingId === item.id} onClick={() => setActiveInterview(item)}>Schedule interview</Button>
      <Link to={routes.messages({ contactId: item.student_id })}><Button size="sm" variant="outline">Message</Button></Link>
    </div>
  )
  const applicantCard = (item: CompanyApplicant) => (
    <div key={item.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900 dark:text-white">{item.student_name || 'Candidate'}</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{item.student_university || 'Education not provided'}</p>
          <p className="mt-1 truncate text-xs text-slate-600 dark:text-slate-300">{item.internship_title || 'Internship'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge status={item.status}>{item.status.replaceAll('_', ' ')}</Badge>
          {item.match_score != null && <Badge variant="indigo">{item.match_score}% match</Badge>}
        </div>
      </div>
      {item.student_skills.length > 0 && <p className="mt-2 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">Skills: {item.student_skills.join(', ')}</p>}
      <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Applied {new Date(item.created_at).toLocaleDateString()}</p>
      <div className="mt-3">{actions(item)}</div>
    </div>
  )
  const filteredGroups = applicantStages.map((stage) => ({
    ...stage,
    items: items.filter((item) => item.status === stage.key),
  }))

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-1 py-2 sm:px-2">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{pipeline ? 'Hiring pipeline' : status === 'SHORTLISTED' ? 'Shortlisted candidates' : 'Applicants'}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{total.toLocaleString()} candidates across your internships.</p>
        </div>
        {!pipeline && (
          <div className="flex flex-wrap items-center gap-2">
            <StatusFilterMenu activeStatus={status} counts={{ ALL: total, ...statusCounts }} onChange={(next) => updateFilter('status', next)} />
            <Button variant="outline" onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>
          </div>
        )}
      </header>
      {!pipeline && (
        <Card className="grid gap-3 bg-white p-4 dark:bg-slate-900 sm:grid-cols-2 xl:grid-cols-5">
          <label className="relative sm:col-span-2 xl:col-span-1">
            <span className="sr-only">Search candidate name</span>
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyFilters() }} placeholder="Search candidate" className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
          </label>
          <label><span className="sr-only">Filter by internship ID</span><input aria-label="Filter by internship ID" inputMode="numeric" value={searchParams.get('internship') ?? ''} onChange={(event) => updateFilter('internship', event.target.value)} placeholder="Internship ID" className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800" /></label>
          <label><span className="sr-only">Filter by skills</span><input value={skills} onChange={(event) => setSkills(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyFilters() }} placeholder="Skills" className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800" /></label>
          <label><span className="sr-only">Filter by education</span><input value={education} onChange={(event) => setEducation(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyFilters() }} placeholder="Education" className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800" /></label>
          <div className="flex gap-2">
            <button type="button" onClick={() => updateFilter('sort', searchParams.get('sort') === 'oldest' ? 'newest' : 'oldest')} className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"><ArrowUpDown className="h-3.5 w-3.5" /> Sort</button>
            <Button variant="outline" onClick={applyFilters}>Apply</Button>
          </div>
        </Card>
      )}
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : loading ? <div className="grid gap-3 sm:grid-cols-2"><CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton /></div> : items.length === 0 ? (
        <EmptyState title="Not enough data yet" description="No applicants match the current filters." />
      ) : pipeline ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {filteredGroups.map((group) => (
            <section key={group.key} aria-label={`${group.label} applicants`} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
              <h2 className="mb-3 flex items-center justify-between text-sm font-bold text-slate-800 dark:text-slate-200">{group.label}<Badge variant="slate">{group.items.length}</Badge></h2>
              <div className="space-y-2">{group.items.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                  <p className="truncate text-sm font-semibold">{item.student_name || 'Candidate'}</p>
                  <p className="mt-1 truncate text-xs text-slate-500">{item.internship_title}</p>
                  <div className="mt-2 flex flex-wrap gap-1">{applicantStages.filter((stage) => stage.key !== item.status && ['UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'SELECTED', 'REJECTED'].includes(stage.key)).map((stage) => <button key={stage.key} type="button" disabled={processingId === item.id} onClick={() => void changeStatus(item, stage.key)} className="rounded-md border border-slate-200 px-2 py-1 text-[10px] hover:bg-indigo-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800">Move to {stage.label}</button>)}</div>
                </div>
              ))}</div>
            </section>
          ))}
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 md:block">
            <table className="w-full min-w-[850px] bg-white text-left text-sm dark:bg-slate-900">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-300"><tr><th className="px-4 py-3">Candidate</th><th className="px-4 py-3">Internship</th><th className="px-4 py-3">Skills / match</th><th className="px-4 py-3">Applied</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr></thead>
              <tbody>{items.map((item) => <tr key={item.id} className="border-t border-slate-100 align-top dark:border-slate-800"><td className="px-4 py-3"><strong>{item.student_name || 'Candidate'}</strong><span className="mt-1 block text-xs text-slate-500">{item.student_university || 'Education not provided'}</span></td><td className="max-w-48 truncate px-4 py-3">{item.internship_title || 'Internship'}</td><td className="max-w-56 px-4 py-3 text-xs">{item.student_skills.join(', ') || '—'}{item.match_score != null && <span className="mt-1 block font-semibold">{item.match_score}% match</span>}</td><td className="whitespace-nowrap px-4 py-3 text-xs">{new Date(item.created_at).toLocaleDateString()}</td><td className="px-4 py-3"><Badge status={item.status}>{item.status.replaceAll('_', ' ')}</Badge></td><td className="min-w-72 px-4 py-3">{actions(item)}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="grid gap-3 md:hidden">{items.map(applicantCard)}</div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</p>
            <div className="flex gap-2">
              <Button variant="outline" disabled={page <= 1} onClick={() => updateFilter('page', String(page - 1))}>Previous</Button>
              <Button variant="outline" disabled={page * pageSize >= total} onClick={() => updateFilter('page', String(page + 1))}>Next</Button>
            </div>
          </div>
        </>
      )}
      {activeInterview && <ScheduleInterviewModal isOpen onClose={() => setActiveInterview(null)} applicationId={activeInterview.id} candidateName={activeInterview.student_name ?? undefined} jobTitle={activeInterview.internship_title ?? undefined} onScheduled={() => { setActiveInterview(null); void load() }} />}
      <Modal
        isOpen={notesApplicant !== null}
        onClose={() => setNotesApplicant(null)}
        title="Private recruiter notes"
        description={`${notesApplicant?.student_name || 'Candidate'} · only visible to your company`}
      >
        <div className="space-y-3">
          {noteError && <p role="alert" className="text-xs text-rose-600 dark:text-rose-300">{noteError}</p>}
          <ul className="max-h-48 space-y-2 overflow-y-auto">
            {applicationNotes.map((note) => (
              <li key={note.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                <p className="whitespace-pre-wrap">{note.body}</p>
                <time className="mt-2 block text-[10px] text-slate-500">{new Date(note.created_at).toLocaleString()}</time>
              </li>
            ))}
          </ul>
          <Textarea label="Add a private note" rows={3} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} maxLength={5000} />
          <div className="flex justify-end">
            <Button type="button" onClick={() => void saveNote()} disabled={!noteDraft.trim() || savingNote} isLoading={savingNote}>Save note</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export function CompanyApplicantsPage({
  pipeline = false,
  initialStatus,
}: {
  pipeline?: boolean
  initialStatus?: string
}) {
  if (pipeline || initialStatus === 'SHORTLISTED') {
    return <CompanyApplicantsRedesign pipeline={pipeline} view={pipeline ? undefined : 'shortlisted'} />
  }
  return <CompanyApplicantsRedesign pipeline={false} view="applicants" />
}

export function CompanyJobsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [jobs, setJobs] = useState<any[]>([])
  const [jobSearch, setJobSearch] = useState('')
  const [sortBy, setSortBy] = useState<'date' | 'applicants'>('date')
  const [companyProfile, setCompanyProfile] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submittingId, setSubmittingId] = useState<number | null>(null)
  const [schedulingJob, setSchedulingJob] = useState<{ id: number; title: string } | null>(null)
  const [closingJob, setClosingJob] = useState<{ id: number; title: string } | null>(null)
  const [closePreview, setClosePreview] = useState<{ counts: Record<string, number>; upcoming_interviews: number } | null>(null)
  const [rejectPending, setRejectPending] = useState(false)
  const [closureNote, setClosureNote] = useState('')
  const [closing, setClosing] = useState(false)
  const fetchJobs = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/internships/mine')
      setJobs(res.data || [])
    } catch {
      setError('Failed to fetch your internship listings.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchJobs()
    api.get('/profiles/company').then(({ data }) => setCompanyProfile(data)).catch(() => undefined)
  }, [])

  const jobTabs = [
    { key: 'ALL', label: 'All' },
    { key: 'PUBLISHED', label: 'Active' },
    { key: 'DRAFT', label: 'Draft' },
    { key: 'PENDING_APPROVAL', label: 'Pending approval' },
    { key: 'CLOSED', label: 'Closed' },
    { key: 'EXPIRED', label: 'Expired' },
    { key: 'REJECTED', label: 'Rejected' },
  ]
  const selectedJobStatus = searchParams.get('status') ?? 'ALL'
  const isExpired = (job: any) => job.status === 'PUBLISHED' && job.deadline && new Date(`${job.deadline}T23:59:59`) < new Date()
  const visibleJobs = jobs
    .filter((job) => {
      const titleMatches = !jobSearch.trim() || String(job.title).toLowerCase().includes(jobSearch.trim().toLowerCase())
      const statusMatches = selectedJobStatus === 'ALL'
        || (selectedJobStatus === 'EXPIRED' ? isExpired(job) : selectedJobStatus === 'PUBLISHED' ? job.status === 'PUBLISHED' && !isExpired(job) : job.status === selectedJobStatus)
      return titleMatches && statusMatches
    })
    .sort((left, right) => sortBy === 'applicants'
      ? (right.applicant_count ?? 0) - (left.applicant_count ?? 0)
      : new Date(right.created_at).getTime() - new Date(left.created_at).getTime())

  const duplicateJob = async (jobId: number) => {
    try {
      await api.post(`/internships/${jobId}/duplicate`)
      await fetchJobs()
    } catch (requestError) {
      console.error(`Unable to duplicate internship ${jobId}.`, requestError)
      showToast('Failed to duplicate internship.', 'error')
    }
  }

  const deleteDraft = async (jobId: number) => {
    if (!await confirmAction({ title: 'Delete draft internship?', message: 'This cannot be undone.', confirmLabel: 'Delete draft', destructive: true })) return
    try {
      await api.delete(`/internships/${jobId}`)
      await fetchJobs()
    } catch (requestError) {
      console.error(`Unable to delete internship draft ${jobId}.`, requestError)
      showToast('Only draft internships can be deleted.', 'error')
    }
  }

  const handleSubmitForApproval = async (jobId: number) => {
    setSubmittingId(jobId)
    try {
      await api.post(`/internships/${jobId}/submit`)
      fetchJobs()
    } catch {
      showToast('Failed to submit internship for approval.', 'error')
    } finally {
      setSubmittingId(null)
    }
  }

  const handleCloseListing = async (jobId: number) => {
    try {
      const job = jobs.find((item) => item.id === jobId)
      const { data } = await api.get(`/internships/${jobId}/close-preview`)
      setClosingJob({ id: jobId, title: job?.title || 'this role' })
      setClosePreview(data)
      setRejectPending(false)
      setClosureNote('')
    } catch {
      showToast('Unable to load the applicant preview for this role.', 'error')
    }
  }

  const confirmCloseListing = async () => {
    if (!closingJob) return
    setClosing(true)
    try {
      await api.post(`/internships/${closingJob.id}/close`, {
        reject_pending: rejectPending,
        note: rejectPending ? closureNote.trim() || null : null,
      })
      setClosingJob(null)
      setClosePreview(null)
      await fetchJobs()
    } catch {
      showToast('Failed to close internship.', 'error')
    } finally {
      setClosing(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
      <WelcomeGreeting
        role="COMPANY"
        customSubtitle="Welcome to your hiring command center. Review candidate applications, publish new roles, and coordinate interviews."
        className="mb-6"
      />

      {companyProfile && companyProfile.verification_status !== 'VERIFIED' && (
        <div role="status" className={`mb-6 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
          companyProfile.verification_status === 'REJECTED'
            ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200'
            : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
        }`}>
          <div>
            <p className="text-sm font-semibold">
              {companyProfile.verification_status === 'REJECTED' ? 'Company verification needs attention' : 'Company verification is pending'}
            </p>
            <p className="mt-1 text-xs opacity-90">
              {companyProfile.verification_reason || (companyProfile.verification_status === 'REJECTED'
                ? 'Review the feedback and replace the requested verification documents.'
                : 'Your profile and documents are under review. Posting access may be limited until your company is verified.')}
            </p>
          </div>
          <Link to={routes.companyProfile} className="shrink-0 text-xs font-semibold underline underline-offset-2">
            Review company profile
          </Link>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Internship Postings</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Create, moderate, and track candidates across your open positions.
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <Link to={routes.interviews({ tab: 'upcoming' })}>
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Calendar className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />}
              className="border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50"
            >
              Interview Scheduling
            </Button>
          </Link>
          <Link to={routes.newCompanyInternship}>
            <Button size="sm" variant="primary" leftIcon={<Plus className="w-4 h-4" />}>
              Post New Role
            </Button>
          </Link>
        </div>
      </div>

      {/* Desktop Hiring Pipeline & Conversion Visuals */}
      <div className="mb-8">
        <DesktopAnalysisVisuals
          variant="company"
          fullAnalyticsMenu
          title="Company Hiring Pipeline & Conversion Analytics"
          subtitle="Real-time candidate screening velocity, recruitment funnel progression, and market distribution"
        />
      </div>

      <div className="mb-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Input aria-label="Search internships by title" value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} placeholder="Search internships by title" className="sm:max-w-sm" />
          <div className="flex gap-2">
            <Button variant={sortBy === 'date' ? 'primary' : 'outline'} size="sm" onClick={() => setSortBy('date')}>Posting date</Button>
            <Button variant={sortBy === 'applicants' ? 'primary' : 'outline'} size="sm" onClick={() => setSortBy('applicants')}>Applicant count</Button>
          </div>
        </div>
        <div role="tablist" aria-label="Filter internships by status" className="flex gap-2 overflow-x-auto pb-1">
          {jobTabs.map((tab) => {
            const count = tab.key === 'ALL' ? jobs.length : jobs.filter((job) => tab.key === 'EXPIRED' ? isExpired(job) : tab.key === 'PUBLISHED' ? job.status === 'PUBLISHED' && !isExpired(job) : job.status === tab.key).length
            return <button key={tab.key} type="button" role="tab" aria-selected={selectedJobStatus === tab.key} onClick={() => { const next = new URLSearchParams(searchParams); if (tab.key === 'ALL') next.delete('status'); else next.set('status', tab.key); setSearchParams(next) }} className={`min-h-10 shrink-0 rounded-lg border px-3 text-xs font-semibold ${selectedJobStatus === tab.key ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}>{tab.label} <span className="ml-1 opacity-75">{count}</span></button>
          })}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={fetchJobs} />
      ) : jobs.length === 0 ? (
        <EmptyState
          title="No internships posted yet"
          description="Create your first internship listing to start receiving applications from verified candidates."
          actionLabel="Post an Internship"
          onAction={() => (window.location.href = routes.newCompanyInternship)}
        />
      ) : (
        <div className="space-y-3">
          {visibleJobs.map((job) => (
            <Card key={job.id} className="p-5 bg-white dark:bg-slate-900">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">{job.title}</h3>
                    <Badge status={job.status}>{job.status === 'CLOSED' ? 'Closed' : job.status}</Badge>
                    <Badge variant="slate">{job.work_mode}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">
                    {job.industry} • {job.location} • {job.stipend == null ? 'Unpaid' : `$${job.stipend}/mo`} • {job.duration_months} mo • {job.applicant_count ?? 0} applicants
                  </p>
                </div>

                <CardActions className="shrink-0">
                  <CardActionButton
                    title={['DRAFT', 'PENDING_APPROVAL'].includes(job.status) ? 'Applicants are available after this role is published.' : 'View applicants'}
                    disabled={['DRAFT', 'PENDING_APPROVAL'].includes(job.status)}
                    onClick={() => navigate(routes.companyJobApplicants(job.id))}
                  >
                    <Users className="h-4 w-4 shrink-0" />
                    <span>View Applicants</span>
                  </CardActionButton>
                  <CardActionButton
                    title={['DRAFT', 'PENDING_APPROVAL'].includes(job.status) ? 'Interview scheduling is available after this role is published.' : 'Schedule interviews for this role'}
                    disabled={['DRAFT', 'PENDING_APPROVAL'].includes(job.status)}
                    onClick={() => setSchedulingJob({ id: job.id, title: job.title })}
                  >
                    <Calendar className="h-4 w-4 shrink-0" />
                    <span>Interview Scheduling</span>
                  </CardActionButton>
                  <CardActionButton
                    intent="danger"
                    title={job.status === 'CLOSED' ? 'Already closed' : job.status === 'PUBLISHED' ? 'Close this role to new applicants' : 'Only published roles can be closed.'}
                    disabled={job.status !== 'PUBLISHED'}
                    onClick={() => void handleCloseListing(job.id)}
                  >
                    Close Role
                  </CardActionButton>
                  {job.status === 'DRAFT' && (
                    <>
                      <Link to={routes.editCompanyInternship(job.id)} className="w-full">
                        <CardActionButton intent="outline">Edit</CardActionButton>
                      </Link>
                      <CardActionButton
                        intent="primary"
                        isLoading={submittingId === job.id}
                        onClick={() => handleSubmitForApproval(job.id)}
                      >
                        <Send className="h-4 w-4" />
                        <span>Submit for Review</span>
                      </CardActionButton>
                      <CardActionButton intent="outline" onClick={() => void duplicateJob(job.id)}>Duplicate</CardActionButton>
                      <CardActionButton intent="danger" onClick={() => void deleteDraft(job.id)}>Delete Draft</CardActionButton>
                    </>
                  )}
                </CardActions>
              </div>
            </Card>
          ))}
        </div>
      )}

      {schedulingJob && (
        <ScheduleInterviewModal
          isOpen={!!schedulingJob}
          onClose={() => setSchedulingJob(null)}
          jobId={schedulingJob.id}
          jobTitle={schedulingJob.title}
          onScheduled={() => {
            fetchJobs()
          }}
        />
      )}

      <Modal
        isOpen={!!closingJob}
        onClose={() => {
          if (!closing) {
            setClosingJob(null)
            setClosePreview(null)
          }
        }}
        title="Close role"
        description={closingJob ? `Review applicants for ${closingJob.title} before closing.` : undefined}
        maxWidth="lg"
      >
        {closePreview && (
          <div className="space-y-5">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Current applicants by status</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['APPLIED', 'Applied'],
                  ['UNDER_REVIEW', 'Under Review'],
                  ['SHORTLISTED', 'Shortlisted'],
                  ['INTERVIEW_SCHEDULED', 'Interview'],
                  ['SELECTED', 'Selected'],
                  ['ACCEPTED', 'Accepted'],
                  ['REJECTED', 'Rejected'],
                  ['WITHDRAWN', 'Withdrawn'],
                ].map(([status, label]) => (
                  <div key={status} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{closePreview.counts[status] || 0}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <input
                  type="radio"
                  name="close-role-choice"
                  checked={!rejectPending}
                  onChange={() => setRejectPending(false)}
                  className="mt-0.5 accent-indigo-600"
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-900 dark:text-white">Keep reviewing existing applicants</span>
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">Their current application statuses will remain unchanged.</span>
                </span>
              </label>
              <label className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <input
                  type="radio"
                  name="close-role-choice"
                  checked={rejectPending}
                  onChange={() => setRejectPending(true)}
                  className="mt-0.5 accent-indigo-600"
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-900 dark:text-white">Reject applicants who are Applied or Under Review</span>
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">Shortlisted, interview-scheduled, and selected applicants are never changed.</span>
                </span>
              </label>
              {rejectPending && (
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Optional note to rejected applicants
                  <textarea
                    value={closureNote}
                    onChange={(event) => setClosureNote(event.target.value.slice(0, 300))}
                    maxLength={300}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    placeholder="Share a short update"
                  />
                  <span className="text-slate-500 dark:text-slate-400">{closureNote.length}/300</span>
                </label>
              )}
            </div>

            {closePreview.upcoming_interviews > 0 && (
              <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                {closePreview.upcoming_interviews} upcoming interview{closePreview.upcoming_interviews === 1 ? '' : 's'} scheduled. Closing this role will not cancel them.
              </p>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
              <Button variant="outline" disabled={closing} onClick={() => setClosingJob(null)}>Cancel</Button>
              <Button variant="danger" isLoading={closing} onClick={() => void confirmCloseListing()}>Close role</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

// --- 2. Create & Edit Internship Form ---

const jobFormSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  description: z.string().min(20, 'Provide a detailed description of duties and qualifications'),
  location: z.string().min(2, 'Location is required (e.g. Remote or San Francisco, CA)'),
  industry: z.string().min(2, 'Industry is required'),
  duration_months: z.coerce.number().min(1, 'Duration must be at least 1 month').max(24),
  stipend: z.coerce.number().min(0, 'Stipend must be 0 or greater'),
  work_mode: z.enum(['REMOTE', 'HYBRID', 'ONSITE']),
  deadline: z.string().min(1, 'Application deadline is required'),
  skills: z.string().optional().or(z.literal('')),
})

export function JobFormPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEditing = Boolean(id)

  const [loading, setLoading] = useState(isEditing)
  const [serverError, setServerError] = useState('')

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof jobFormSchema>>({
    resolver: zodResolver(jobFormSchema),
    defaultValues: {
      work_mode: 'REMOTE',
      duration_months: 3,
      stipend: 1500,
    },
  })

  useEffect(() => {
    if (!id) return
    const fetchExisting = async () => {
      try {
        const res = await api.get(`/internships/${id}`)
        const data = res.data
        setValue('title', data.title)
        setValue('description', data.description)
        setValue('location', data.location)
        setValue('industry', data.industry)
        setValue('duration_months', data.duration_months)
        setValue('stipend', data.stipend)
        setValue('work_mode', data.work_mode)
        setValue('deadline', data.deadline || '')
        setValue('skills', Array.isArray(data.skills) ? data.skills.join(', ') : data.skills || '')
      } catch {
        setServerError('Failed to load internship details.')
      } finally {
        setLoading(false)
      }
    }
    fetchExisting()
  }, [id, setValue])

  const onSubmit = async (data: z.infer<typeof jobFormSchema>) => {
    setServerError('')
    try {
      const payload = {
        title: data.title,
        description: data.description,
        location: data.location,
        industry: data.industry,
        duration_months: data.duration_months,
        stipend: data.stipend,
        work_mode: data.work_mode,
        deadline: data.deadline,
        skills: data.skills ? data.skills.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      }

      if (isEditing) {
        await api.put(`/internships/${id}`, payload)
      } else {
        await api.post('/internships', payload)
      }
      navigate(routes.companyJobs())
    } catch {
      setServerError('Failed to save internship. Please review your inputs.')
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-10 px-4">
        <CardSkeleton />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 w-full">
      <Card className="bg-white dark:bg-slate-900">
        <CardHeader>
          <CardTitle>{isEditing ? 'Edit Internship' : 'Post an Internship'}</CardTitle>
          <CardDescription>
            {isEditing
              ? 'Update listing details. Edits are saved as Draft until submitted for moderation.'
              : 'Create a new internship posting for student applicants.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {serverError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{serverError}</span>
              </div>
            )}

            <Input
              label="Job Title"
              placeholder="e.g. Software Engineering Intern (Summer 2026)"
              error={errors.title?.message}
              {...register('title')}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Location"
                placeholder="e.g. Remote, or New York, NY"
                error={errors.location?.message}
                {...register('location')}
              />
              <Input
                label="Industry"
                placeholder="e.g. Technology, Finance, Media"
                error={errors.industry?.message}
                {...register('industry')}
              />
            </div>

            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
              <DropdownSelect
                label="Work Mode"
                value={watch('work_mode')}
                onChange={(value) => setValue('work_mode', value as z.infer<typeof jobFormSchema>['work_mode'], { shouldValidate: true })}
                options={[
                  { label: 'Remote', value: 'REMOTE' },
                  { label: 'Hybrid', value: 'HYBRID' },
                  { label: 'On-site', value: 'ONSITE' },
                ]}
              />

              <Input
                label="Duration (Months)"
                type="number"
                min={1}
                max={24}
                error={errors.duration_months?.message}
                {...register('duration_months')}
              />

              <Input
                label="Monthly Stipend ($USD)"
                type="number"
                min={0}
                error={errors.stipend?.message}
                {...register('stipend')}
              />
            </div>

            <Input
              label="Application Deadline "
              type="date"
              error={errors.deadline?.message}
              {...register('deadline')}
            />

            <Input
              label="Required Skills / Keywords"
              placeholder="React, TypeScript, Python, PostgreSQL"
              helperText="Comma separated list of keywords"
              error={errors.skills?.message}
              {...register('skills')}
            />

            <Textarea
              label="Full Description & Requirements"
              placeholder="Describe candidate responsibilities, day-to-day work, and desired experience..."
              rows={6}
              error={errors.description?.message}
              {...register('description')}
            />

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
              <Button type="button" variant="outline" size="sm" onClick={() => navigate(routes.companyJobs())}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting}>
                {isEditing ? 'Save Changes' : 'Create Internship (Draft)'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// --- 3. Job Applicants Pipeline ---

export function JobApplicantsPage() {
  const { id } = useParams()
  const [applicants, setApplicants] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeInterviewApp, setActiveInterviewApp] = useState<any | null>(null)
  const [reviewApplicant, setReviewApplicant] = useState<any | null>(null)
  const [notesApplicant, setNotesApplicant] = useState<any | null>(null)
  const [applicationNotes, setApplicationNotes] = useState<Array<{ id: number; body: string; created_at: string }>>([])
  const [noteDraft, setNoteDraft] = useState('')
  const [noteError, setNoteError] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban')
  const [selectedAppIds, setSelectedAppIds] = useState<Set<number>>(new Set())
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [updatingApplicationId, setUpdatingApplicationId] = useState<number | null>(null)
  const [downloadingResumeId, setDownloadingResumeId] = useState<number | null>(null)
  const [draggedAppId, setDraggedAppId] = useState<number | null>(null)
  const [mobileStageFilter, setMobileStageFilter] = useState<string>('ALL')

  const fetchApplicants = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get(`/applications/internships/${id}`)
      setApplicants(res.data || [])
    } catch {
      setError('Failed to fetch applicants for this internship.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchApplicants()
  }, [id])

  const handleUpdateStatus = async (appId: number, newStatus: string) => {
    setUpdatingApplicationId(appId)
    try {
      if (newStatus === 'UNDER_REVIEW') {
        await api.patch(`/applications/${appId}/review`)
      } else if (newStatus === 'SHORTLISTED') {
        await api.patch(`/applications/${appId}/shortlist`)
      } else if (newStatus === 'SELECTED') {
        await api.patch(`/applications/${appId}/select`)
      } else if (newStatus === 'REJECTED') {
        await api.patch(`/applications/${appId}/reject`)
      }
      await fetchApplicants()
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to update candidate stage.', 'error')
    } finally {
      setUpdatingApplicationId(null)
    }
  }

  const handleDownloadResume = async (app: any) => {
    if (!app.has_resume && !app.resume_id) {
      showToast('Resume not uploaded by the student', 'error')
      return
    }
    if (!app.resume_id) {
      showToast('Resume not uploaded by the student', 'error')
      return
    }
    setDownloadingResumeId(app.id)
    try {
      const filename = await downloadAuthenticatedFile(`/profiles/resume/${app.resume_id}/download`, app.resume_filename || `resume_candidate_${app.student_id}.pdf`)
      showToast(`Resume downloaded: ${filename}`, 'success')
    } catch (requestError) {
      const status = (requestError as any)?.response?.status
      showToast(status === 404
        ? 'Resume not uploaded by the student'
        : status === 403
          ? "You don't have access to this resume"
          : "Couldn't download the resume, please try again", 'error')
    } finally {
      setDownloadingResumeId(null)
    }
  }

  const openApplicantNotes = async (app: any) => {
    setNotesApplicant(app)
    setNoteDraft('')
    setNoteError('')
    try {
      const response = await api.get(`/applications/${app.id}/notes`)
      setApplicationNotes(response.data ?? [])
    } catch (requestError) {
      console.error(`Unable to load notes for applicant ${app.id}.`, requestError)
      setApplicationNotes([])
      setNoteError('Could not load private recruiter notes.')
    }
  }

  const saveApplicantNote = async () => {
    if (!notesApplicant || !noteDraft.trim()) return
    setSavingNote(true)
    setNoteError('')
    try {
      const response = await api.post(`/applications/${notesApplicant.id}/notes`, { body: noteDraft.trim() })
      setApplicationNotes((current) => [...current, response.data])
      setNoteDraft('')
    } catch (requestError) {
      console.error(`Unable to save notes for applicant ${notesApplicant.id}.`, requestError)
      setNoteError('Could not save this private note. Please retry.')
    } finally {
      setSavingNote(false)
    }
  }

  // Multi-select toggle
  const toggleSelectApp = (appId: number) => {
    setSelectedAppIds((prev) => {
      const next = new Set(prev)
      if (next.has(appId)) next.delete(appId)
      else next.add(appId)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedAppIds.size === applicants.length) {
      setSelectedAppIds(new Set())
    } else {
      setSelectedAppIds(new Set(applicants.map((a) => a.id)))
    }
  }

  // Bulk actions
  const handleBulkShortlist = async () => {
    if (selectedAppIds.size === 0) return
    setBulkProcessing(true)
    try {
      await api.post('/applications/bulk-status', {
        application_ids: Array.from(selectedAppIds),
        status: 'SHORTLISTED',
      })
      setSelectedAppIds(new Set())
      await fetchApplicants()
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to bulk shortlist candidates', 'error')
    } finally {
      setBulkProcessing(false)
    }
  }

  const handleBulkReject = async () => {
    if (selectedAppIds.size === 0) return
    if (!await confirmAction({
      title: 'Reject selected candidates?',
      message: `Reject ${selectedAppIds.size} selected candidate(s)? They will be notified.`,
      confirmLabel: 'Reject candidates',
      destructive: true,
    })) return
    setBulkProcessing(true)
    try {
      await api.post('/applications/bulk-status', {
        application_ids: Array.from(selectedAppIds),
        status: 'REJECTED',
      })
      setSelectedAppIds(new Set())
      await fetchApplicants()
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to bulk reject candidates', 'error')
    } finally {
      setBulkProcessing(false)
    }
  }

  // Export CSV
  const handleExportCSV = () => {
    const appsToExport = selectedAppIds.size > 0
      ? applicants.filter((a) => selectedAppIds.has(a.id))
      : applicants

    const headers = ['Application ID', 'Student Name', 'Status', 'University', 'Cover Note', 'Applied Date']
    const rows = appsToExport.map((a) => [
      a.id,
      `"${(a.student_name || 'N/A').replace(/"/g, '""')}"`,
      a.status,
      `"${(a.student_university || 'N/A').replace(/"/g, '""')}"`,
      `"${(a.cover_note || '').replace(/"/g, '""')}"`,
      new Date(a.created_at).toLocaleDateString(),
    ])

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `applicants_internship_${id}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, appId: number) => {
    e.dataTransfer.setData('text/plain', String(appId))
    setDraggedAppId(appId)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault()
    const appIdStr = e.dataTransfer.getData('text/plain')
    const appId = Number(appIdStr)
    setDraggedAppId(null)

    if (!appId) return
    const app = applicants.find((a) => a.id === appId)
    if (!app || app.status === targetStatus) return

    if (targetStatus === 'INTERVIEW_SCHEDULED') {
      setActiveInterviewApp(app)
    } else {
      handleUpdateStatus(appId, targetStatus)
    }
  }

  const STAGES = [
    { id: 'APPLIED', title: 'Applied', color: 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400' },
    { id: 'UNDER_REVIEW', title: 'Under Review', color: 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400' },
    { id: 'SHORTLISTED', title: 'Shortlisted', color: 'border-purple-500 bg-purple-50/40 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400' },
    { id: 'INTERVIEW_SCHEDULED', title: 'Interviewing', color: 'border-cyan-500 bg-cyan-50/40 dark:bg-cyan-950/20 text-cyan-700 dark:text-cyan-400' },
    { id: 'SELECTED', title: 'Selected / Offer', color: 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400' },
    { id: 'REJECTED', title: 'Archived', color: 'border-rose-500 bg-rose-50/40 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400' },
  ]

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
      {/* Header Bar */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Applicant Pipeline</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Drag candidates between stages or manage actions in bulk • {applicants.length} Total Applicants
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* View Mode Toggle */}
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 bg-slate-100 dark:bg-slate-800 text-xs">
            <button
              onClick={() => setViewMode('kanban')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${
                viewMode === 'kanban'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Kanban className="w-3.5 h-3.5" />
              Kanban
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <LayoutList className="w-3.5 h-3.5" />
              Table
            </button>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={handleExportCSV}
            leftIcon={<FileSpreadsheet className="w-3.5 h-3.5" />}
          >
            Export CSV
          </Button>

          <Link to={routes.companyJobs()}>
            <Button variant="outline" size="sm">
              Back to Listings
            </Button>
          </Link>
        </div>
      </div>

      {/* Floating Bulk Action Bar */}
      {selectedAppIds.size > 0 && (
        <div className="mb-5 p-3 bg-indigo-600 dark:bg-indigo-900 text-white rounded-xl shadow-lg flex items-center justify-between gap-3 flex-wrap animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-indigo-200" />
            <span className="text-xs font-semibold">{selectedAppIds.size} Candidate(s) Selected</span>
            <button
              onClick={() => setSelectedAppIds(new Set())}
              className="text-[11px] underline text-indigo-200 hover:text-white ml-2 cursor-pointer"
            >
              Deselect all
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 text-xs"
              onClick={handleBulkShortlist}
              isLoading={bulkProcessing}
              leftIcon={<UserCheck className="w-3.5 h-3.5" />}
            >
              Bulk Shortlist
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="bg-rose-500/20 hover:bg-rose-500/30 text-rose-100 border-rose-400/30 text-xs"
              onClick={handleBulkReject}
              isLoading={bulkProcessing}
              leftIcon={<XCircle className="w-3.5 h-3.5" />}
            >
              Bulk Reject
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchApplicants} />
      ) : applicants.length === 0 ? (
        <EmptyState
          title="No candidates yet"
          description="Candidates will appear here as soon as students submit their applications."
        />
      ) : viewMode === 'kanban' ? (
        /* KANBAN BOARD VIEW */
        <div className="space-y-4">
          {/* Mobile Stage Selector Pill Tabs */}
          <div className="md:hidden flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-none">
            <button
              type="button"
              onClick={() => setMobileStageFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-colors cursor-pointer ${
                mobileStageFilter === 'ALL'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              All Stages ({applicants.length})
            </button>
            {STAGES.map((s) => {
              const count = applicants.filter((a) => a.status === s.id || (s.id === 'SELECTED' && a.status === 'ACCEPTED')).length
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setMobileStageFilter(s.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-colors flex items-center gap-1.5 cursor-pointer ${
                    mobileStageFilter === s.id
                      ? 'bg-indigo-600 text-white shadow-2xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <span>{s.title}</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/10 dark:bg-white/10 font-bold">{count}</span>
                </button>
              )
            })}
          </div>

          <div className="flex md:grid md:grid-cols-3 lg:grid-cols-6 gap-4 items-start overflow-x-auto pb-4 snap-x snap-mandatory">
            {STAGES.filter((s) => mobileStageFilter === 'ALL' || s.id === mobileStageFilter).map((stage) => {
              const stageApps = applicants.filter((a) => a.status === stage.id || (stage.id === 'SELECTED' && a.status === 'ACCEPTED'))
              return (
                <div
                  key={stage.id}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, stage.id)}
                  className={`w-[86vw] sm:w-[320px] md:w-auto shrink-0 md:shrink snap-center rounded-2xl border-t-4 border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 p-3 min-h-[500px] flex flex-col space-y-3 transition-colors ${
                    stage.color
                  }`}
                >
                {/* Column Header */}
                <div className="flex items-center justify-between pb-2 border-b border-slate-200/80 dark:border-slate-800">
                  <span className="text-xs font-bold tracking-tight">{stage.title}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                    {stageApps.length}
                  </span>
                </div>

                {/* Column Cards */}
                <div className="space-y-2.5 flex-1 overflow-y-auto">
                  {stageApps.length === 0 ? (
                    <div className="h-32 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-center text-[11px] text-slate-400 dark:text-slate-500 text-center p-2">
                      Drop here to move
                    </div>
                  ) : (
                    stageApps.map((app) => {
                      const isSelected = selectedAppIds.has(app.id)
                      return (
                        <div
                          key={app.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, app.id)}
                          className={`group relative bg-white dark:bg-slate-800/90 rounded-xl p-3 border shadow-2xs hover:shadow-md transition-all cursor-grab active:cursor-grabbing ${
                            draggedAppId === app.id ? 'opacity-40 scale-95' : ''
                          } ${
                            isSelected
                              ? 'border-indigo-500 ring-2 ring-indigo-500/20'
                              : 'border-slate-200/90 dark:border-slate-700 hover:border-indigo-400'
                          }`}
                        >
                          {/* Top Row: Checkbox & Name */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelectApp(app.id)}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                {app.student_name || `Applicant #${app.student_id}`}
                              </h4>
                            </div>
                            <GripVertical className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>

                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 truncate">
                            {app.student_university || 'Student'}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {(app.student_skills ?? []).slice(0, 5).map((skill: string) => <span key={skill} title={skill} className="max-w-24 truncate rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{skill}</span>)}
                            {(app.student_skills?.length ?? 0) > 5 && <span title={app.student_skills.join(', ')} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">+{app.student_skills.length - 5} more</span>}
                            {app.match_score != null && <span title={app.match_explanation || undefined} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{Math.round(app.match_score)}% match</span>}
                            {(app.verified_badges ?? []).map((badge: { id: number; topic: string; title: string; level: string }) => <span key={badge.id} title={`${badge.title} · ${badge.level}`} className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Verified: {badge.topic}</span>)}
                          </div>

                          {app.cover_note && (
                            <p className="text-[10px] text-slate-600 dark:text-slate-300 line-clamp-2 bg-slate-50 dark:bg-slate-900/80 p-1.5 rounded mt-2 border border-slate-100 dark:border-slate-800">
                              "{app.cover_note}"
                            </p>
                          )}

                          <div className="mt-3 flex justify-end border-t border-slate-100 pt-2 dark:border-slate-700/60">
                            <CandidateActions
                              item={app}
                              onReview={() => setReviewApplicant(app)}
                              onNotes={() => void openApplicantNotes(app)}
                              onMoveToReview={() => void handleUpdateStatus(app.id, 'UNDER_REVIEW')}
                              onShortlist={() => void handleUpdateStatus(app.id, 'SHORTLISTED')}
                              onSchedule={() => setActiveInterviewApp(app)}
                              onSelect={() => void handleUpdateStatus(app.id, 'SELECTED')}
                              onReject={() => void handleUpdateStatus(app.id, 'REJECTED')}
                              disabled={updatingApplicationId === app.id}
                            />
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        /* TABLE VIEW */
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-x-auto shadow-2xs">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/50 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <th className="p-3.5 w-10">
                  <input
                    type="checkbox"
                    checked={selectedAppIds.size === applicants.length && applicants.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </th>
                <th className="p-3.5">Candidate</th>
                <th className="p-3.5">University</th>
                <th className="p-3.5">Skills / match</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Applied Date</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {applicants.map((app) => {
                const isSelected = selectedAppIds.has(app.id)
                return (
                  <tr
                    key={app.id}
                    className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors ${
                      isSelected ? 'bg-indigo-50/40 dark:bg-indigo-950/30' : ''
                    }`}
                  >
                    <td className="p-3.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectApp(app.id)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </td>
                    <td className="p-3.5 font-bold text-slate-900 dark:text-white">
                      {app.student_name || `Applicant #${app.student_id}`}
                      {app.cover_note && (
                        <p className="text-[11px] font-normal text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                          {app.cover_note}
                        </p>
                      )}
                    </td>
                    <td className="p-3.5 text-slate-600 dark:text-slate-300">
                      {app.student_university || 'N/A'}
                    </td>
                    <td className="max-w-64 p-3.5">
                      <div className="flex flex-wrap gap-1">
                        {(app.student_skills ?? []).slice(0, 5).map((skill: string) => <span key={skill} title={skill} className="max-w-24 truncate rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{skill}</span>)}
                        {(app.student_skills?.length ?? 0) > 5 && <span title={app.student_skills.join(', ')} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">+{app.student_skills.length - 5} more</span>}
                        {!(app.student_skills?.length) && <span className="text-slate-400">—</span>}
                      </div>
                      {app.match_score != null && <span title={app.match_explanation || undefined} className="mt-1 block text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">{Math.round(app.match_score)}% match</span>}
                      {(app.verified_badges ?? []).length > 0 && <div className="mt-1 flex flex-wrap gap-1">{(app.verified_badges ?? []).map((badge: { id: number; topic: string; title: string; level: string }) => <span key={badge.id} title={`${badge.title} · ${badge.level}`} className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Verified: {badge.topic}</span>)}</div>}
                    </td>
                    <td className="p-3.5">
                      <Badge status={app.status}>{app.status === 'ACCEPTED' ? 'Offer Accepted' : app.status}</Badge>
                    </td>
                    <td className="p-3.5 text-slate-500 dark:text-slate-400">
                      {new Date(app.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-3.5">
                      <CandidateActions
                        item={app}
                        onReview={() => setReviewApplicant(app)}
                        onNotes={() => void openApplicantNotes(app)}
                        onMoveToReview={() => void handleUpdateStatus(app.id, 'UNDER_REVIEW')}
                        onShortlist={() => void handleUpdateStatus(app.id, 'SHORTLISTED')}
                        onSchedule={() => setActiveInterviewApp(app)}
                        onSelect={() => void handleUpdateStatus(app.id, 'SELECTED')}
                        onReject={() => void handleUpdateStatus(app.id, 'REJECTED')}
                        disabled={updatingApplicationId !== null && updatingApplicationId !== app.id}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Schedule Interview Modal */}
      {activeInterviewApp && (
        <ScheduleInterviewModal
          isOpen={!!activeInterviewApp}
          onClose={() => setActiveInterviewApp(null)}
          applicationId={activeInterviewApp.id}
          candidateName={activeInterviewApp.student_name}
          onScheduled={() => {
            fetchApplicants()
          }}
        />
      )}
      <Modal
        isOpen={reviewApplicant !== null}
        onClose={() => setReviewApplicant(null)}
        title="Applicant profile and resume"
        description={reviewApplicant?.student_name || 'Candidate'}
      >
        {reviewApplicant && (
          <div className="space-y-4 text-sm">
            <p className="text-slate-600 dark:text-slate-300">{reviewApplicant.student_university || 'Education not provided'}</p>
            <p><strong>Skills:</strong> {(reviewApplicant.student_skills ?? []).join(', ') || 'Not provided'}</p>
            <p className="whitespace-pre-wrap"><strong>Cover note:</strong> {reviewApplicant.cover_note || 'No cover note provided.'}</p>
            <Button variant="outline" isLoading={downloadingResumeId === reviewApplicant.id} title={reviewApplicant.has_resume || reviewApplicant.resume_id ? `Download ${reviewApplicant.resume_filename || 'resume'}` : 'Resume not uploaded by the student'} className={!reviewApplicant.has_resume && !reviewApplicant.resume_id ? 'text-slate-400 dark:text-slate-500' : ''} onClick={() => void handleDownloadResume(reviewApplicant)} leftIcon={<FileText className="h-4 w-4" />}>View resume</Button>
          </div>
        )}
      </Modal>
      <Modal
        isOpen={notesApplicant !== null}
        onClose={() => setNotesApplicant(null)}
        title="Private recruiter notes"
        description={notesApplicant?.student_name || 'Candidate'}
      >
        <div className="space-y-3">
          {noteError && <p role="alert" className="text-xs text-rose-600">{noteError}</p>}
          {applicationNotes.map((note) => <p key={note.id} className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">{note.body}</p>)}
          <Textarea label="Add a note" value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} rows={3} maxLength={5000} />
          <div className="flex justify-end"><Button disabled={savingNote || !noteDraft.trim()} isLoading={savingNote} onClick={() => void saveApplicantNote()}>Save note</Button></div>
        </div>
      </Modal>
    </div>
  )
}

// --- 4. Company Profile Page ---

const companyProfileSchema = z.object({
  company_name: z.string().min(2, 'Company name is required'),
  industry: z.string().min(2, 'Industry is required'),
  website: z.string().url().optional().or(z.literal('')),
  description: z.string().optional().or(z.literal('')),
  company_size: z.string().max(40).optional().or(z.literal('')),
  location: z.string().max(255).optional().or(z.literal('')),
  recruiter_contact_name: z.string().max(255).optional().or(z.literal('')),
  recruiter_contact_phone: z.string().max(40).optional().or(z.literal('')),
  recruiter_contact_email: z.string().email().optional().or(z.literal('')),
})

export function CompanyProfilePage() {
  const session = useAuthStore((state) => state.session)
  const [profile, setProfile] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [serverError, setServerError] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(session?.avatar_url || null)
  const [documentError, setDocumentError] = useState('')
  const [uploadingDocument, setUploadingDocument] = useState<string | null>(null)
  const [documentProgress, setDocumentProgress] = useState<Record<string, number>>({})
  const [documentTypeToAdd, setDocumentTypeToAdd] = useState('BUSINESS_REGISTRATION')
  const [documentTypeMenuOpen, setDocumentTypeMenuOpen] = useState(false)
  const [deletingDocumentId, setDeletingDocumentId] = useState<number | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof companyProfileSchema>>({
    resolver: zodResolver(companyProfileSchema),
  })

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await api.get('/profiles/company')
        setProfile(res.data)
        try {
          const documentResponse = await api.get('/profiles/company/documents')
          const documentData = documentResponse.data
          const documentList = Array.isArray(documentData)
            ? documentData
            : documentData?.documents || documentData?.items || []
          setProfile((current: any) => ({ ...current, verification_documents: documentList }))
        } catch (error: any) {
          setDocumentError(error.response?.data?.detail || 'Could not load company verification documents.')
        }
        setValue('company_name', res.data.company_name)
        setValue('industry', res.data.industry)
        setValue('website', res.data.website || '')
        setValue('description', res.data.description || '')
        setValue('company_size', res.data.company_size || '')
        setValue('location', res.data.location || '')
        setValue('recruiter_contact_name', res.data.recruiter_contact_name || '')
        setValue('recruiter_contact_phone', res.data.recruiter_contact_phone || '')
        setValue('recruiter_contact_email', res.data.recruiter_contact_email || '')
        if (res.data.avatar_url) {
          setAvatarUrl(res.data.avatar_url)
          useAuthStore.getState().updateAvatar(res.data.avatar_url)
        }
      } catch {
        setServerError('Failed to load company profile.')
      } finally {
        setLoading(false)
      }
    }
    fetchProfile()
  }, [setValue])

  const onSubmit = async (data: z.infer<typeof companyProfileSchema>) => {
    setServerError('')
    try {
      await api.put('/profiles/company', data)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setServerError('Failed to save profile changes.')
    }
  }

  const uploadVerificationDocument = async (documentType: string, file?: File) => {
    if (!file) return
    const extension = file.name.split('.').pop()?.toLowerCase()
    const mimeTypes: Record<string, string> = {
      pdf: 'application/pdf',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
    }
    if (!extension || mimeTypes[extension] !== file.type) {
      setDocumentError('Choose a PDF, JPG, or PNG document.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setDocumentError('File must be 5 MB or smaller.')
      return
    }
    setUploadingDocument(documentType)
    setDocumentError('')
    setDocumentProgress((current) => ({ ...current, [documentType]: 0 }))
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('document_type', documentType)
      const response = await api.post('/profiles/company/documents', formData, {
        onUploadProgress: (event) => {
          if (event.total) setDocumentProgress((current) => ({ ...current, [documentType]: Math.round((event.loaded / event.total!) * 100) }))
        },
      })
      const nextDocument = response.data?.document || response.data || {
        document_type: documentType,
        original_filename: file.name,
        status: 'PENDING',
      }
      setProfile((current: any) => ({
        ...current,
        verification_documents: [...(current?.verification_documents || current?.documents || []), nextDocument],
        documents: undefined,
      }))
      setDocumentProgress((current) => ({ ...current, [documentType]: 100 }))
    } catch (error: any) {
      setDocumentError(error.response?.data?.detail || 'The document could not be uploaded. Please try again.')
    } finally {
      setUploadingDocument(null)
    }
  }

  const deleteVerificationDocument = async (documentId: number) => {
    setDeletingDocumentId(documentId)
    setDocumentError('')
    try {
      await api.delete(`/profiles/company/documents/${documentId}`)
      setProfile((current: any) => ({
        ...current,
        verification_documents: (current?.verification_documents || []).filter((doc: any) => doc.id !== documentId),
      }))
    } catch (error: any) {
      setDocumentError(error.response?.data?.detail || 'Could not delete this verification document.')
    } finally {
      setDeletingDocumentId(null)
    }
  }

  const verificationDocuments = profile?.verification_documents || profile?.documents || []
  const uploadedDocumentTypes = new Set(verificationDocuments.map((document: any) => document.document_type || document.type))

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-10 px-4">
        <CardSkeleton />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Company Profile</h1>
        <p className="text-xs text-slate-500 mt-1">Manage public organization details and verification status.</p>
      </div>

      {/* Company Brand Logo / Avatar Upload */}
      <AvatarUploadCard
        currentAvatarUrl={avatarUrl}
        name={profile?.company_name || 'Organization'}
        roleLabel="Hiring Employer"
        onAvatarUpdated={(newUrl) => setAvatarUrl(newUrl)}
      />

      {profile && (
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Verification Status
            </span>
            <p className="text-sm font-bold text-slate-800">{profile.company_name}</p>
          </div>
          <Badge status={profile.verification_status}>
            {profile.verification_status === 'VERIFIED'
              ? 'Verified'
              : profile.verification_status === 'REJECTED'
                ? 'Rejected'
                : 'Pending'}
          </Badge>
        </div>
      )}

      <Card className="bg-white dark:bg-slate-900">
        <CardHeader>
          <CardTitle>Verification documents</CardTitle>
          <CardDescription>Document review status, reviewer feedback, and secure re-upload.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">Missing documents</p>
            <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
              <li>{uploadedDocumentTypes.has('BUSINESS_REGISTRATION') ? 'Uploaded' : 'Missing'}: Business registration (required)</li>
              <li>{uploadedDocumentTypes.has('GST_OR_PAN') ? 'Uploaded' : 'Not provided'}: GST or PAN (optional)</li>
              <li>{uploadedDocumentTypes.has('AUTHORIZATION_LETTER') ? 'Uploaded' : 'Not provided'}: Authorization letter (optional)</li>
            </ul>
          </div>
          {(profile?.verification_note || profile?.verification_reason || profile?.rejection_reason) && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
              <strong>Reviewer feedback:</strong> {profile.verification_note || profile.verification_reason || profile.rejection_reason}
            </div>
          )}
          {documentError && <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">{documentError}</p>}
          {verificationDocuments.length === 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">No documents have been submitted yet. Upload your business registration document to start verification.</p>
          )}
          {verificationDocuments.map((doc: any, index: number) => {
            const type = doc.document_type || doc.type || `DOCUMENT_${index}`
            return <div key={doc.id ?? type} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 sm:flex-row sm:items-center dark:border-slate-700">
              <FileText className="h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-300" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{doc.original_filename || doc.filename || type.replace(/_/g, ' ')}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <Badge status={doc.status || doc.verification_status || 'PENDING'} />
                  {doc.review_reason && <span>{doc.review_reason}</span>}
                  {doc.rejection_reason && <span>{doc.rejection_reason}</span>}
                  {(doc.created_at || doc.uploaded_at) && <span>Uploaded {new Date(doc.uploaded_at || doc.created_at).toLocaleDateString()}</span>}
                </div>
              </div>
              {(doc.status === 'REJECTED' || doc.verification_status === 'REJECTED' || profile?.verification_status === 'REJECTED') && (
                <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  <UploadCloud className="h-3.5 w-3.5" /> Re-upload
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="sr-only" aria-label={`Re-upload ${type.replace(/_/g, ' ')}`} onChange={(event) => uploadVerificationDocument(type, event.target.files?.[0])} />
                </label>
              )}
              {profile?.verification_status !== 'VERIFIED' && doc.id != null && <Button type="button" variant="ghost" size="sm" isLoading={deletingDocumentId === doc.id} aria-label={`Delete ${doc.original_filename || type}`} onClick={() => void deleteVerificationDocument(doc.id)}>Delete</Button>}
              {uploadingDocument === type && <span className="text-[11px] text-indigo-600 dark:text-indigo-300">{documentProgress[type] || 0}%</span>}
            </div>
          })}
          {verificationDocuments.length >= 5 ? (
            <p className="border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              You have reached the five-document limit.
            </p>
          ) : (
          <div className="flex flex-col gap-2 border-t border-slate-200 pt-3 sm:flex-row dark:border-slate-700">
            <div className="relative flex-1">
              <button
                type="button"
                aria-label="Document type to add"
                aria-haspopup="menu"
                aria-expanded={documentTypeMenuOpen}
                onClick={() => setDocumentTypeMenuOpen((open) => !open)}
                className="flex h-9 w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                {documentTypeToAdd.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase())}
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {documentTypeMenuOpen && (
                <div role="menu" aria-label="Document types" className="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {[
                    ['BUSINESS_REGISTRATION', 'Business registration'],
                    ['GST_OR_PAN', 'GST or PAN'],
                    ['AUTHORIZATION_LETTER', 'Authorization letter'],
                    ['OTHER', 'Other'],
                  ].map(([value, label]) => (
                    <button key={value} type="button" role="menuitem" onClick={() => { setDocumentTypeToAdd(value); setDocumentTypeMenuOpen(false) }} className="w-full rounded-md px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
              <UploadCloud className="h-3.5 w-3.5" /> Add document (max 5 MB)
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="sr-only" aria-label="Add verification document" onChange={(event) => uploadVerificationDocument(documentTypeToAdd, event.target.files?.[0])} />
            </label>
          </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Organization Details</CardTitle>
          <CardDescription>Students see these details when browsing your internship postings.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {saved && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs text-emerald-700">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Company profile updated successfully!</span>
              </div>
            )}

            {serverError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{serverError}</span>
              </div>
            )}

            <Input
              label="Company Name"
              error={errors.company_name?.message}
              {...register('company_name')}
            />

            <Input
              label="Industry"
              error={errors.industry?.message}
              {...register('industry')}
            />

            <Input
              label="Website"
              type="url"
              error={errors.website?.message}
              {...register('website')}
            />

            <Input label="Company size" placeholder="e.g. 50-200 employees" {...register('company_size')} />
            <Input label="Location" placeholder="City, country" {...register('location')} />
            <Input label="Recruiter contact name" {...register('recruiter_contact_name')} />
            <Input label="Recruiter contact phone" type="tel" {...register('recruiter_contact_phone')} />
            <Input
              label="Recruiter contact email"
              type="email"
              error={errors.recruiter_contact_email?.message}
              {...register('recruiter_contact_email')}
            />

            <Textarea
              label="Company Overview"
              rows={4}
              error={errors.description?.message}
              {...register('description')}
            />

            <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting}>
              Save Profile
            </Button>
          </form>
        </CardContent>
      </Card>

      <Link to={routes.privacySecurity} className="block rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-300 dark:hover:bg-indigo-950/50">
        Security settings moved to Privacy &amp; Security Center →
      </Link>
    </div>
  )
}
