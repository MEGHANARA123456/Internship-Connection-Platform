// TODO : this is company  analysis file 
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../../api/client'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ChartSkeleton, KpiSkeleton } from '../ui/LoadingSkeleton'
import { Activity, Award, Briefcase, Clock, FileText, ShieldCheck, Users } from 'lucide-react'
import {
  ResponsiveBars,
  ResponsiveDonut,
  ResponsiveLineChart,
  ResponsiveStackedBars,
  type ChartDatum,
} from '../charts/ResponsiveChart'

type StatusCount = { status: string; count: number }

interface CompanyPerformance {
  by_role: Array<{
    internship_id: number
    title: string
    applications: number
    shortlisted: number
    offers: number
    accepted: number
  }>
  status_distribution: StatusCount[]
  time_metrics: {
    avg_hours_to_first_response: number
    avg_days_to_offer: number
    sample_size: number
    offer_sample_size: number
  }
  match_distribution: Array<{ bucket: string; count: number }>
  match_distribution_sample_size: number
  top_skills: Array<{ skill: string; applicants: number; required_by_roles: number }>
  top_universities: Array<{ university: string; applicants: number }>
  interview_outcomes: { scheduled: number; completed: number; cancelled: number }
  offer_acceptance_rate: number
  offer_sample_size: number
  total_applications: number
}

interface StudentInsights {
  status_distribution: StatusCount[]
  weekly_applications: Array<{ week_start: string; applications: number }>
  response_rate: number
  response_sample_size: number
  responded_applications: number
  avg_match_score: number
  match_sample_size: number
  skills_gap: Array<{ skill: string; missing_count: number }>
  avg_response_hours: number
  response_time_sample_size: number
  total_applications: number
}

interface AnalyticsKpiInput {
  label: string
  value: ReactNode
  icon?: ReactNode
  detail?: string
  loading?: boolean
  error?: string
  onRetry?: () => void
}

type RoleAnalytics = {
  variant: 'student' | 'company' | 'admin'
  chart: string
  range: '30' | '90' | 'all'
  refreshKey?: number
  extraKpis?: AnalyticsKpiInput[]
}

export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0 h'
  if (hours < 48) return `${Math.round(hours)} h`
  const days = Math.floor(hours / 24)
  const remainingHours = Math.round(hours - days * 24)
  if (remainingHours === 24) return `${days + 1} d`
  return remainingHours === 0 ? `${days} d` : `${days} d ${remainingHours} h`
}

function isCompanyPerformance(value: unknown): value is CompanyPerformance {
  if (typeof value !== 'object' || value === null) return false
  const payload = value as Record<string, unknown>
  const timeMetrics = payload.time_metrics
  return Array.isArray(payload.by_role)
    && Array.isArray(payload.status_distribution)
    && Array.isArray(payload.match_distribution)
    && Array.isArray(payload.top_skills)
    && Array.isArray(payload.top_universities)
    && typeof payload.total_applications === 'number'
    && typeof payload.offer_acceptance_rate === 'number'
    && typeof timeMetrics === 'object'
    && timeMetrics !== null
    && typeof payload.interview_outcomes === 'object'
    && payload.interview_outcomes !== null
}

function isStudentInsights(value: unknown): value is StudentInsights {
  if (typeof value !== 'object' || value === null) return false
  const payload = value as Record<string, unknown>
  return Array.isArray(payload.status_distribution)
    && Array.isArray(payload.weekly_applications)
    && Array.isArray(payload.skills_gap)
    && typeof payload.response_rate === 'number'
    && typeof payload.avg_match_score === 'number'
    && typeof payload.avg_response_hours === 'number'
    && typeof payload.total_applications === 'number'
}

function ChartFrame({
  title,
  loading,
  error,
  retry,
  empty,
  children,
}: {
  title: string
  loading: boolean
  error: boolean
  retry: () => void
  empty: boolean
  children: React.ReactNode
}) {
  return (
    <Card className="min-w-0 bg-white p-5 dark:bg-slate-900">
      <h3 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
      {loading ? <ChartSkeleton className="border-0 bg-transparent p-0 dark:bg-transparent" /> : error ? (
        <div className="flex h-[280px] flex-col items-center justify-center gap-3 text-center text-xs text-slate-500 dark:text-slate-400">
          <p>Couldn't load this chart.</p>
          <Button size="sm" variant="outline" onClick={retry}>Retry</Button>
        </div>
      ) : empty ? (
        <div className="flex h-[280px] items-center justify-center rounded-xl border border-dashed border-slate-200 px-5 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No data to display yet. Your chart will appear as activity comes in.
        </div>
      ) : (
        <div className="min-h-[280px]">{children}</div>
      )}
    </Card>
  )
}

function DonutChart({ items, label }: { items: Array<{ label: string; value: number }>; label: string }) {
  const colors = ['#4f46e5', '#06b6d4', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#64748b']
  const total = items.reduce((sum, item) => sum + item.value, 0)
  const circumference = 226.2
  let offset = 0
  const summary = items.map((item) => `${item.label}: ${item.value}`).join(', ')
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center gap-5 sm:flex-row">
      <svg viewBox="0 0 100 100" className="h-40 w-40 shrink-0" role="img" aria-label={`${label}: ${summary}`}>
        <title>{label}</title>
        <circle cx="50" cy="50" r="36" fill="none" stroke="currentColor" strokeWidth="13" className="text-slate-100 dark:text-slate-800" />
        {total > 0 && items.map((item, index) => {
          const length = (item.value / total) * circumference
          const currentOffset = offset
          offset += length
          return (
            <circle
              key={item.label}
              cx="50"
              cy="50"
              r="36"
              fill="none"
              stroke={colors[index % colors.length]}
              strokeWidth="13"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-currentOffset}
              transform="rotate(-90 50 50)"
            >
              <title>{`${item.label}: ${item.value}`}</title>
            </circle>
          )
        })}
        <text x="50" y="48" textAnchor="middle" className="fill-slate-900 text-[13px] font-bold dark:fill-white">{total}</text>
        <text x="50" y="60" textAnchor="middle" className="fill-slate-500 text-[6px] dark:fill-slate-400">applications</text>
      </svg>
      <div className="space-y-2 text-xs">
        {items.map((item, index) => (
          <div key={item.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
            <span className="text-slate-600 dark:text-slate-300">{item.label}</span>
            <span className="font-semibold text-slate-900 dark:text-white">{item.value}</span>
          </div>
        ))}
      </div>
      <p className="sr-only">{label}: {summary || 'No applications.'}</p>
    </div>
  )
}

function HorizontalBars({
  items,
  label,
}: {
  items: Array<{ label: string; value: number; detail?: string }>
  label: string
}) {
  const max = Math.max(...items.map((item) => item.value), 1)
  const summary = items.map((item) => `${item.label}: ${item.value}${item.detail ? `, ${item.detail}` : ''}`).join('; ')
  return (
    <div role="img" aria-label={`${label}. ${summary}`} className="space-y-4">
      <p className="sr-only">{label}: {summary}</p>
      {items.map((item) => (
        <div key={item.label} title={`${item.label}: ${item.value}${item.detail ? `; ${item.detail}` : ''}`} className="space-y-1.5">
          <div className="flex justify-between gap-3 text-xs">
            <span className="truncate text-slate-600 dark:text-slate-300">{item.label}</span>
            <span className="shrink-0 font-semibold text-slate-900 dark:text-white">{item.value}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(item.value > 0 ? 2 : 0, (item.value / max) * 100)}%` }} />
          </div>
          {item.detail && <p className="text-[10px] text-slate-500 dark:text-slate-400">{item.detail}</p>}
        </div>
      ))}
    </div>
  )
}

function MetricCard({
  title,
  value,
  suffix,
  sampleSize,
  loading,
  error,
  retry,
}: {
  title: string
  value: number
  suffix: string
  sampleSize: number
  loading: boolean
  error: boolean
  retry: () => void
}) {
  if (loading) return <KpiSkeleton />
  return (
    <Card className="min-h-[96px] bg-white p-4 dark:bg-slate-900">
      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{title}</p>
      {error ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">Couldn't load.</span>
          <Button size="sm" variant="outline" onClick={retry}>Retry</Button>
        </div>
      ) : (
        <>
          <p className="mt-2 text-xl font-bold text-slate-900 dark:text-white">{value}{suffix}</p>
          <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Sample size: {sampleSize}</p>
        </>
      )}
    </Card>
  )
}

export function CompanyPerformanceCharts({
  range,
  refreshKey = 0,
}: {
  range: '30' | '90' | 'all'
  refreshKey?: number
}) {
  const [data, setData] = useState<CompanyPerformance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const response = await api.get(`/analytics/company/performance?range=${range}`)
      if (!isCompanyPerformance(response.data)) throw new Error('Invalid company analytics response.')
      setData(response.data)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { void load() }, [load, refreshKey])

  const noApplications = Boolean(data && data.total_applications === 0)
  const retry = () => { void load() }
  return (
    <section aria-label="Company performance analytics" className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Time to first response"
          value={data?.time_metrics.avg_hours_to_first_response ?? 0}
          suffix=" hrs"
          sampleSize={data?.time_metrics.sample_size ?? 0}
          loading={loading}
          error={error}
          retry={retry}
        />
        <MetricCard
          title="Time to hire"
          value={data?.time_metrics.avg_days_to_offer ?? 0}
          suffix=" days"
          sampleSize={data?.time_metrics.offer_sample_size ?? 0}
          loading={loading}
          error={error}
          retry={retry}
        />
        <MetricCard
          title="Offer acceptance rate"
          value={data?.offer_acceptance_rate ?? 0}
          suffix="%"
          sampleSize={data?.offer_sample_size ?? 0}
          loading={loading}
          error={error}
          retry={retry}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartFrame title="Applications by role" loading={loading} error={error} retry={retry} empty={noApplications || !data?.by_role.length}>
          <HorizontalBars
            label="Applications by role"
            items={(data?.by_role ?? []).map((role) => ({ label: role.title, value: role.applications }))}
          />
        </ChartFrame>
        <ChartFrame title="Conversion per role" loading={loading} error={error} retry={retry} empty={noApplications || !data?.by_role.length}>
          <div role="img" aria-label={`Conversion stages by role. ${(data?.by_role ?? []).map((role) => `${role.title}: ${role.applications} applications, ${role.shortlisted} shortlisted, ${role.offers} offers, ${role.accepted} accepted`).join('; ')}`} className="space-y-5">
            <p className="sr-only">Conversion stages per role: {(data?.by_role ?? []).map((role) => `${role.title}, ${role.applications} applications, ${role.shortlisted} shortlisted, ${role.offers} offers, ${role.accepted} accepted`).join('; ')}</p>
            {(data?.by_role ?? []).map((role) => {
              const lostBeforeShortlist = Math.max(0, role.applications - role.shortlisted)
              const shortlistedOnly = Math.max(0, role.shortlisted - role.offers)
              const offersNotAccepted = Math.max(0, role.offers - role.accepted)
              const values = [lostBeforeShortlist, shortlistedOnly, offersNotAccepted, role.accepted]
              const colors = ['bg-slate-300 dark:bg-slate-700', 'bg-indigo-400', 'bg-violet-500', 'bg-emerald-500']
              const denominator = Math.max(role.applications, 1)
              return (
                <div key={role.internship_id} title={`${role.title}: ${role.applications} applications, ${role.shortlisted} shortlisted, ${role.offers} offers, ${role.accepted} accepted`}>
                  <div className="mb-2 flex justify-between gap-2 text-xs"><span className="truncate text-slate-600 dark:text-slate-300">{role.title}</span><span className="font-semibold text-slate-800 dark:text-slate-200">{role.applications} applications</span></div>
                  <div className="flex h-5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    {values.map((value, index) => value > 0 ? <div key={index} className={colors[index]} style={{ width: `${(value / denominator) * 100}%` }} /> : null)}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500 dark:text-slate-400">
                    <span>Shortlisted {role.shortlisted}</span><span>Offers {role.offers}</span><span>Accepted {role.accepted}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </ChartFrame>
        <ChartFrame title="Application status" loading={loading} error={error} retry={retry} empty={noApplications || !data?.status_distribution.length}>
          <DonutChart label="Application status distribution" items={(data?.status_distribution ?? []).map(({ status, count }) => ({ label: status.replaceAll('_', ' '), value: count }))} />
        </ChartFrame>
        <ChartFrame title="Match score distribution" loading={loading} error={error} retry={retry} empty={noApplications || !data?.match_distribution_sample_size}>
          <div>
            <HorizontalBars label="Match score histogram" items={(data?.match_distribution ?? []).map(({ bucket, count }) => ({ label: `${bucket}%`, value: count }))} />
            <p className="mt-4 text-[10px] text-slate-500 dark:text-slate-400">
              Most recent {data?.match_distribution_sample_size ?? 0} applications; scores computed with compute_match.
            </p>
          </div>
        </ChartFrame>
        <ChartFrame title="Top skills: applicant skills vs role requirements" loading={loading} error={error} retry={retry} empty={!data?.top_skills.length}>
          <div role="img" aria-label={`Required skills and applicant counts. ${(data?.top_skills ?? []).map((item) => `${item.skill}: ${item.applicants} applicants, required by ${item.required_by_roles} roles`).join('; ')}`}>
            <p className="sr-only">{(data?.top_skills ?? []).map((item) => `${item.skill}: ${item.applicants} applicants, required by ${item.required_by_roles} roles`).join('; ')}</p>
            <div className="mb-4 flex gap-4 text-[10px] text-slate-500 dark:text-slate-400"><span>Applicants</span><span>Required roles</span></div>
            <div className="space-y-4">
              {(data?.top_skills ?? []).map((skill) => {
                const max = Math.max(skill.applicants, skill.required_by_roles, 1)
                return <div key={skill.skill} title={`${skill.skill}: ${skill.applicants} applicants; required by ${skill.required_by_roles} roles`}>
                  <div className="mb-1 flex justify-between text-xs"><span className="text-slate-700 dark:text-slate-300">{skill.skill}</span><span className="text-slate-500">{skill.applicants} / {skill.required_by_roles}</span></div>
                  <div className="space-y-1"><div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-2 rounded-full bg-indigo-500" style={{ width: `${(skill.applicants / max) * 100}%` }} /></div><div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-2 rounded-full bg-amber-500" style={{ width: `${(skill.required_by_roles / max) * 100}%` }} /></div></div>
                </div>
              })}
            </div>
          </div>
        </ChartFrame>
        <ChartFrame title="Top universities" loading={loading} error={error} retry={retry} empty={noApplications || !data?.top_universities.length}>
          <HorizontalBars label="Top universities by applicant volume" items={(data?.top_universities ?? []).map((item) => ({ label: item.university, value: item.applicants }))} />
        </ChartFrame>
      </div>
    </section>
  )
}

export function StudentInsightsCharts({ refreshKey = 0 }: { refreshKey?: number }) {
  const [data, setData] = useState<StudentInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const response = await api.get('/analytics/student/insights')
      if (!isStudentInsights(response.data)) throw new Error('Invalid student analytics response.')
      setData(response.data)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load, refreshKey])
  const retry = () => { void load() }
  const noApplications = Boolean(data && data.total_applications === 0)

  return (
    <section aria-label="Personal application insights" className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MetricCard title="Recruiter response rate" value={data?.response_rate ?? 0} suffix="%" sampleSize={data?.response_sample_size ?? 0} loading={loading} error={error} retry={retry} />
        <MetricCard title="Average match score" value={data?.avg_match_score ?? 0} suffix="%" sampleSize={data?.match_sample_size ?? 0} loading={loading} error={error} retry={retry} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartFrame title="Application status" loading={loading} error={error} retry={retry} empty={noApplications || !data?.status_distribution.length}>
          <DonutChart label="My application status distribution" items={(data?.status_distribution ?? []).map(({ status, count }) => ({ label: status.replaceAll('_', ' '), value: count }))} />
        </ChartFrame>
        <ChartFrame title="Applications per week" loading={loading} error={error} retry={retry} empty={noApplications}>
          <div role="img" aria-label={`Applications per week. ${(data?.weekly_applications ?? []).map((item) => `${item.week_start}: ${item.applications}`).join('; ')}`}>
            <p className="sr-only">Applications per week: {(data?.weekly_applications ?? []).map((item) => `${item.week_start}: ${item.applications}`).join('; ')}</p>
            <div className="flex h-[250px] items-end gap-2 border-b border-slate-200 px-1 dark:border-slate-700">
              {(data?.weekly_applications ?? []).map((item) => {
                const max = Math.max(...(data?.weekly_applications ?? []).map((week) => week.applications), 1)
                return <div key={item.week_start} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2" title={`${item.week_start}: ${item.applications} applications`}>
                  <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">{item.applications || ''}</span>
                  <div className="w-full rounded-t bg-indigo-500" style={{ height: `${Math.max(item.applications > 0 ? 3 : 0, (item.applications / max) * 78)}%` }} />
                  <span className="mb-2 text-[9px] text-slate-500">{new Date(`${item.week_start}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                </div>
              })}
            </div>
          </div>
        </ChartFrame>
        <ChartFrame title="Skills to learn" loading={loading} error={error} retry={retry} empty={!data?.skills_gap.length}>
          <ul aria-label="Skills to learn, ranked by missing application requirements" className="space-y-3">
            {(data?.skills_gap ?? []).map((skill) => (
              <li key={skill.skill} title={`${skill.skill} is missing from ${skill.missing_count} applied roles`} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5 text-xs dark:bg-slate-800/70">
                <span className="font-medium text-slate-800 dark:text-slate-200">{skill.skill}</span>
                <span className="shrink-0 text-slate-500 dark:text-slate-400">Missing in {skill.missing_count} roles</span>
              </li>
            ))}
          </ul>
        </ChartFrame>
        <MetricCard title="Average time to recruiter response" value={data?.avg_response_hours ?? 0} suffix=" hrs" sampleSize={data?.response_time_sample_size ?? 0} loading={loading} error={error} retry={retry} />
      </div>
    </section>
  )
}

function AnalyticsKpi({
  label,
  value,
  icon,
  detail,
  loading,
  error,
  onRetry,
}: AnalyticsKpiInput) {
  if (loading) return <KpiSkeleton className="h-full min-h-24" />
  return (
    <Card className="flex h-full min-h-24 min-w-0 flex-col justify-between gap-2 bg-white p-3.5 dark:bg-slate-900 sm:p-4">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="truncate text-[11px] font-semibold text-slate-500 dark:text-slate-400" title={label}>{label}</p>
        {icon && <span className="shrink-0 text-indigo-500">{icon}</span>}
      </div>
      {error ? (
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-slate-500">{error}</span>
          {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>}
        </div>
      ) : (
        <div className="min-w-0">
          <p className="truncate text-xl font-bold leading-tight text-slate-900 dark:text-white" title={typeof value === 'string' ? value : undefined}>{value}</p>
          {detail && <p className="mt-1 truncate text-[10px] text-slate-500 dark:text-slate-400" title={detail}>{detail}</p>}
        </div>
      )}
    </Card>
  )
}

function SelectedChartCard({
  title,
  loading,
  error,
  retry,
  empty,
  caption,
  children,
}: {
  title: string
  loading: boolean
  error: boolean
  retry: () => void
  empty: boolean
  caption: string
  children: ReactNode
}) {
  return (
    <Card className="min-w-0 space-y-3 bg-white p-4 dark:bg-slate-900 sm:p-5">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h3 className="truncate text-sm font-bold text-slate-900 dark:text-white" title={title}>{title}</h3>
      </div>
      {loading ? <ChartSkeleton className="border-0 bg-transparent p-0 dark:bg-transparent" /> : error ? (
        <div className="flex min-h-36 flex-col items-center justify-center gap-3 text-center text-xs text-slate-500 dark:text-slate-400">
          <p>Couldn't load this chart.</p>
          <Button size="sm" variant="outline" onClick={retry}>Retry</Button>
        </div>
      ) : empty ? (
        <div className="flex min-h-36 items-center justify-center rounded-xl border border-dashed border-slate-200 px-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No data to display yet. Your chart will appear as activity comes in.
        </div>
      ) : <div className="min-w-0">{children}</div>}
      <p className="sr-only">{caption}</p>
    </Card>
  )
}

function eightWeekSeries(data: StudentInsights | null): ChartDatum[] {
  const now = new Date()
  const currentMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const weekday = currentMonday.getUTCDay() || 7
  currentMonday.setUTCDate(currentMonday.getUTCDate() - weekday + 1)
  const values = new Map((data?.weekly_applications ?? []).map((item) => [item.week_start, item.applications]))
  return Array.from({ length: 8 }, (_, index) => {
    const week = new Date(currentMonday)
    week.setUTCDate(week.getUTCDate() - (7 - index) * 7)
    const key = week.toISOString().slice(0, 10)
    return {
      label: week.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      value: values.get(key) ?? 0,
      detail: key,
    }
  })
}

function dateRangeLabel(range: '30' | '90' | 'all') {
  return range === 'all' ? 'All time' : `Last ${range} days`
}

export function RoleAnalyticsCharts({
  variant,
  chart,
  range = '30',
  refreshKey = 0,
  extraKpis = [],
}: RoleAnalytics) {
  const [companyData, setCompanyData] = useState<CompanyPerformance | null>(null)
  const [studentData, setStudentData] = useState<StudentInsights | null>(null)
  const [userGrowth, setUserGrowth] = useState<Array<{ period: string; students: number; companies: number; admins: number }>>([])
  const [adminActions, setAdminActions] = useState<Array<{ period: string; action: string; count: number }>>([])
  const [companyLoading, setCompanyLoading] = useState(variant === 'company')
  const [companyError, setCompanyError] = useState(false)
  const [studentLoading, setStudentLoading] = useState(variant === 'student')
  const [studentError, setStudentError] = useState(false)
  const [growthLoading, setGrowthLoading] = useState(variant === 'admin')
  const [growthError, setGrowthError] = useState(false)
  const [actionsLoading, setActionsLoading] = useState(variant === 'admin')
  const [actionsError, setActionsError] = useState(false)

  const loadCompany = useCallback(async () => {
    setCompanyLoading(true)
    setCompanyError(false)
    try {
      const response = await api.get(`/analytics/company/performance?range=${range}`)
      if (!isCompanyPerformance(response.data)) throw new Error('Invalid company analytics response.')
      setCompanyData(response.data)
    } catch {
      setCompanyError(true)
    } finally {
      setCompanyLoading(false)
    }
  }, [range])

  const loadStudent = useCallback(async () => {
    setStudentLoading(true)
    setStudentError(false)
    try {
      const response = await api.get('/analytics/student/insights')
      if (!isStudentInsights(response.data)) throw new Error('Invalid student analytics response.')
      setStudentData(response.data)
    } catch {
      setStudentError(true)
    } finally {
      setStudentLoading(false)
    }
  }, [])

  const loadGrowth = useCallback(async () => {
    setGrowthLoading(true)
    setGrowthError(false)
    try {
      const response = await api.get('/analytics/admin/user-growth?granularity=month&periods=6')
      setUserGrowth(Array.isArray(response.data) ? response.data : [])
    } catch {
      setGrowthError(true)
    } finally {
      setGrowthLoading(false)
    }
  }, [])

  const loadActions = useCallback(async () => {
    setActionsLoading(true)
    setActionsError(false)
    try {
      const response = await api.get('/analytics/admin/admin-action-volume?days=14')
      setAdminActions(Array.isArray(response.data) ? response.data : [])
    } catch {
      setActionsError(true)
    } finally {
      setActionsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (variant === 'company') void loadCompany()
    if (variant === 'student') void loadStudent()
    if (variant === 'admin') {
      void loadGrowth()
      void loadActions()
    }
  }, [variant, refreshKey, loadCompany, loadStudent, loadGrowth, loadActions])

  const companyRetry = () => { void loadCompany() }
  const studentRetry = () => { void loadStudent() }
  const growthRetry = () => { void loadGrowth() }
  const actionsRetry = () => { void loadActions() }
  const studentWeeks = eightWeekSeries(studentData)

  const companyKpis: AnalyticsKpiInput[] = [
    { label: 'Applications', value: companyData?.total_applications ?? 0, icon: <FileText className="h-4 w-4" />, detail: `Sample size: ${companyData?.total_applications ?? 0}` },
    { label: 'Time to first response', value: formatDuration(companyData?.time_metrics.avg_hours_to_first_response ?? 0), icon: <Clock className="h-4 w-4" />, detail: `Sample size: ${companyData?.time_metrics.sample_size ?? 0}` },
    { label: 'Time to hire', value: `${companyData?.time_metrics.avg_days_to_offer ?? 0} d`, icon: <Activity className="h-4 w-4" />, detail: `Sample size: ${companyData?.time_metrics.offer_sample_size ?? 0}` },
    { label: 'Offer acceptance', value: `${companyData?.offer_acceptance_rate ?? 0}%`, icon: <Award className="h-4 w-4" />, detail: `Sample size: ${companyData?.offer_sample_size ?? 0}` },
    { label: 'Interviews', value: companyData ? Object.values(companyData.interview_outcomes).reduce((total, count) => total + count, 0) : 0, icon: <Users className="h-4 w-4" /> },
  ].map((item) => ({ ...item, loading: companyLoading, error: companyError ? "Couldn't load." : undefined, onRetry: companyRetry }))

  const studentKpis: AnalyticsKpiInput[] = [
    //{ label: 'Response rate', value: `${studentData?.response_rate ?? 0}%`, icon: <Activity className="h-4 w-4" />, detail: `Sample size: ${studentData?.response_sample_size ?? 0}` },
    { label: 'Average match score', value: `${studentData?.avg_match_score ?? 0}%`, icon: <Award className="h-4 w-4" />, detail: `Sample size: ${studentData?.match_sample_size ?? 0}` },
    //{ label: 'Recruiter response time', value: formatDuration(studentData?.avg_response_hours ?? 0), icon: <Clock className="h-4 w-4" />, detail: `Sample size: ${studentData?.response_time_sample_size ?? 0}` },
  ].map((item) => ({ ...item, loading: studentLoading, error: studentError ? "Couldn't load." : undefined, onRetry: studentRetry }))

  const totalAdminActions = adminActions.reduce((sum, item) => sum + item.count, 0)
  const latestGrowth = userGrowth[userGrowth.length - 1]
  const adminKpis: AnalyticsKpiInput[] = [
    { label: 'Users signed up', value: latestGrowth ? latestGrowth.students + latestGrowth.companies + latestGrowth.admins : 0, icon: <Users className="h-4 w-4" />, detail: latestGrowth?.period ?? 'Most recent month', loading: growthLoading, error: growthError ? "Couldn't load." : undefined, onRetry: growthRetry },
    { label: 'Student signups', value: latestGrowth?.students ?? 0, icon: <Users className="h-4 w-4" />, detail: latestGrowth?.period ?? 'Most recent month', loading: growthLoading, error: growthError ? "Couldn't load." : undefined, onRetry: growthRetry },
    { label: 'Company signups', value: latestGrowth?.companies ?? 0, icon: <Briefcase className="h-4 w-4" />, detail: latestGrowth?.period ?? 'Most recent month', loading: growthLoading, error: growthError ? "Couldn't load." : undefined, onRetry: growthRetry },
    { label: 'Admin actions', value: totalAdminActions, icon: <ShieldCheck className="h-4 w-4" />, detail: 'Sample size: last 14 days', loading: actionsLoading, error: actionsError ? "Couldn't load." : undefined, onRetry: actionsRetry },
  ]

  const visibleCompanyKpis = extraKpis.some((item) => item.label === 'Total applications')
    ? companyKpis.filter((item) => item.label !== 'Applications')
    : companyKpis
  const kpis = [...extraKpis, ...(variant === 'company' ? visibleCompanyKpis : variant === 'student' ? studentKpis : adminKpis)]
  const isSpecialChart = chart !== 'funnel' && chart !== 'trends' && chart !== 'domains' && chart !== 'market'
  const highlights = variant === 'student'
    ? (studentData?.skills_gap ?? []).slice(0, 3).map((item) => ({ label: item.skill, detail: `Missing in ${item.missing_count} roles` }))
    : variant === 'company'
      ? (companyData?.top_skills ?? []).slice(0, 3).map((item) => ({ label: item.skill, detail: `${item.applicants} applicants · required by ${item.required_by_roles} roles` }))
      : Array.from(adminActions.reduce((map, item) => map.set(item.action, (map.get(item.action) ?? 0) + item.count), new Map<string, number>()), ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 3).map((item) => ({ label: item.label, detail: `${item.value} actions · last 14 days` }))

  let chartTitle = ''
  let chartLoading = false
  let chartError = false
  let chartRetry = () => { }
  let empty = false
  let caption = ''
  let chartContent: ReactNode = null

  if (variant === 'company') {
    chartLoading = companyLoading
    chartError = companyError
    chartRetry = companyRetry
    const roles = companyData?.by_role ?? []
    const statuses = (companyData?.status_distribution ?? []).map(({ status, count }) => ({ label: status.replaceAll('_', ' '), value: count }))
    const hasApps = (companyData?.total_applications ?? 0) > 0
    caption = `Sample size: ${companyData?.total_applications ?? 0} applications · ${dateRangeLabel(range)}`
    if (chart === 'applications_by_role') {
      chartTitle = 'Applications by role'
      empty = !roles.length
      chartContent = <ResponsiveBars label="Applications by role" items={roles.map((role) => ({ label: role.title, value: role.applications }))} />
    } else if (chart === 'conversion_role') {
      chartTitle = 'Conversion per role'
      empty = !roles.length
      chartContent = <ResponsiveStackedBars label="Conversion stages per role" items={roles.map((role) => ({ label: role.title, values: [Math.max(0, role.applications - role.shortlisted), Math.max(0, role.shortlisted - role.offers), Math.max(0, role.offers - role.accepted), role.accepted] }))} series={[
        { label: 'Not shortlisted', color: '#cbd5e1' },
        { label: 'Shortlisted', color: '#818cf8' },
        { label: 'Offer pending', color: '#8b5cf6' },
        { label: 'Accepted', color: '#10b981' },
      ]} />
    } else if (chart === 'status_mix') {
      chartTitle = 'Status mix'
      empty = !hasApps || !statuses.length
      chartContent = <ResponsiveDonut label="Application status mix" items={statuses} />
    } else if (chart === 'match_distribution') {
      chartTitle = 'Match-score distribution'
      empty = !companyData?.match_distribution_sample_size
      chartContent = <ResponsiveBars label="Match-score distribution histogram" items={(companyData?.match_distribution ?? []).map((item) => ({ label: item.bucket, value: item.count }))} orientation="vertical" />
      caption = `Sample size: ${companyData?.match_distribution_sample_size ?? 0} most recent applications (compute_match) · ${dateRangeLabel(range)}`
    } else if (chart === 'skills_required') {
      chartTitle = 'Top skills vs required'
      empty = !companyData?.top_skills.length
      chartContent = <ResponsiveStackedBars label="Applicant skills compared with role requirements" items={(companyData?.top_skills ?? []).map((item) => ({ label: item.skill, values: [item.applicants, item.required_by_roles] }))} series={[{ label: 'Applicants', color: '#4f46e5' }, { label: 'Required roles', color: '#f59e0b' }]} />
    } else if (chart === 'top_universities') {
      chartTitle = 'Top universities'
      empty = !companyData?.top_universities.length
      chartContent = <ResponsiveBars label="Top universities by applicant count" items={(companyData?.top_universities ?? []).map((item) => ({ label: item.university, value: item.applicants }))} />
    } else if (chart === 'interview_outcomes') {
      chartTitle = 'Interview outcomes'
      const outcomes = companyData?.interview_outcomes
      const items = outcomes ? [{ label: 'Scheduled', value: outcomes.scheduled }, { label: 'Completed', value: outcomes.completed }, { label: 'Cancelled', value: outcomes.cancelled }] : []
      empty = !items.some((item) => item.value > 0)
      chartContent = <ResponsiveDonut label="Interview outcomes" items={items} />
    } else if (chart === 'offer_acceptance') {
      chartTitle = 'Offer acceptance'
      const accepted = roles.reduce((sum, role) => sum + role.accepted, 0)
      const offers = roles.reduce((sum, role) => sum + role.offers, 0)
      empty = offers === 0
      chartContent = <ResponsiveDonut label="Offer acceptance outcomes" items={[{ label: 'Accepted', value: accepted }, { label: 'Not accepted', value: Math.max(0, offers - accepted) }]} />
    } else if (chart === 'response_time' || chart === 'time_to_hire') {
      const isResponse = chart === 'response_time'
      chartTitle = isResponse ? 'Time to first response' : 'Time to hire'
      const metric = isResponse ? companyData?.time_metrics.avg_hours_to_first_response ?? 0 : (companyData?.time_metrics.avg_days_to_offer ?? 0) * 24
      const size = isResponse ? companyData?.time_metrics.sample_size ?? 0 : companyData?.time_metrics.offer_sample_size ?? 0
      empty = size === 0
      chartContent = <ResponsiveBars label={chartTitle} items={[{ label: chartTitle, value: metric, detail: formatDuration(metric) }]} />
      caption = `Sample size: ${size} · ${dateRangeLabel(range)}`
    }
  } else if (variant === 'student') {
    chartLoading = studentLoading
    chartError = studentError
    chartRetry = studentRetry
    const statuses = (studentData?.status_distribution ?? []).map(({ status, count }) => ({ label: status.replaceAll('_', ' '), value: count }))
    const hasApps = (studentData?.total_applications ?? 0) > 0
    caption = `Sample size: ${studentData?.total_applications ?? 0} applications · Last 8 weeks`
    if (chart === 'status_mix') {
      chartTitle = 'Status mix'
      empty = !hasApps || !statuses.length
      chartContent = <ResponsiveDonut label="My application status distribution" items={statuses} />
    } else if (chart === 'applications_week') {
      chartTitle = 'Applications per week'
      empty = !hasApps
      chartContent = <ResponsiveBars label="Applications per week, including weeks with zero applications" items={studentWeeks} orientation="vertical" />
    } else if (chart === 'skills_gap') {
      chartTitle = 'Skills to learn'
      empty = !studentData?.skills_gap.length
      chartContent = <ResponsiveBars label="Skills to learn by number of roles where each skill is missing" items={(studentData?.skills_gap ?? []).map((item) => ({ label: item.skill, value: item.missing_count, detail: `Missing in ${item.missing_count} roles` }))} />
    } else if (chart === 'response_rate') {
      chartTitle = 'Recruiter response rate'
      empty = (studentData?.response_sample_size ?? 0) === 0
      chartContent = <ResponsiveBars label="Recruiter response rate" items={[{ label: 'Recruiter responses', value: studentData?.response_rate ?? 0, detail: `${studentData?.responded_applications ?? 0} of ${studentData?.response_sample_size ?? 0} applications` }]} />
      caption = `Sample size: ${studentData?.response_sample_size ?? 0} applications · All time`
    } else if (chart === 'match_score') {
      chartTitle = 'Average match score'
      empty = (studentData?.match_sample_size ?? 0) === 0
      chartContent = <ResponsiveBars label="Average match score percentage" items={[{ label: 'Average match score', value: studentData?.avg_match_score ?? 0 }]} />
      caption = `Sample size: ${studentData?.match_sample_size ?? 0} applications · All time`
    } else if (chart === 'response_time') {
      chartTitle = 'Time to first response'
      empty = (studentData?.response_time_sample_size ?? 0) === 0
      chartContent = <ResponsiveBars label="Average recruiter response time" items={[{ label: 'Average response', value: studentData?.avg_response_hours ?? 0, detail: formatDuration(studentData?.avg_response_hours ?? 0) }]} />
      caption = `Sample size: ${studentData?.response_time_sample_size ?? 0} applications · All time`
    } else if (chart === 'activity') {
      chartTitle = 'Activity trends'
      empty = !hasApps
      chartContent = <ResponsiveLineChart label="Weekly application activity" series={[{ label: 'Applications', values: studentWeeks, color: '#4f46e5' }]} />
    }
  } else if (variant === 'admin') {
    const growth = userGrowth
    const actionsByType = Array.from(adminActions.reduce((map, item) => map.set(item.action, (map.get(item.action) ?? 0) + item.count), new Map<string, number>()), ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
    const adminLoading = chart === 'admin_actions' ? actionsLoading : growthLoading
    const adminError = chart === 'admin_actions' ? actionsError : growthError
    chartLoading = adminLoading
    chartError = adminError
    chartRetry = chart === 'admin_actions' ? actionsRetry : growthRetry
    caption = chart === 'admin_actions' ? `Sample size: ${totalAdminActions} actions · Last 14 days` : `Sample size: ${growth.reduce((sum, item) => sum + item.students + item.companies + item.admins, 0)} signups · Last 6 months`
    if (chart === 'user_growth') {
      chartTitle = 'User growth'
      empty = !growth.length
      chartContent = <ResponsiveLineChart label="Monthly user growth by account type" series={[
        { label: 'Students', values: growth.map((item) => ({ label: item.period, value: item.students })), color: '#4f46e5' },
        { label: 'Companies', values: growth.map((item) => ({ label: item.period, value: item.companies })), color: '#10b981' },
        { label: 'Admins', values: growth.map((item) => ({ label: item.period, value: item.admins })), color: '#f59e0b' },
      ]} />
    } else if (chart === 'admin_actions') {
      chartTitle = 'Admin action volume by action'
      empty = !actionsByType.length
      chartContent = <ResponsiveBars label="Admin action volume aggregated by action" items={actionsByType} />
    }
  }

  return (
    <section aria-label={`${variant} analytics`} className="min-w-0 space-y-4">
      <div className="grid grid-cols-2 items-stretch gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi, index) => <AnalyticsKpi key={`${kpi.label}-${index}`} {...kpi} />)}
      </div>
      {isSpecialChart && chartTitle && (
        <SelectedChartCard
          title={chartTitle}
          loading={chartLoading}
          error={chartError}
          retry={chartRetry}
          empty={!chartLoading && !chartError && empty}
          caption={caption}
        >
          {chartContent}
        </SelectedChartCard>
      )}
      {highlights.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Highlights</h3>
          <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2">
            {highlights.map((item) => (
              <Card key={item.label} title={`${item.label} · ${item.detail}`} className="flex min-h-20 min-w-0 flex-col justify-center gap-1.5 bg-white p-3.5 dark:bg-slate-900">
                <span className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200">{item.label}</span>
                <span className="truncate text-[10px] text-slate-500 dark:text-slate-400">{item.detail}</span>
              </Card>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
