import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Building2, BriefcaseBusiness, GraduationCap, Handshake, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { routes } from '../../lib/routes'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { CardSkeleton } from '../ui/LoadingSkeleton'

interface SummaryCount {
  name: string
  count: number
}

interface PublicSummary {
  live_internships: number
  verified_companies: number
  registered_students: number
  offers_made: number
  openings_by_field: SummaryCount[]
  openings_by_work_mode: SummaryCount[]
  updated_at: string
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isCountList(value: unknown): value is SummaryCount[] {
  return Array.isArray(value) && value.every((item) =>
    typeof item === 'object'
    && item !== null
    && 'name' in item
    && typeof item.name === 'string'
    && item.name.length > 0
    && 'count' in item
    && isCount(item.count),
  )
}

function isPublicSummary(value: unknown): value is PublicSummary {
  if (typeof value !== 'object' || value === null) return false
  if (!('live_internships' in value) || !isCount(value.live_internships)) return false
  if (!('verified_companies' in value) || !isCount(value.verified_companies)) return false
  if (!('registered_students' in value) || !isCount(value.registered_students)) return false
  if (!('offers_made' in value) || !isCount(value.offers_made)) return false
  if (!('openings_by_field' in value) || !isCountList(value.openings_by_field)) return false
  if (!('openings_by_work_mode' in value) || !isCountList(value.openings_by_work_mode)) return false
  return 'updated_at' in value
    && typeof value.updated_at === 'string'
    && Number.isFinite(Date.parse(value.updated_at))
}

const summaryStats = [
  { key: 'live_internships', label: 'Live internships', icon: BriefcaseBusiness },
  { key: 'verified_companies', label: 'Verified companies', icon: Building2 },
  { key: 'registered_students', label: 'Students joined', icon: GraduationCap },
  { key: 'offers_made', label: 'Offers made', icon: Handshake },
] as const

function SummaryList({ title, items }: { title: string; items: SummaryCount[] }) {
  const maximum = Math.max(...items.map((item) => item.count), 1)

  return (
    <Card className="p-5 dark:bg-slate-900">
      <h3 className="font-bold text-slate-900 dark:text-white">{title}</h3>
      {items.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={item.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
              <span className="truncate text-sm text-slate-700 dark:text-slate-300">{item.name}</span>
              <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{item.count}</span>
              <span className="col-span-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <span
                  aria-hidden="true"
                  className="block h-full rounded-full bg-indigo-500"
                  style={{ width: `${Math.max(4, (item.count / maximum) * 100)}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No open roles to show.</p>
      )}
    </Card>
  )
}

export function GuestInsights() {
  const [summary, setSummary] = useState<PublicSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const requestController = useRef<AbortController | null>(null)

  const loadSummary = useCallback(async (controller: AbortController) => {
    try {
      const response = await api.get<unknown>('/analytics/public-summary', { signal: controller.signal })
      if (controller.signal.aborted) return
      if (!isPublicSummary(response.data)) throw new Error('Public analytics response was malformed.')
      setSummary(response.data)
      setError(false)
    } catch (requestError) {
      if (controller.signal.aborted) return
      console.error('Unable to load public platform summary.', requestError)
      setError(true)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    requestController.current = controller
    void loadSummary(controller)
    return () => controller.abort()
  }, [loadSummary])

  const refreshSummary = () => {
    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    setLoading(true)
    setError(false)
    void loadSummary(controller)
  }

  const updatedTime = summary
    ? new Date(summary.updated_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <section aria-labelledby="guest-insights-title" aria-busy={loading} className="w-full scroll-mt-24 bg-white py-14 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">InternSphere at a glance</p>
            <h2 id="guest-insights-title" className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white">Platform insights</h2>
          </div>
          <div className="flex items-center gap-3">
            {updatedTime && !loading && (
              <p className="text-xs text-slate-500 dark:text-slate-400">Updated {updatedTime}</p>
            )}
            <Button type="button" variant="outline" size="sm" onClick={refreshSummary} disabled={loading} leftIcon={<RefreshCw className="h-3.5 w-3.5" />}>
              Refresh
            </Button>
          </div>
        </div>

        {error ? (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Platform insights could not be loaded.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={refreshSummary}>Retry</Button>
            </div>
          </div>
        ) : loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {summaryStats.map((stat) => <CardSkeleton key={stat.key} />)}
            <div className="sm:col-span-2"><CardSkeleton /></div>
            <div className="sm:col-span-2"><CardSkeleton /></div>
          </div>
        ) : summary ? (
          <>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {summaryStats.map(({ key, label, icon: Icon }) => (
                <Card key={key} className="p-5 dark:bg-slate-900">
                  <dt className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400">
                    <Icon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    {label}
                  </dt>
                  <dd className="mt-3 text-3xl font-bold tabular-nums text-slate-900 dark:text-white">{summary[key]}</dd>
                </Card>
              ))}
            </dl>

            {summary.live_internships === 0 && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 p-4 dark:border-slate-700">
                <p className="text-sm text-slate-700 dark:text-slate-300">No internships are open right now</p>
                <Link to={routes.companyRegister} className="text-sm font-semibold text-indigo-700 underline underline-offset-2 dark:text-indigo-300">
                  Register your company
                </Link>
              </div>
            )}

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <SummaryList title="Open roles by field" items={summary.openings_by_field} />
              <SummaryList title="Open roles by work mode" items={summary.openings_by_work_mode} />
            </div>
          </>
        ) : null}
      </div>
    </section>
  )
}
