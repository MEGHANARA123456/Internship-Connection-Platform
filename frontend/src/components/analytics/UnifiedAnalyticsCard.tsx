import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  Award,
  Bookmark,
  Briefcase,
  CalendarDays,
  Check,
  ChevronDown,
  FileText,
  Info,
  RefreshCw,
  SlidersHorizontal,
  Users,
} from 'lucide-react'
import { api } from '../../api/client'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ChartSkeleton, Spinner } from '../ui/LoadingSkeleton'
import type { AnalyticsChartKind, ChartDatum } from './RechartsAnalyticsCharts'
import { KpiCard } from '../dashboard/KpiCard'
import { routes } from '../../lib/routes'

const RechartsAnalyticsCharts = lazy(async () => {
  const module = await import('./RechartsAnalyticsCharts')
  return { default: module.RechartsAnalyticsCharts }
})

type RangeOption = '7' | '30' | '90' | 'all'
type FocusOption = string

interface Metric {
  value: number | null
  sample_size: number
  definition: string
  numerator?: number
  denominator?: number
}

interface AnalyticsPayload {
  role?: 'student' | 'company' | 'admin'
  range: RangeOption
  sample_size: number
  period_label?: string
  has_data: boolean
  funnel: Array<{ stage: string; count: number; conversion_pct: number | null; dropoff_pct: number | null }>
  activity_trend: Array<{ date: string; applications: number; interviews: number; offers: number }>
  status_breakdown: Array<{ status: string; count: number }>
  domains: Array<{ name: string; count: number }>
  work_modes: Array<{ name: string; count: number }>
  match_score_distribution?: Array<{ bucket: string; count: number }>
  kpis?: Record<string, Metric>
  charts?: Record<string, ChartDatum[]>
  chart_samples?: Record<string, number>
  internships?: Array<{ id: number; title: string }>
}

class ChartChunkBoundary extends Component<{ children: ReactNode; label: string }, { error: boolean }> {
  state = { error: false }

  static getDerivedStateFromError() {
    return { error: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Failed to load ${this.props.label} chart chunk.`, error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert" className="flex min-h-[270px] flex-col items-center justify-center gap-3 text-center text-xs text-rose-700 dark:text-rose-300">
          <p>Couldn't load this chart.</p>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>Retry</Button>
        </div>
      )
    }
    return this.props.children
  }
}

const RANGE_OPTIONS: Array<{ value: RangeOption; label: string }> = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'all', label: 'All time' },
]
const FOCUS_OPTIONS: Array<{ value: FocusOption; label: string }> = [
  { value: 'all', label: 'All charts' },
  { value: 'funnel', label: 'Funnel' },
  { value: 'trends', label: 'Trends' },
  { value: 'domains', label: 'Domains' },
  { value: 'insights', label: 'Insights' },
]

function displayMetric(value: Metric | undefined, format?: (value: number) => string) {
  if (!value || value.value == null) return '-'
  return format ? format(value.value) : value.value.toLocaleString()
}

function CardMetric({
  label,
  metric,
  href,
  detail,
  onRetry,
  loading,
  error,
  icon,
  format,
  period,
  sampleUnit,
}: {
  label: string
  metric?: Metric
  href: string
  detail?: ReactNode
  onRetry: () => void
  loading: boolean
  error: boolean
  icon: ReactNode
  format?: (value: number) => string
  period?: string
  sampleUnit?: string
}) {
  const value = displayMetric(metric, format)
  const sample = metric?.sample_size ?? 0
  const sampleSubject = sampleUnit ?? (label === 'Interviews scheduled'
    ? 'interviews'
    : label === 'Saved roles'
      ? 'saved roles'
      : 'applications')
  const countMetric = ['applications_submitted', 'interviews_scheduled', 'saved_roles', 'active_roles', 'total_applicants', 'shortlisted', 'offers', 'users_signed_up', 'student_signups', 'company_signups', 'admin_actions', 'pending_verifications', 'job_queue', 'disputes'].includes(label.toLowerCase().replaceAll(' ', '_'))
  const caption = detail ?? period ?? (sample
    ? `Based on ${sample.toLocaleString()} ${sampleSubject}`
    : countMetric
      ? label === 'Interviews scheduled' ? 'None scheduled' : 'No activity yet'
      : 'No data yet')
  return (
    <KpiCard
      label={label}
      value={value}
      caption={caption}
      icon={icon}
      href={href}
      info={metric?.definition || 'Metric definition unavailable.'}
      loading={loading}
      error={error}
      onRetry={onRetry}
    />
  )
}

function metricLinks(metrics: Record<string, Metric> | undefined) {
  const statusLink = (label: string, key: string, value: number, status: string) => (
    <Link
      key={key}
      to={routes.applications({ status })}
      aria-label={`View ${value} ${label} applications`}
      className="rounded underline decoration-slate-300 underline-offset-2 hover:text-indigo-600 dark:decoration-slate-600 dark:hover:text-indigo-300"
    >
      {value} {label}
    </Link>
  )
  return (
    <span className="flex flex-wrap gap-x-1.5 gap-y-0.5">
      {statusLink('under review', 'review', metrics?.under_review?.value ?? 0, 'under_review')}
      <span aria-hidden="true">·</span>
      {statusLink('shortlisted', 'shortlisted', metrics?.shortlisted?.value ?? 0, 'shortlisted')}
      <span aria-hidden="true">·</span>
      {statusLink('offers', 'offers', metrics?.offers?.value ?? 0, 'selected')}
    </span>
  )
}

function chartRows(data: AnalyticsPayload | null, kind: AnalyticsChartKind): ChartDatum[] {
  if (!data) return []

  const chartSeries = data.charts?.[kind]
    ?? (kind === 'domains' && data.role === 'admin' ? data.charts?.top_domains : undefined)
  if (Array.isArray(chartSeries)) return chartSeries

  const funnel = Array.isArray(data.funnel) ? data.funnel : []
  const activityTrend = Array.isArray(data.activity_trend) ? data.activity_trend : []
  const statusBreakdown = Array.isArray(data.status_breakdown) ? data.status_breakdown : []
  const domains = Array.isArray(data.domains) ? data.domains : []
  const workModes = Array.isArray(data.work_modes) ? data.work_modes : []
  const matchScoreDistribution = Array.isArray(data.match_score_distribution) ? data.match_score_distribution : []

  if (kind === 'funnel') return funnel.map((item) => ({
    name: item.stage,
    count: item.count,
    conversion_pct: item.conversion_pct,
  }))
  if (kind === 'trends') return activityTrend.map((item) => ({
    name: item.date,
    date: item.date,
    count: item.applications,
    applications: item.applications,
    interviews: item.interviews,
    offers: item.offers,
  }))
  if (kind === 'status') return statusBreakdown.map((item) => ({
    name: (item.status ?? '').replaceAll('_', ' ').toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase()),
    count: item.count,
  }))
  if (kind === 'domains') return domains.map((item) => ({ name: item.name, count: item.count }))
  if (kind === 'work_modes') return workModes.map((item) => ({ name: item.name, count: item.count }))
  return matchScoreDistribution.map((item) => ({ name: item.bucket, count: item.count }))
}

const CHARTS: Array<{ kind: AnalyticsChartKind; title: string; focus: FocusOption }> = [
  { kind: 'funnel', title: 'Application status funnel', focus: 'funnel' },
  { kind: 'trends', title: 'Activity trend', focus: 'trends' },
  { kind: 'domains', title: 'Roles by domain', focus: 'domains' },
  { kind: 'work_modes', title: 'Work-mode split', focus: 'domains' },
  { kind: 'top_companies', title: 'Top companies applied to', focus: 'domains' },
  { kind: 'match_score', title: 'Match score distribution', focus: 'insights' },
  { kind: 'skill_gap', title: 'Skill gap', focus: 'insights' },
  { kind: 'stipend_distribution', title: 'Stipend distribution', focus: 'insights' },
  { kind: 'upcoming_deadlines', title: 'Upcoming saved-role deadlines', focus: 'insights' },
]

type AnalyticsKind = 'student' | 'company' | 'admin'
type KpiCardConfig = {
  label: string
  key: string
  href: string
  icon: ReactNode
  info: string
  sampleUnit: string
  format?: (value: number) => string
  period?: string
}

const ROLE_CHARTS: Record<AnalyticsKind, Array<{ kind: AnalyticsChartKind; title: string; focus?: FocusOption }>> = {
  student: CHARTS,
  company: [
    { kind: 'company_pipeline', title: 'Status Per Application ', focus: 'funnel' },
    { kind: 'conversion_by_role', title: 'Conversion per role', focus: 'funnel' },
    { kind: 'applicants_by_posting', title: 'Applicants per posting', focus: 'domains' },
    { kind: 'applications_over_time', title: 'Applications over time', focus: 'trends' },
    { kind: 'domains', title: 'Roles by domain', focus: 'domains' },
    { kind: 'top_skills', title: 'Top skills among applicants', focus: 'domains' },
    { kind: 'top_universities', title: 'Top universities', focus: 'insights' },
  ],
  admin: [
    { kind: 'signups_over_time', title: 'Signups over time', focus: 'trends' },
    { kind: 'admin_applications_over_time', title: 'Applications over time', focus: 'trends' },
    { kind: 'internships_by_status', title: 'Internships by status' },
    { kind: 'admin_actions_by_type', title: 'Admin actions by type' },
    { kind: 'verification_status', title: 'Verification status' },
    { kind: 'domains', title: 'Internships by domain', focus: 'domains' },
  ],
}

function chartSample(data: AnalyticsPayload | null, kind: AnalyticsChartKind, rows: ChartDatum[]): { count: number; noun: string } {
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
  const serverSample = data?.chart_samples?.[kind]
  if (serverSample != null) {
    const nouns: Partial<Record<AnalyticsChartKind, string>> = {
      status_over_time: 'status changes',
      response_times: 'responded applications',
      skill_gap: 'roles',
      activity_calendar: 'activities',
      top_companies: 'applications',
      stipend_distribution: 'paid roles',
      duration_distribution: 'roles',
      upcoming_deadlines: 'saved roles',
    }
    return { count: serverSample, noun: nouns[kind] ?? 'records' }
  }
  if (kind === 'signups_over_time') {
    return { count: sum(rows.map((row) => (row.students ?? 0) + (row.companies ?? 0))), noun: 'signups' }
  }
  if (kind === 'admin_actions_by_type') {
    return { count: sum(rows.map((row) => row.count)), noun: 'actions' }
  }
  if (kind === 'domains' || kind === 'top_domains') {
    return { count: sum(rows.map((row) => row.count)), noun: 'internships' }
  }
  if (kind === 'applicants_by_posting') {
    return { count: sum(rows.map((row) => row.count)), noun: 'applications' }
  }
  if (kind === 'applications_over_time' || kind === 'admin_applications_over_time' || kind === 'trends') {
    return { count: sum(rows.map((row) => row.applications ?? row.count)), noun: 'applications' }
  }
  if (kind === 'top_skills') {
    return { count: data?.sample_size ?? 0, noun: 'applicants' }
  }
  if (kind === 'top_universities') {
    return { count: sum(rows.map((row) => row.count)), noun: 'applicants' }
  }
  if (kind === 'interview_outcomes') {
    return { count: sum(rows.map((row) => row.count)), noun: 'interviews' }
  }
  if (kind === 'internships_by_status') {
    return { count: sum(rows.map((row) => row.count)), noun: 'internships' }
  }
  if (kind === 'verification_status') {
    return { count: sum(rows.map((row) => row.count)), noun: 'companies' }
  }
  if (kind === 'funnel' || kind === 'company_pipeline') {
    return { count: rows[0]?.count ?? 0, noun: 'applications' }
  }
  return { count: sum(rows.map((row) => row.count)), noun: 'records' }
}

const KPI_CONFIG: Record<AnalyticsKind, KpiCardConfig[]> = {
  student: [
    { label: 'Applications submitted', key: 'applications_submitted', href: routes.applications(), icon: <FileText className="h-4 w-4" />, info: 'Count of this student’s application records.', sampleUnit: 'applications' },
    { label: 'Interviews scheduled', key: 'interviews_scheduled', href: routes.interviews({ tab: 'upcoming' }), icon: <CalendarDays className="h-4 w-4" />, info: 'Future interviews whose status is SCHEDULED or RESCHEDULED.', sampleUnit: 'interviews' },
    { label: 'Saved roles', key: 'saved_roles', href: routes.saved, icon: <Bookmark className="h-4 w-4" />, info: 'Saved internship records owned by this student.', sampleUnit: 'saved roles' },
    { label: 'Average match score', key: 'average_match_score', href: routes.applications({ sort: 'match' }), icon: <Award className="h-4 w-4" />, format: (value) => `${value}%`, info: 'Mean compute_match score across this student’s applications.', sampleUnit: 'applications' },
  ],
  company: [
    { label: 'Active roles', key: 'active_roles', href: routes.companyJobs({ status: 'published' }), icon: <Briefcase className="h-4 w-4" />, info: 'Internships published by this company.', sampleUnit: 'roles' },
    { label: 'Total applicants', key: 'total_applicants', href: routes.companyApplicants(), icon: <Users className="h-4 w-4" />, info: 'Applications submitted to this company’s internships.', sampleUnit: 'applications' },
    { label: 'Shortlisted', key: 'shortlisted', href: routes.companyApplicants({ status: 'shortlisted' }), icon: <Check className="h-4 w-4" />, info: 'Applications currently shortlisted.', sampleUnit: 'applications' },
    { label: 'Interviews scheduled', key: 'interviews_scheduled', href: routes.interviews({ tab: 'upcoming' }), icon: <CalendarDays className="h-4 w-4" />, info: 'Future interviews in SCHEDULED or RESCHEDULED status.', sampleUnit: 'interviews' },
    { label: 'Offers', key: 'offers', href: routes.companyApplicants({ status: 'selected' }), icon: <Award className="h-4 w-4" />, info: 'Applications currently selected or accepted.', sampleUnit: 'applications' },
  ],
  admin: [
    { label: 'Users signed up', key: 'users_signed_up', href: routes.adminUsers({ created: 'this_month' }), icon: <Users className="h-4 w-4" />, info: 'Accounts created since the start of the current UTC month.', sampleUnit: 'users' },
    { label: 'Student signups', key: 'student_signups', href: routes.adminUsers({ role: 'student', created: 'this_month' }), icon: <Users className="h-4 w-4" />, info: 'Student accounts created this UTC calendar month.', sampleUnit: 'students' },
    { label: 'Company signups', key: 'company_signups', href: routes.adminUsers({ role: 'company', created: 'this_month' }), icon: <Briefcase className="h-4 w-4" />, info: 'Company accounts created this UTC calendar month.', sampleUnit: 'companies' },
    { label: 'Admin actions', key: 'admin_actions', href: routes.adminAuditLogs({ range: '14d' }), icon: <Activity className="h-4 w-4" />, info: 'Audit log records created in the last 14 days.', sampleUnit: 'actions', period: 'Last 14 days' },
    { label: 'Pending verifications', key: 'pending_verifications', href: routes.adminVerifications, icon: <Check className="h-4 w-4" />, info: 'Company profiles currently awaiting verification.', sampleUnit: 'companies' },
    { label: 'Job queue', key: 'job_queue', href: routes.adminModeration, icon: <FileText className="h-4 w-4" />, info: 'Internships currently awaiting moderation.', sampleUnit: 'postings' },
    { label: 'Disputes', key: 'disputes', href: routes.adminReports({ status: 'open' }), icon: <Info className="h-4 w-4" />, info: 'Reports currently open.', sampleUnit: 'reports' },
  ],
}

export function UnifiedAnalyticsCard({
  variant,
  title,
  subtitle,
  refreshKey = 0,
  onRefreshed,
}: {
  variant: 'student' | 'company' | 'admin'
  title: string
  subtitle?: string
  refreshKey?: number
  onRefreshed?: () => void
}) {
  const [range, setRange] = useState<RangeOption>('30')
  const [focus, setFocus] = useState<FocusOption>('all')
  const [showRangeMenu, setShowRangeMenu] = useState(false)
  const [showFocusMenu, setShowFocusMenu] = useState(false)
  const [showInternshipMenu, setShowInternshipMenu] = useState(false)
  const [internshipId, setInternshipId] = useState<number | null>(null)
  const [viewAsTable, setViewAsTable] = useState(false)
  const [data, setData] = useState<AnalyticsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const rangeMenuRef = useRef<HTMLDivElement>(null)
  const focusMenuRef = useRef<HTMLDivElement>(null)
  const internshipMenuRef = useRef<HTMLDivElement>(null)
  const rangeTriggerRef = useRef<HTMLButtonElement>(null)
  const focusTriggerRef = useRef<HTMLButtonElement>(null)
  const requestId = useRef(0)

  const loadData = useCallback(async () => {
    const currentRequest = ++requestId.current
    setLoading(true)
    setRefreshing(true)
    setError(false)
    try {
      const path = variant === 'student'
        ? `/students/me/insights?range=${range}`
        : variant === 'company'
          ? `/companies/me/insights?range=${range}${internshipId == null ? '' : `&internship_id=${internshipId}`}`
          : `/admin/insights?range=${range}`
      const response = await api.get(path)
      if (currentRequest === requestId.current) {
        setData(response.data as AnalyticsPayload)
        onRefreshed?.()
      }
    } catch {
      if (currentRequest === requestId.current) setError(true)
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [internshipId, onRefreshed, range, variant])

  useEffect(() => {
    void loadData()
  }, [loadData, refreshKey])

  useEffect(() => {
    if (!showRangeMenu && !showFocusMenu && !showInternshipMenu) return
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (showRangeMenu && !rangeMenuRef.current?.contains(target)) setShowRangeMenu(false)
      if (showFocusMenu && !focusMenuRef.current?.contains(target)) setShowFocusMenu(false)
      if (showInternshipMenu && !internshipMenuRef.current?.contains(target)) setShowInternshipMenu(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowRangeMenu(false)
        setShowFocusMenu(false)
        setShowInternshipMenu(false)
      }
    }
    document.addEventListener('mousedown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [showFocusMenu, showInternshipMenu, showRangeMenu])

  useEffect(() => {
    if (showRangeMenu) rangeMenuRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]')?.focus()
    if (showFocusMenu) focusMenuRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]')?.focus()
  }, [showFocusMenu, showRangeMenu])

  const handleMenuKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    close: (open: boolean) => void,
    trigger: React.RefObject<HTMLButtonElement | null>,
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close(false)
      trigger.current?.focus()
      return
    }
    const items = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])
    const currentIndex = items.indexOf(event.currentTarget)
    const nextIndex = event.key === 'ArrowDown'
      ? (currentIndex + 1) % items.length
      : event.key === 'ArrowUp'
        ? (currentIndex - 1 + items.length) % items.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : -1
    if (nextIndex >= 0) {
      event.preventDefault()
      items[nextIndex]?.focus()
    }
  }

  const chartList = useMemo(() => ROLE_CHARTS[variant], [variant])
  const menuOptions = FOCUS_OPTIONS
  const visibleCharts = chartList.filter((chart) => (
    (focus === 'all' || chart.focus === focus || chart.kind === focus)
    && !(variant === 'student' && chart.kind === 'stipend_distribution' && (data?.chart_samples?.stipend_distribution ?? 0) < 5)
  ))
  const metrics = data?.kpis
  const rangeLabel = RANGE_OPTIONS.find((item) => item.value === range)?.label ?? '30 days'
  const periodLabel = range === 'all' ? 'all time' : `last ${rangeLabel.toLowerCase()}`

  const studentCards = [
    { label: 'Applications submitted', key: 'applications_submitted', href: routes.applications(), icon: <FileText className="h-4 w-4" />, detail: metricLinks(metrics), info: 'Count of all application records submitted by this student.' },
    { label: 'Interviews scheduled', key: 'interviews_scheduled', href: routes.interviews({ tab: 'upcoming' }), icon: <CalendarDays className="h-4 w-4" />, info: 'Future interviews whose status is SCHEDULED or RESCHEDULED.' },
    { label: 'Saved roles', key: 'saved_roles', href: routes.saved, icon: <Bookmark className="h-4 w-4" />, info: 'Saved internship records owned by this student.' },
    { label: 'Average match score', key: 'average_match_score', href: routes.applications({ sort: 'match' }), icon: <Award className="h-4 w-4" />, format: (value: number) => `${value}%`, info: 'Mean compute_match score across all applications, based on profile skills and internship requirements.' },
  ]

  return (
    <div className="space-y-8">
      {variant === 'student' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
          {studentCards.map((card) => (
            <CardMetric
              key={card.key}
              label={card.label}
              metric={metrics?.[card.key] ? { ...metrics[card.key], definition: card.info } : undefined}
              href={card.href}
              detail={card.detail}
              onRetry={() => { void loadData() }}
              loading={loading}
              error={error}
              icon={card.icon}
              format={card.format}
            />
          ))}
        </div>
      )}
      {variant !== 'student' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
          {KPI_CONFIG[variant].map((card) => (
            <CardMetric
              key={card.key}
              label={card.label}
              metric={metrics?.[card.key] ? { ...metrics[card.key], definition: card.info } : undefined}
              href={card.href}
              period={card.period ?? (variant === 'admin' ? data?.period_label : undefined)}
              sampleUnit={card.sampleUnit}
              onRetry={() => { void loadData() }}
              loading={loading}
              error={error}
              icon={card.icon}
              format={card.format}
            />
          ))}
        </div>
      )}
      <Card className="mb-8 overflow-hidden bg-white p-6 dark:bg-slate-900">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-white sm:text-lg">{title}</h2>
            {subtitle && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
            <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
              Totals: all time. Activity: {periodLabel}.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <div className="relative" ref={rangeMenuRef}>
              <button
                ref={rangeTriggerRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={showRangeMenu}
                onClick={() => setShowRangeMenu((open) => !open)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none hover:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-auto"
              >
                <span>{rangeLabel}</span><ChevronDown className="h-3.5 w-3.5" />
              </button>
              {showRangeMenu && (
                <div role="menu" aria-label="Analytics time range" className="absolute right-0 top-full z-30 mt-1 w-36 rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  {RANGE_OPTIONS.map((option) => (
                    <button key={option.value} type="button" role="menuitemradio" aria-checked={range === option.value} onKeyDown={(event) => handleMenuKeyDown(event, setShowRangeMenu, rangeTriggerRef)} onClick={() => { setRange(option.value); setShowRangeMenu(false) }} className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:bg-slate-800">
                      {option.label}{range === option.value && <Check className="h-3.5 w-3.5" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {variant === 'company' && (
              <div className="relative" ref={internshipMenuRef}>
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={showInternshipMenu}
                  onClick={() => setShowInternshipMenu((open) => !open)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none hover:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-auto"
                >
                  <span className="max-w-40 truncate">{internshipId == null ? 'All internships' : data?.internships?.find((item) => item.id === internshipId)?.title ?? 'Selected internship'}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {showInternshipMenu && (
                  <div role="menu" aria-label="Filter analytics by internship" className="absolute right-0 top-full z-30 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                    <button type="button" role="menuitemradio" aria-checked={internshipId === null} onClick={() => { setInternshipId(null); setShowInternshipMenu(false) }} className="w-full rounded-md px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">All internships</button>
                    {(data?.internships ?? []).map((internship) => (
                      <button key={internship.id} type="button" role="menuitemradio" aria-checked={internshipId === internship.id} onClick={() => { setInternshipId(internship.id); setShowInternshipMenu(false) }} className="w-full truncate rounded-md px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                        {internship.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="relative" ref={focusMenuRef}>
              <button
                ref={focusTriggerRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={showFocusMenu}
                onClick={() => setShowFocusMenu((open) => !open)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none hover:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-auto"
              >
                <span className="flex items-center gap-1.5"><SlidersHorizontal className="h-3.5 w-3.5" />Show: {menuOptions.find((option) => option.value === focus)?.label}</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {showFocusMenu && (
                <div role="menu" aria-label="Analytics chart focus" className="absolute right-0 top-full z-30 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  {menuOptions.map((option) => (
                    <button key={option.value} type="button" role="menuitemradio" aria-checked={focus === option.value} onKeyDown={(event) => handleMenuKeyDown(event, setShowFocusMenu, focusTriggerRef)} onClick={() => { setFocus(option.value); setShowFocusMenu(false) }} className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:bg-slate-800">
                      {option.label}{focus === option.value && <Check className="h-3.5 w-3.5" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              aria-pressed={viewAsTable}
              onClick={() => setViewAsTable((visible) => !visible)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {viewAsTable ? 'View as charts' : 'View as table'}
            </button>
            <Button size="sm" variant="outline" onClick={() => { void loadData() }} disabled={refreshing} leftIcon={refreshing ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />} className="col-span-2 sm:col-span-1">
              Refresh
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-4 pt-5 lg:grid-cols-2 lg:gap-6">
          {visibleCharts.map((chart) => {
            const rows = data ? chartRows(data, chart.kind) : []
            const sample = chartSample(data, chart.kind, rows)
            const enoughData = rows.some((row) => Object.entries(row).some(([key, value]) => key !== 'name' && key !== 'action' && typeof value === 'number' && value > 0))
            return (
              <section key={chart.kind} data-chart-panel aria-labelledby={`analytics-${chart.kind}`} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-3 flex min-h-7 items-center justify-between gap-3">
                  <h3 id={`analytics-${chart.kind}`} className="truncate text-sm font-bold text-slate-900 dark:text-white">{chart.title}</h3>
                </div>
                {loading ? (
                  <ChartSkeleton className="min-h-[270px] border-0 bg-transparent p-0 dark:bg-transparent" />
                ) : error ? (
                  <div role="alert" className="flex min-h-[270px] flex-col items-center justify-center gap-3 text-center text-xs text-slate-600 dark:text-slate-300">
                    <p>Couldn't load this chart.</p>
                    <Button size="sm" variant="outline" onClick={() => { void loadData() }}>Retry</Button>
                  </div>
                ) : !enoughData ? (
                  <div className="flex min-h-[270px] items-center justify-center rounded-lg border border-dashed border-slate-200 px-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    Not enough data yet
                  </div>
                ) : (
                  <ChartChunkBoundary label={chart.title}>
                    <Suspense fallback={<ChartSkeleton className="min-h-[270px] border-0 bg-transparent p-0 dark:bg-transparent" />}>
                      <RechartsAnalyticsCharts kind={chart.kind} label={chart.title} rows={rows} viewAsTable={viewAsTable} />
                    </Suspense>
                  </ChartChunkBoundary>
                )}
                {!loading && !error && enoughData && (
                  <p className="sr-only">
                    Sample size: {sample.count.toLocaleString()} {sample.noun}.{' '}
                    {variant === 'company' || ['trends', 'applications_over_time', 'admin_applications_over_time', 'signups_over_time', 'status_over_time', 'response_times', 'activity_calendar'].includes(chart.kind)
                      ? periodLabel
                      : chart.kind === 'upcoming_deadlines' ? 'Upcoming'
                        : 'All time'}
                    {chart.kind === 'response_times' && rows[0]?.median_days != null ? `. Median: ${rows[0].median_days} days` : ''}
                  </p>
                )}
              </section>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
