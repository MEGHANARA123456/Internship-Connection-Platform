import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { auditActionLabel } from '../../lib/auditActionLabels'
import { ChartLegend, type ChartLegendItem } from '../charts/ChartLegend'
import { assignColors } from '../charts/chartColors'
import { routes } from '../../lib/routes'

export interface ChartDatum {
  name: string
  count: number
  conversion_pct?: number | null
  date?: string
  applications?: number
  interviews?: number
  offers?: number
  students?: number
  companies?: number
  action?: string
  fullName?: string
  days?: number
  median_days?: number | null
  have?: number
  missing?: number
  url?: string
  applications_count?: number
  [key: string]: string | number | null | undefined
}

function CategoryAxisTick({ x = 0, y = 0, payload, formatValue, textAnchor = 'end' }: {
  x?: number
  y?: number
  payload?: { value?: unknown }
  formatValue?: (value: string) => string
  textAnchor?: 'start' | 'middle' | 'end'
}) {
  const rawName = String(payload?.value ?? '')
  const fullName = formatValue ? formatValue(rawName) : rawName
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{fullName}</title>
      <text x={0} y={0} dy={4} textAnchor={textAnchor} fill="var(--analytics-axis, #64748b)" fontSize={11}>{truncateLabel(fullName)}</text>
    </g>
  )
}

export type AnalyticsChartKind =
  | 'funnel' | 'trends' | 'status' | 'domains' | 'work_modes' | 'match_score'
  | 'company_pipeline' | 'applicants_by_posting' | 'applications_over_time' | 'top_skills'
  | 'signups_over_time' | 'admin_applications_over_time' | 'internships_by_status'
  | 'admin_actions_by_type' | 'verification_status' | 'top_domains'
  | 'status_over_time' | 'response_times' | 'skill_gap' | 'activity_calendar'
  | 'top_companies' | 'stipend_distribution' | 'duration_distribution' | 'upcoming_deadlines'
  | 'conversion_by_role' | 'top_universities' | 'interview_outcomes'

const MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const STATUS_SERIES = ['applied', 'under_review', 'shortlisted', 'interview', 'selected', 'accepted', 'rejected', 'withdrawn']
const ROLE_SERIES = ['applied', 'under_review', 'shortlisted', 'interview_scheduled', 'selected', 'accepted']
const STATUS_LABELS: Record<string, string> = {
  applied: 'Applied',
  under_review: 'Under review',
  shortlisted: 'Shortlisted',
  interview: 'Interview',
  interview_scheduled: 'Interview scheduled',
  selected: 'Selected',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

function statusLabel(value: string) {
  return STATUS_LABELS[value.toLowerCase().replaceAll(' ', '_')] ?? value
}
const RANKED_BAR_KINDS: AnalyticsChartKind[] = [
  'domains',
  'applicants_by_posting',
  'top_skills',
  'skill_gap',
  'top_companies',
  'conversion_by_role',
  'top_universities',
  'admin_actions_by_type',
  'top_domains',
]

function categoryLabel(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  return trimmed
    .toLowerCase()
    .replace(/\b(gdpr|ai|ml)\b/gi, (acronym) => acronym.toUpperCase())
    .replace(/(^|[\s&/-])([a-z])/g, (_match, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`)
}

function truncateLabel(value: string): string {
  return value.length > 22 ? `${value.slice(0, 21).trimEnd()}…` : value
}

function rankedRows(kind: AnalyticsChartKind, rows: ChartDatum[]): ChartDatum[] {
  if (!RANKED_BAR_KINDS.includes(kind)) return rows
  const normalized = new Map<string, ChartDatum>()
  for (const row of rows) {
    const sourceName = row.fullName ?? row.name
    const displayName = kind === 'admin_actions_by_type'
      ? auditActionLabel(row.action ?? row.name)
      : categoryLabel(row.name)
    const key = displayName.toLocaleLowerCase()
    const current = normalized.get(key)
    if (current) {
      for (const [field, value] of Object.entries(row)) {
        if (field !== 'count' && typeof value === 'number') {
          current[field] = Number(current[field] ?? 0) + value
        }
      }
      current.count += row.count
      if (sourceName !== current.fullName) {
        current.fullName = [current.fullName, sourceName].filter(Boolean).join(', ')
      }
    } else normalized.set(key, { ...row, name: displayName, fullName: sourceName, count: row.count })
  }
  const result = [...normalized.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
  const seen = new Set<string>()
  return result.map((row) => {
    const base = truncateLabel(row.name)
    let name = base
    let suffix = 2
    while (seen.has(name.toLocaleLowerCase())) {
      const marker = ` (${suffix++})`
      name = `${base.slice(0, Math.max(1, 22 - marker.length)).trimEnd()}${marker}`
    }
    seen.add(name.toLocaleLowerCase())
    return { ...row, name }
  })
}

function dateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color?: string; payload?: ChartDatum }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const firstRow = payload[0]?.payload
  const readableLabel = firstRow
    ? (firstRow.action ? auditActionLabel(firstRow.action) : firstRow.fullName ?? label ?? firstRow.name)
    : label
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
      {readableLabel && <p className="mb-1 break-words font-semibold text-slate-900 dark:text-white">{readableLabel}</p>}
      {payload.map((item) => (
        <p key={item.name} className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
          <span>{item.name}:</span>
          <strong>{item.value.toLocaleString()}</strong>
          {item.payload?.conversion_pct != null && (
            <span>({item.payload.conversion_pct}% of prior stage)</span>
          )}
        </p>
      ))}
    </div>
  )
}

function reducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(MOTION_QUERY).matches
}

function ChartTable({ label, rows, kind }: { label: string; rows: ChartDatum[]; kind: AnalyticsChartKind }) {
  const domainSeries = kind === 'domains' || kind === 'top_domains'
  const signupSeries = kind === 'signups_over_time'
  const trendSeries = kind === 'trends' || kind === 'activity_calendar'
  const statusSeries = kind === 'status_over_time'
  const skillSeries = kind === 'skill_gap'
  const responseSeries = kind === 'response_times'
  const deadlineSeries = kind === 'upcoming_deadlines'
  const stackedCompanySeries = kind === 'top_companies'
  const stackedRoleSeries = kind === 'conversion_by_role'
  const statusColumns = ['applied', 'under_review', 'shortlisted', 'interview', 'selected', 'accepted', 'rejected', 'withdrawn']
  const columns = signupSeries
    ? ['students', 'companies']
    : kind === 'trends'
      ? ['applications', 'interviews', 'offers']
      : trendSeries
      ? ['applications', 'interviews']
      : kind === 'applications_over_time' || kind === 'admin_applications_over_time'
        ? ['count']
      : statusSeries || stackedCompanySeries
        ? statusColumns
        : stackedRoleSeries
          ? ['applied', 'under_review', 'shortlisted', 'interview_scheduled', 'selected', 'accepted']
        : skillSeries
          ? ['have', 'missing']
          : responseSeries
            ? ['days', 'median_days']
            : []
  const firstColumnLabel = deadlineSeries
    ? 'Role'
    : signupSeries || trendSeries || statusSeries || kind === 'applications_over_time' || kind === 'admin_applications_over_time'
      ? 'Date'
      : 'Category'
  return (
    <div className="max-h-[290px] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">{label} data</caption>
        <thead className="sticky top-0 bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <tr>
            <th scope="col" className="px-3 py-2">{firstColumnLabel}</th>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-3 py-2 text-right">
                {column === 'under_review' ? 'Under review' : column === 'days' ? 'Days to response' : column === 'median_days' ? 'Median days' : column === 'have' ? 'You have it' : column === 'missing' ? 'Missing' : column.charAt(0).toUpperCase() + column.slice(1)}
              </th>
            ))}
            {(signupSeries || trendSeries || statusSeries || stackedCompanySeries || stackedRoleSeries) && <th scope="col" className="px-3 py-2 text-right">Total</th>}
            {skillSeries && <th scope="col" className="px-3 py-2 text-right">Required roles</th>}
            {deadlineSeries && <th scope="col" className="px-3 py-2 text-right">Deadline</th>}
            {!columns.length && !deadlineSeries && <th scope="col" className="px-3 py-2 text-right">Count</th>}
            {(kind === 'funnel' || kind === 'company_pipeline') && <th scope="col" className="px-3 py-2 text-right">Of previous stage</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-t border-slate-100 dark:border-slate-800">
              <th scope="row" className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200" title={row.fullName ?? row.name}>{deadlineSeries && row.url ? <Link to={row.url} className="underline hover:text-indigo-600 dark:hover:text-indigo-300">{row.name}</Link> : kind === 'admin_actions_by_type' ? auditActionLabel(row.action ?? row.name) : domainSeries ? row.fullName ?? row.name : row.fullName ?? row.name}</th>
              {columns.map((column) => {
                const value = column === 'applications' ? row.applications ?? row.count ?? 0
                  : column === 'interviews' ? row.interviews ?? 0
                    : Number(row[column] ?? 0)
                return <td key={column} className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{value.toLocaleString()}</td>
              })}
              {(signupSeries || trendSeries || statusSeries || stackedCompanySeries || stackedRoleSeries) && (
                <td className="px-3 py-2 text-right tabular-nums">
                  {signupSeries
                    ? ((row.students ?? 0) + (row.companies ?? 0)).toLocaleString()
                    : kind === 'trends'
                      ? ((row.applications ?? 0) + (row.interviews ?? 0) + (row.offers ?? 0)).toLocaleString()
                      : (row.count ?? 0).toLocaleString()}
                </td>
              )}
              {skillSeries && <td className="px-3 py-2 text-right tabular-nums">{(row.count ?? 0).toLocaleString()}</td>}
              {deadlineSeries && <td className="px-3 py-2 text-right tabular-nums">{row.date ?? '-'}</td>}
              {!columns.length && !deadlineSeries && <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{(row.count ?? 0).toLocaleString()}</td>}
              {(kind === 'funnel' || kind === 'company_pipeline') && (
                <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">
                  {row.conversion_pct == null ? '-' : `${row.conversion_pct}%`}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function RechartsAnalyticsCharts({
  kind,
  label,
  rows,
  viewAsTable,
  summaryNote = '',
}: {
  kind: AnalyticsChartKind
  label: string
  rows: ChartDatum[]
  viewAsTable: boolean
  summaryNote?: string
}) {
  const navigate = useNavigate()
  const [hiddenItems, setHiddenItems] = useState<string[]>([])
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const displayRows = rankedRows(kind, rows)
  if (viewAsTable) return <ChartTable label={label} rows={displayRows} kind={kind} />

  const summary = [displayRows.map((row) => `${row.fullName ?? row.name}: ${row.count}`).join('; '), summaryNote].filter(Boolean).join('. ')
  const animation = !reducedMotion()
  const tickColor = 'var(--analytics-axis, #64748b)'
  const gridColor = 'var(--analytics-grid, #e2e8f0)'
  const chartSeriesKeys = kind === 'top_companies' || kind === 'status_over_time'
    ? STATUS_SERIES
    : kind === 'conversion_by_role'
      ? ROLE_SERIES
      : kind === 'skill_gap'
        ? ['You have it', 'Missing']
        : kind === 'response_times'
          ? ['Applications', 'Median']
          : kind === 'activity_calendar'
            ? ['Applications', 'Interviews']
            : kind === 'signups_over_time'
              ? ['Students', 'Companies']
              : kind === 'trends'
                ? ['Applications', 'Interview-stage applications', 'Offers']
                : kind === 'applications_over_time' || kind === 'admin_applications_over_time' || kind === 'funnel' || kind === 'company_pipeline'
                  ? ['Applications']
                  : []
  const chartColors = assignColors([
    ...displayRows.map((row) => row.fullName ?? row.name),
    ...chartSeriesKeys,
  ])
  const colorForKey = (key: string) => chartColors[key]
  const seriesConfig: ChartLegendItem[] = kind === 'response_times'
    ? [{ id: 'days', label: 'Days to first response', color: colorForKey('Applications'), shape: 'square' as const }]
    : kind === 'skill_gap'
      ? [{ id: 'have', label: 'You have it', color: colorForKey('You have it'), shape: 'square' as const }, { id: 'missing', label: 'Missing', color: colorForKey('Missing'), shape: 'square' as const }]
      : kind === 'top_companies'
        ? STATUS_SERIES.map((key) => ({ id: key, label: statusLabel(key), color: colorForKey(key), shape: 'square' as const }))
        : kind === 'conversion_by_role'
          ? ROLE_SERIES.map((key) => ({ id: key, label: statusLabel(key), color: colorForKey(key), shape: 'square' as const }))
          : kind === 'status_over_time'
              ? STATUS_SERIES.map((key) => ({ id: key, label: statusLabel(key), color: colorForKey(key), shape: 'square' as const }))
              : kind === 'activity_calendar'
                ? [
                  { id: 'applications', label: 'Applications', color: colorForKey('Applications'), value: displayRows.reduce((sum, row) => sum + (row.applications ?? 0), 0), shape: 'square' as const },
                  { id: 'interviews', label: 'Interviews', color: colorForKey('Interviews'), value: displayRows.reduce((sum, row) => sum + (row.interviews ?? 0), 0), shape: 'square' as const },
                ]
              : kind === 'signups_over_time'
                ? [{ id: 'students', label: 'Students', color: colorForKey('Students'), shape: 'line' as const }, { id: 'companies', label: 'Companies', color: colorForKey('Companies'), shape: 'dashed' as const }]
              : kind === 'trends'
                  ? [{ id: 'applications', label: 'Applications', color: colorForKey('Applications'), shape: 'line' as const }, { id: 'interviews', label: 'Interview-stage applications', color: colorForKey('Interview-stage applications'), shape: 'dashed' as const }, { id: 'offers', label: 'Offers', color: colorForKey('Offers'), shape: 'line' as const }]
                  : ['applications_over_time', 'admin_applications_over_time'].includes(kind)
                    ? [{ id: 'count', label: 'Applications', color: colorForKey('Applications'), shape: 'line' as const }]
                  : ['domains', 'work_modes', 'status', 'internships_by_status', 'verification_status', 'interview_outcomes'].includes(kind)
                    ? displayRows.map((row) => {
                      const fullName = row.fullName ?? row.name
                      const label = kind === 'admin_actions_by_type'
                        ? auditActionLabel(row.action ?? row.name)
                        : ['status', 'internships_by_status', 'verification_status', 'interview_outcomes'].includes(kind)
                          ? statusLabel(fullName)
                          : fullName
                      return { id: row.name, label, color: colorForKey(fullName), value: row.count, shape: ['status', 'work_modes', 'internships_by_status', 'verification_status', 'interview_outcomes'].includes(kind) ? 'circle' as const : 'square' as const }
                    })
                    : kind === 'funnel' || kind === 'company_pipeline'
                      ? [{ id: 'count', label: 'Applications', color: colorForKey('Applications'), shape: 'square' as const }]
                      : displayRows.map((row) => ({ id: row.name, label: kind === 'admin_actions_by_type' ? auditActionLabel(row.action ?? row.name) : row.fullName ?? row.name, color: colorForKey(row.fullName ?? row.name), value: row.count, shape: 'square' as const }))
  if (kind === 'response_times' && displayRows[0]?.median_days != null) {
    seriesConfig.push({
      id: 'median',
      label: `Median ${displayRows[0].median_days} days`,
      color: colorForKey('Median'),
      value: displayRows[0].median_days,
      shape: 'dashed',
    })
  }
  const categoryLegend = !RANKED_BAR_KINDS.includes(kind) && (['domains', 'work_modes', 'status', 'internships_by_status', 'verification_status', 'interview_outcomes'].includes(kind)
    || (!seriesConfig.some((item) => ['days', 'have', 'missing', ...STATUS_SERIES, ...ROLE_SERIES, 'students', 'companies', 'applications', 'interviews', 'offers', 'count'].includes(item.id)))
  )
  const visibleRows = displayRows.filter((row) => !hiddenItems.includes(row.name))
  const pieTotal = visibleRows.reduce((sum, row) => sum + row.count, 0)
  const legendSource = seriesConfig.map((item) => item.value !== undefined
    ? item
    : {
      ...item,
      value: displayRows.reduce((sum, row) => sum + Number(row[item.id] ?? 0), 0),
    })
  const multiSeriesLegend = [
    'response_times',
    'skill_gap',
    'top_companies',
    'conversion_by_role',
    'status_over_time',
    'signups_over_time',
    'trends',
  ].includes(kind)
  const seriesTotal = legendSource.reduce((sum, item) => sum + (item.value ?? 0), 0)
  const legendItems: ChartLegendItem[] = (RANKED_BAR_KINDS.includes(kind) && !multiSeriesLegend ? [] : legendSource).map((item) => ({
    ...item,
    percentage: ['status', 'work_modes', 'internships_by_status', 'verification_status', 'interview_outcomes'].includes(kind) && pieTotal > 0
      ? Math.round((item.value ?? 0) / pieTotal * 100)
      : multiSeriesLegend && seriesTotal > 0
        ? Math.round((item.value ?? 0) / seriesTotal * 100)
        : multiSeriesLegend
          ? 0
          : undefined,
  }))
  const legend = legendItems.length > 0 ? (
    <div className={['status', 'work_modes', 'internships_by_status', 'verification_status', 'interview_outcomes'].includes(kind) ? 'min-w-0 md:w-1/3' : ''}>
      <ChartLegend
        items={legendItems}
        hiddenItems={hiddenItems}
        onToggle={(id) => setHiddenItems((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id])}
        onHighlight={setHighlighted}
      />
    </div>
  ) : null
  const commonProps = {
    data: visibleRows,
    margin: { top: 10, right: 28, left: 10, bottom: 10 },
  }
  if (kind === 'activity_calendar') {
    const maxCount = Math.max(1, ...displayRows.map((row) => (
      (hiddenItems.includes('applications') ? 0 : row.applications ?? 0)
      + (hiddenItems.includes('interviews') ? 0 : row.interviews ?? 0)
    )))
    return (
      <div className="flex flex-col gap-3">
        <div className="grid h-[280px] grid-cols-7 content-start gap-1 overflow-y-auto rounded-lg p-1" role="group" aria-label={`${label}. ${summary || 'Not enough data yet.'}`}>
          {visibleRows.map((row) => {
            const count = (hiddenItems.includes('applications') ? 0 : row.applications ?? 0)
              + (hiddenItems.includes('interviews') ? 0 : row.interviews ?? 0)
            const intensity = Math.max(0.12, count / maxCount)
            return (
              <div key={row.date ?? row.name} title={`${row.date ?? row.name}: ${row.applications ?? 0} applications, ${row.interviews ?? 0} interviews`} aria-label={`${row.date ?? row.name}: ${row.applications ?? 0} applications, ${row.interviews ?? 0} interviews`} className="flex aspect-square min-w-0 flex-col items-center justify-center rounded-md text-[9px] text-white" style={{ backgroundColor: `color-mix(in srgb, ${hiddenItems.includes('applications') ? colorForKey('Interviews') : colorForKey('Applications')} ${Math.round(intensity * 100)}%, var(--analytics-grid, #e2e8f0))` }}>
                <span>{dateLabel(row.date ?? row.name)}</span>
                <span className="font-bold">{count}</span>
              </div>
            )
          })}
        </div>
        <ChartLegend
          items={legendItems}
          hiddenItems={hiddenItems}
          onToggle={(id) => setHiddenItems((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id])}
          onHighlight={setHighlighted}
        />
      </div>
    )
  }
  if (kind === 'upcoming_deadlines') {
    return (
      <ol className="h-[280px] space-y-2 overflow-y-auto" aria-label={label}>
        {displayRows.map((row) => (
          <li key={row.url} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <Link to={row.url ?? '#'} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">{row.name}</Link>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Deadline: {row.date}</p>
          </li>
        ))}
      </ol>
    )
  }

  return (
    <div
      className={`w-full min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 ${['status', 'work_modes', 'internships_by_status', 'verification_status', 'interview_outcomes'].includes(kind) ? 'flex flex-col gap-3 md:flex-row md:items-center' : 'space-y-3'}`}
      role="group"
      aria-label={`${label}. ${summary || 'Not enough data yet.'}`}
      tabIndex={0}
    >
      <p className="sr-only">{label}: {summary}</p>
      {multiSeriesLegend && legend}
      <div className={`min-h-[280px] min-w-0 ${['status', 'work_modes', 'internships_by_status', 'verification_status', 'interview_outcomes'].includes(kind) ? 'w-full md:w-2/3' : 'w-full'}`}>
      <ResponsiveContainer width="100%" height={280} minWidth={0}>
        {kind === 'response_times' ? (
          <BarChart {...commonProps} data={displayRows}>
            <CartesianGrid stroke={gridColor} strokeDasharray="3 5" vertical={false} />
            <XAxis dataKey="name" tick={<CategoryAxisTick textAnchor="middle" />} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis allowDecimals tick={{ fill: tickColor, fontSize: 10 }} tickLine={false} axisLine={false} width={42} />
            <Tooltip content={<ChartTooltip />} />
            {displayRows[0]?.median_days != null && !hiddenItems.includes('median') && <ReferenceLine y={displayRows[0].median_days} stroke={colorForKey('Median')} strokeDasharray="5 4" label={{ value: `Median ${displayRows[0].median_days}d`, fill: tickColor, fontSize: 10 }} />}
            {!hiddenItems.includes('days') && <Bar dataKey="days" name="Days to first response" fill={colorForKey('Applications')} radius={[6, 6, 0, 0]} barSize={22} isAnimationActive={animation} />}
          </BarChart>
        ) : kind === 'skill_gap' || kind === 'top_companies' || kind === 'conversion_by_role' ? (
          <BarChart {...commonProps} data={displayRows} layout="vertical" barCategoryGap={8}>
            <CartesianGrid stroke={gridColor} strokeDasharray="3 5" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tickCount={4} tick={{ fill: tickColor, fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={150} interval={0} tick={<CategoryAxisTick />} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip />} />
            {kind === 'skill_gap' ? (
              <>
                {!hiddenItems.includes('have') && <Bar dataKey="have" name="You have it" stackId="skills" fill={colorForKey('You have it')} fillOpacity={highlighted === null || highlighted === 'have' ? 1 : 0.25} barSize={20} isAnimationActive={animation} />}
                {!hiddenItems.includes('missing') && <Bar dataKey="missing" name="Missing" stackId="skills" fill={colorForKey('Missing')} fillOpacity={highlighted === null || highlighted === 'missing' ? 1 : 0.25} radius={[0, 6, 6, 0]} barSize={20} isAnimationActive={animation} />}
              </>
            ) : (
              (kind === 'top_companies'
                ? ['applied', 'under_review', 'shortlisted', 'interview', 'selected', 'accepted', 'rejected', 'withdrawn']
                : ['applied', 'under_review', 'shortlisted', 'interview_scheduled', 'selected', 'accepted']
              ).map((key) => (
                !hiddenItems.includes(key) &&                 <Bar key={key} dataKey={key} name={statusLabel(key)} stackId="companies" fill={colorForKey(key)} fillOpacity={highlighted === null || highlighted === key ? 1 : 0.25} barSize={20} isAnimationActive={animation} />
              ))
            )}
          </BarChart>
        ) : kind === 'status_over_time' ? (
          <AreaChart {...commonProps}>
            <CartesianGrid stroke={gridColor} strokeDasharray="3 5" vertical={false} />
            <XAxis dataKey="date" tickFormatter={dateLabel} tick={{ fill: tickColor, fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis allowDecimals={false} tick={{ fill: tickColor, fontSize: 10 }} tickLine={false} axisLine={false} width={36} />
            <Tooltip content={<ChartTooltip />} labelFormatter={(value) => dateLabel(String(value))} />
            {STATUS_SERIES.map((key) => (
              !hiddenItems.includes(key) && <Area key={key} name={statusLabel(key)} dataKey={key} type="monotone" stackId="status" stroke={colorForKey(key)} fill={colorForKey(key)} fillOpacity={highlighted === null || highlighted === key ? 0.22 : 0.05} isAnimationActive={animation} />
            ))}
          </AreaChart>
        ) : kind === 'trends' || kind === 'applications_over_time' || kind === 'admin_applications_over_time' || kind === 'signups_over_time' ? (
          <AreaChart {...commonProps}>
            <CartesianGrid stroke={gridColor} strokeDasharray="3 5" vertical={false} />
            <XAxis dataKey="date" tickFormatter={dateLabel} tick={{ fill: tickColor, fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tick={{ fill: tickColor, fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
            <Tooltip content={<ChartTooltip />} labelFormatter={(value) => dateLabel(String(value))} />
            {kind === 'signups_over_time' ? (
              <>
                {!hiddenItems.includes('students') && <Area name="Students" dataKey="students" type="monotone" stroke={colorForKey('Students')} fill={colorForKey('Students')} fillOpacity={highlighted === null || highlighted === 'students' ? 0.16 : 0.03} strokeWidth={2.5} activeDot={{ r: 5 }} isAnimationActive={animation} />}
                {!hiddenItems.includes('companies') && <Area name="Companies" dataKey="companies" type="monotone" stroke={colorForKey('Companies')} fill={colorForKey('Companies')} fillOpacity={highlighted === null || highlighted === 'companies' ? 0.08 : 0.02} strokeWidth={2} activeDot={{ r: 4 }} isAnimationActive={animation} />}
              </>
            ) : kind === 'trends' ? (
              <>
                {!hiddenItems.includes('applications') && <Area name="Applications" dataKey="applications" type="monotone" stroke={colorForKey('Applications')} fill={colorForKey('Applications')} fillOpacity={highlighted === null || highlighted === 'applications' ? 0.16 : 0.03} strokeWidth={2.5} activeDot={{ r: 5 }} isAnimationActive={animation} />}
                {!hiddenItems.includes('interviews') && <Area name="Interview-stage applications" dataKey="interviews" type="monotone" stroke={colorForKey('Interview-stage applications')} fill={colorForKey('Interview-stage applications')} fillOpacity={highlighted === null || highlighted === 'interviews' ? 0.08 : 0.02} strokeWidth={2} activeDot={{ r: 4 }} isAnimationActive={animation} />}
              </>
            ) : (
              <>
                {!hiddenItems.includes('count') && <Area name="Applications" dataKey="count" type="monotone" stroke={colorForKey('Applications')} fill={colorForKey('Applications')} fillOpacity={highlighted === null || highlighted === 'count' ? 0.16 : 0.03} strokeWidth={2.5} activeDot={{ r: 5 }} isAnimationActive={animation} />}
              </>
            )}
            {kind === 'trends' && !hiddenItems.includes('offers') && <Area name="Offers" dataKey="offers" type="monotone" stroke={colorForKey('Offers')} fill={colorForKey('Offers')} fillOpacity={highlighted === null || highlighted === 'offers' ? 0.06 : 0.02} strokeWidth={2} activeDot={{ r: 4 }} isAnimationActive={animation} />}
          </AreaChart>
        ) : kind === 'status' || kind === 'work_modes' || kind === 'internships_by_status' || kind === 'verification_status' || kind === 'interview_outcomes' ? (
          <PieChart>
            <Tooltip content={<ChartTooltip />} />
            <Pie data={visibleRows} dataKey="count" nameKey="name" cx="50%" cy="46%" innerRadius="48%" outerRadius="70%" paddingAngle={2} cornerRadius={4} isAnimationActive={animation} labelLine={false}>
              {visibleRows.map((row) => <Cell key={row.name} fill={colorForKey(row.fullName ?? row.name)} fillOpacity={highlighted === null || highlighted === row.name ? 1 : 0.25} stroke="var(--analytics-surface, #ffffff)" strokeWidth={2} />)}
              <LabelList dataKey="count" position="inside" fill="#ffffff" fontSize={11} fontWeight={700} />
            </Pie>
          </PieChart>
        ) : (
          <BarChart {...commonProps} data={displayRows} layout="vertical" barCategoryGap={8}>
            <CartesianGrid stroke={gridColor} strokeDasharray="3 5" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tickCount={4} tick={{ fill: tickColor, fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" tickFormatter={(value) => truncateLabel(kind === 'admin_actions_by_type' ? auditActionLabel(String(value)) : String(value))} width={Math.min(185, Math.max(100, ...displayRows.map((row) => truncateLabel(row.name).length * 7 + 12)))} interval={0} tick={<CategoryAxisTick formatValue={kind === 'admin_actions_by_type' ? auditActionLabel : undefined} />} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="count" name={kind === 'funnel' || kind === 'company_pipeline' ? 'Applications' : 'Count'} fill={colorForKey(kind === 'funnel' || kind === 'company_pipeline' ? 'Applications' : 'Count')} radius={[0, 7, 7, 0]} barSize={20} isAnimationActive={animation}>
              {visibleRows.map((row) => (
                <Cell
                  key={row.name}
                  fill={kind === 'funnel' || kind === 'company_pipeline' ? colorForKey('Applications') : colorForKey(row.fullName ?? row.name)}
                  fillOpacity={highlighted === null || highlighted === row.name || !categoryLegend ? 1 : 0.25}
                  opacity={RANKED_BAR_KINDS.includes(kind) ? 0.35 + 0.65 * row.count / Math.max(1, ...visibleRows.map((entry) => entry.count)) : 1}
                  cursor={kind === 'admin_actions_by_type' ? 'pointer' : undefined}
                  onClick={() => {
                    if (kind === 'admin_actions_by_type' && row.action) {
                      navigate(routes.adminAuditLogs({ action: row.action, range: '14d' }))
                    }
                  }}
                />
              ))}
              <LabelList dataKey="count" position="right" fill={tickColor} fontSize={11} formatter={(value) => Number(value).toLocaleString()} />
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
      </div>
      {!multiSeriesLegend && legend}
      {(kind === 'funnel' || kind === 'company_pipeline') && (
        <p className="sr-only">
          {displayRows.map((row, index) => `${row.name}: ${row.count}; ${index === 0 || row.conversion_pct == null ? '-' : `${row.conversion_pct}% of previous stage`}`).join('. ')}
        </p>
      )}
    </div>
  )
}
