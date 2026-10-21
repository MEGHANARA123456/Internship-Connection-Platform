import { lazy, Suspense, useState, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  TrendingUp,
  PieChart,
  BarChart3,
  Filter,
  Sparkles,
  Clock,
  Layers,
  RefreshCw,
  SlidersHorizontal,
  ChevronDown,
  Download,
  Copy,
  Printer,
  Check,
  Calendar,
  ExternalLink,
  Eye,
  Activity,
  Award,
  Users,
  Briefcase,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react'
import { api } from '../../api/client'
import { routes } from '../../lib/routes'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ChartSkeleton, KpiSkeleton, Spinner } from '../ui/LoadingSkeleton'
import { useAuthStore } from '../../store/auth'
import { ChartLegend } from '../charts/ChartLegend'
import { chartColorFor } from '../charts/chartColors'

const ResponsiveOverviewChart = lazy(async () => {
  const module = await import('./ResponsiveOverviewChart')
  return { default: module.ResponsiveOverviewChart }
})
const RoleAnalyticsCharts = lazy(async () => {
  const module = await import('./AnalyticsInsights')
  return { default: module.RoleAnalyticsCharts }
})
const CompanyPerformanceCharts = lazy(async () => {
  const module = await import('./AnalyticsInsights')
  return { default: module.CompanyPerformanceCharts }
})
const UnifiedAnalyticsCard = lazy(async () => {
  const module = await import('./UnifiedAnalyticsCard')
  return { default: module.UnifiedAnalyticsCard }
})

export interface DesktopAnalysisVisualsProps {
  title?: string
  subtitle?: string
  variant?: 'student' | 'company' | 'admin' | 'public'
  refreshKey?: number
  onRefreshed?: () => void
  fullAnalyticsMenu?: boolean
}

interface AnalyticsData {
  role: string
  has_activity: boolean
  funnel: {
    applied: number
    screened: number
    shortlisted?: number
    interviews: number
    offers: number
  }
  domains: Array<{
    name: string
    count: number
    pct: number
    color: string
  }>
  monthly_trends: Array<{
    month: string
    apps: number
    interviews: number
    offers: number
  }>
  total_active_internships: number
  total_verified_students: number
  total_companies: number
}

type TimeRangeOption = 'ALL' | '30D' | '90D' | 'QUARTER'

export function DesktopAnalysisVisuals({
  title = 'Recruitment Analytics',
  subtitle = 'Real-time pipeline progression, hiring velocity, and ecosystem trends',
  variant = 'public',
  refreshKey,
  onRefreshed,
  fullAnalyticsMenu = false,
}: DesktopAnalysisVisualsProps) {
  const userId = useAuthStore((state) => state.session?.userId)
  const userScopedStorageKey = `analytics-selected-chart:${variant}:${userId ?? 'guest'}`
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (!fullAnalyticsMenu || typeof window === 'undefined') return 'funnel'
    return window.sessionStorage.getItem(userScopedStorageKey) || 'funnel'
  })
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null)
  const [hoveredDomain, setHoveredDomain] = useState<number | null>(null)
  const [hiddenTrendSeries, setHiddenTrendSeries] = useState<string[]>([])
  const [hiddenDomains, setHiddenDomains] = useState<string[]>([])
  const [hiddenFunnelStages, setHiddenFunnelStages] = useState<string[]>([])
  const [highlightedDashboardSeries, setHighlightedDashboardSeries] = useState<string | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [roleRefreshKey, setRoleRefreshKey] = useState(0)

  // Interactive Visuals Action Menu state
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false)
  const [timeRange, setTimeRange] = useState<TimeRangeOption>('ALL')
  const [performanceRange, setPerformanceRange] = useState<'30' | '90' | 'all'>('30')
  const [isPerformanceRangeMenuOpen, setIsPerformanceRangeMenuOpen] = useState(false)
  const [showPercentages, setShowPercentages] = useState(true)
  const [showMetricBadges, setShowMetricBadges] = useState(true)
  const [showStageDropoffs, setShowStageDropoffs] = useState(true)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const menuRef = useRef<HTMLDivElement>(null)
  const viewMenuRef = useRef<HTMLDivElement>(null)
  const viewTriggerRef = useRef<HTMLButtonElement>(null)
  const viewItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const legacyViewOptions = [
    { key: 'funnel', label: 'Pipeline Funnel', icon: Filter },
    { key: 'trends', label: 'Activity Trends', icon: TrendingUp },
    { key: 'domains', label: 'Role Domains', icon: PieChart },
    { key: 'market', label: 'Work Modes', icon: Layers },
  ]
  const fullViewGroups = variant === 'company' ? [
    { label: 'Funnel & conversion', items: [
      { key: 'funnel', label: 'Pipeline funnel', icon: Filter },
      { key: 'conversion_role', label: 'Conversion per role', icon: BarChart3 },
    ] },
    { label: 'Activity & velocity', items: [
      { key: 'trends', label: 'Activity trends', icon: TrendingUp },
      { key: 'response_time', label: 'Time to first response', icon: Clock },
      { key: 'time_to_hire', label: 'Time to hire', icon: Clock },
    ] },
    { label: 'Status & quality', items: [
      { key: 'status_mix', label: 'Status mix donut', icon: PieChart },
      { key: 'match_distribution', label: 'Match-score distribution', icon: BarChart3 },
      { key: 'skills_required', label: 'Top skills vs required', icon: Award },
    ] },
    { label: 'Outcomes', items: [
      { key: 'interview_outcomes', label: 'Interview outcomes', icon: Users },
      { key: 'offer_acceptance', label: 'Offer acceptance', icon: Check },
      { key: 'top_universities', label: 'Top universities', icon: Briefcase },
      { key: 'applications_by_role', label: 'Applications by role', icon: BarChart3 },
    ] },
  ] : variant === 'student' ? [
    { label: 'Funnel & conversion', items: [{ key: 'funnel', label: 'Pipeline funnel', icon: Filter }] },
    { label: 'Activity & velocity', items: [
      { key: 'trends', label: 'Activity trends', icon: TrendingUp },
      { key: 'applications_week', label: 'Applications per week', icon: BarChart3 },
      { key: 'response_time', label: 'Time to first response', icon: Clock },
    ] },
    { label: 'Status & quality', items: [
      { key: 'status_mix', label: 'Status mix donut', icon: PieChart },
      { key: 'match_score', label: 'Average match score', icon: Award },
      { key: 'skills_gap', label: 'Skills to learn', icon: Briefcase },
    ] },
    { label: 'Outcomes', items: [{ key: 'response_rate', label: 'Response rate', icon: Activity }] },
  ] : [
    { label: 'Funnel & conversion', items: [{ key: 'funnel', label: 'Pipeline funnel', icon: Filter }] },
    { label: 'Activity & velocity', items: [
      { key: 'trends', label: 'Activity trends', icon: TrendingUp },
      { key: 'user_growth', label: 'User growth', icon: Users },
      { key: 'admin_actions', label: 'Admin action volume by action', icon: Activity },
    ] },
  ]
  const viewOptions = fullAnalyticsMenu ? fullViewGroups.flatMap((group) => group.items) : legacyViewOptions
  const selectedStorageKey = useRef(userScopedStorageKey)

  useEffect(() => {
    if (!fullAnalyticsMenu) return
    if (selectedStorageKey.current !== userScopedStorageKey) {
      selectedStorageKey.current = userScopedStorageKey
      const stored = window.sessionStorage.getItem(userScopedStorageKey)
      setActiveTab(viewOptions.some((view) => view.key === stored) ? stored! : 'funnel')
      return
    }
    if (!viewOptions.some((view) => view.key === activeTab)) setActiveTab('funnel')
  }, [activeTab, fullAnalyticsMenu, userScopedStorageKey, viewOptions])

  useEffect(() => {
    if (fullAnalyticsMenu) window.sessionStorage.setItem(userScopedStorageKey, activeTab)
  }, [activeTab, fullAnalyticsMenu, userScopedStorageKey])

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3500)
  }

  // Handle click outside and Escape key to close menu robustly
  useEffect(() => {
    if (!isMenuOpen) return

    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (!target || !menuRef.current) return
      const path = e.composedPath ? e.composedPath() : []
      if (path.length > 0) {
        if (path.includes(menuRef.current)) return
      } else if (menuRef.current.contains(target)) {
        return
      }
      setIsMenuOpen(false)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMenuOpen(false)
      }
    }

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleOutsideClick)
      document.addEventListener('keydown', handleKeyDown)
    }, 0)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isMenuOpen])

  useEffect(() => {
    if (!isViewMenuOpen) return

    const selectedIndex = viewOptions.findIndex((view) => view.key === activeTab)
    viewItemRefs.current[selectedIndex < 0 ? 0 : selectedIndex]?.focus()

    const handleOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !viewMenuRef.current?.contains(event.target)) {
        setIsViewMenuOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsViewMenuOpen(false)
        viewTriggerRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isViewMenuOpen, activeTab])

  const handleViewMenuKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') nextIndex = (index + 1) % viewOptions.length
    if (event.key === 'ArrowUp') nextIndex = (index - 1 + viewOptions.length) % viewOptions.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = viewOptions.length - 1
    if (nextIndex !== null) {
      event.preventDefault()
      viewItemRefs.current[nextIndex]?.focus()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setIsViewMenuOpen(false)
      viewTriggerRef.current?.focus()
    }
  }

  const selectView = (view: string) => {
    setActiveTab(view)
    setIsViewMenuOpen(false)
    viewTriggerRef.current?.focus()
  }

  const fetchAnalytics = async () => {
    setIsRefreshing(true)
    setLoadError(false)
    try {
      const res = await api.get('/analytics/overview')
      setAnalytics(res.data)
      onRefreshed?.()
    } catch {
      setLoadError(true)
    } finally {
      setIsRefreshing(false)
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!fullAnalyticsMenu) void fetchAnalytics()
  }, [variant, refreshKey, fullAnalyticsMenu])

  // Raw API counts with fallback safety
  const rawApplied = analytics?.funnel?.applied || 0
  const rawScreened = analytics?.funnel?.screened || 0
  const rawInterviews = analytics?.funnel?.interviews || 0
  const rawShortlisted = analytics?.funnel?.shortlisted ?? rawInterviews
  const rawOffers = analytics?.funnel?.offers || 0

  const rawMonthlyTrends =
    analytics?.monthly_trends && analytics.monthly_trends.length > 0
      ? analytics.monthly_trends
      : [
          { month: 'Jun', apps: 0, interviews: 0, offers: 0 },
          { month: 'Jul', apps: 0, interviews: 0, offers: 0 },
          { month: 'Aug', apps: 0, interviews: 0, offers: 0 },
          { month: 'Sep', apps: rawApplied, interviews: rawInterviews, offers: rawOffers },
        ]

  // Time-Range Filtering Recomputation
  let filteredMonthlyTrends = [...rawMonthlyTrends]
  let appliedCount = rawApplied
  let screenedCount = rawScreened
  let shortlistedCount = rawShortlisted
  let interviewsCount = rawInterviews
  let offersCount = rawOffers

  if (timeRange === '30D') {
    // 30 Days: Last 1 month in trend series
    filteredMonthlyTrends = rawMonthlyTrends.slice(-1)
    const latestMonth = filteredMonthlyTrends[0] || { apps: 0, interviews: 0, offers: 0 }
    appliedCount = latestMonth.apps
    interviewsCount = latestMonth.interviews
    offersCount = latestMonth.offers
    screenedCount = Math.min(appliedCount, Math.round(appliedCount * (rawScreened / Math.max(rawApplied, 1))))
    shortlistedCount = Math.min(appliedCount, Math.round(appliedCount * (rawShortlisted / Math.max(rawApplied, 1))))
  } else if (timeRange === '90D' || timeRange === 'QUARTER') {
    // 90 Days / Current Quarter: Last 3 months in trend series
    filteredMonthlyTrends = rawMonthlyTrends.slice(-3)
    appliedCount = filteredMonthlyTrends.reduce((acc, curr) => acc + (curr.apps || 0), 0)
    interviewsCount = filteredMonthlyTrends.reduce((acc, curr) => acc + (curr.interviews || 0), 0)
    offersCount = filteredMonthlyTrends.reduce((acc, curr) => acc + (curr.offers || 0), 0)
    screenedCount = Math.min(appliedCount, Math.round(appliedCount * (rawScreened / Math.max(rawApplied, 1))))
    shortlistedCount = Math.min(appliedCount, Math.round(appliedCount * (rawShortlisted / Math.max(rawApplied, 1))))
  }

  // Domain Breakdown with recomputed proportional percentages
  const rawDomainData = analytics?.domains && analytics.domains.length > 0 ? analytics.domains : []
  const domainData = rawDomainData.map((d) => {
    const scaleFactor = rawApplied > 0 ? appliedCount / rawApplied : 1
    const count = Math.round(d.count * scaleFactor)
    return {
      ...d,
      count,
      pct: appliedCount > 0 ? Math.round((count / appliedCount) * 100) : d.pct,
    }
  })

  // Dynamic Funnel Stages from authentic database
  const funnelStages = [
    {
      name: variant === 'company' ? 'Applications Received' : 'Applications Filed',
      count: appliedCount,
      pct: appliedCount > 0 ? 100 : 0,
      dropoff: '0%',
      velocity: appliedCount > 0 ? 'Active Pipeline' : 'Awaiting Submissions',
      color: 'from-indigo-600 to-indigo-500',
      bg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
    },
    {
      name: 'Screened & Qualified',
      count: screenedCount,
      pct: appliedCount > 0 ? Math.round((screenedCount / appliedCount) * 100) : 0,
      dropoff: appliedCount > 0 ? `-${Math.max(0, 100 - Math.round((screenedCount / appliedCount) * 100))}%` : '0%',
      velocity: 'Resume & Profile Review',
      color: 'from-blue-600 to-blue-500',
      bg: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
    },
    {
      name: 'Shortlisted',
      count: shortlistedCount,
      pct: appliedCount > 0 ? Math.round((shortlistedCount / appliedCount) * 100) : 0,
      dropoff:
        appliedCount > 0
          ? `-${Math.max(
              0,
              Math.round((screenedCount / appliedCount) * 100) -
                Math.round((shortlistedCount / appliedCount) * 100)
            )}%`
          : '0%',
      velocity: 'Shortlisted applications',
      color: 'from-violet-600 to-violet-500',
      bg: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800',
    },
    {
      name: 'Offers Extended / Accepted',
      count: offersCount,
      pct: appliedCount > 0 ? Math.round((offersCount / appliedCount) * 100) : 0,
      dropoff:
        appliedCount > 0
          ? `-${Math.max(
              0,
              Math.round((shortlistedCount / appliedCount) * 100) -
                Math.round((offersCount / appliedCount) * 100)
            )}%`
          : '0%',
      velocity: 'Final Selection',
      color: 'from-emerald-600 to-emerald-500',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    },
  ]

  // SVG dimensions for trend chart
  const svgWidth = 600
  const svgHeight = 220
  const maxApps = Math.max(
    ...filteredMonthlyTrends.flatMap((item) => [
      ...(hiddenTrendSeries.includes('Applications') ? [] : [item.apps]),
      ...(hiddenTrendSeries.includes('Offers') ? [] : [item.offers]),
    ]),
    1,
  )

  const points = filteredMonthlyTrends.map((d, i) => {
    const x = 50 + (i * (svgWidth - 90)) / (filteredMonthlyTrends.length - 1 || 1)
    const y = svgHeight - 35 - (d.apps / maxApps) * (svgHeight - 65)
    return { x, y, ...d }
  })
  const offerPoints = filteredMonthlyTrends.map((d, i) => {
    const x = 50 + (i * (svgWidth - 90)) / (filteredMonthlyTrends.length - 1 || 1)
    const y = svgHeight - 35 - (d.offers / maxApps) * (svgHeight - 65)
    return { x, y, ...d }
  })

  // Generate SVG area path
  const areaPath =
    points.length > 0
      ? `M ${points[0].x} ${points[0].y} ` +
        points.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ') +
        ` L ${points[points.length - 1].x} ${svgHeight - 35} L ${points[0].x} ${svgHeight - 35} Z`
      : ''

  const linePath =
    points.length > 0
      ? `M ${points[0].x} ${points[0].y} ` +
        points.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')
      : ''

  const offerLinePath =
    offerPoints.length > 0
      ? `M ${offerPoints[0].x} ${offerPoints[0].y} ` +
        offerPoints.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')
      : ''

  const conversionRate = appliedCount > 0 ? ((offersCount / appliedCount) * 100).toFixed(1) : '0.0'

  // Action: Export on-screen active dataset to CSV without crashing on empty data
  const handleExportCSV = () => {
    setIsMenuOpen(false)
    try {
      const headers = ['Metric / Stage', 'Count', 'Conversion Percentage', 'Drop-off Rate', 'Time Window', 'Generated At']
      const rows = funnelStages.map((s) => [
        `"${s.name}"`,
        s.count,
        `"${s.pct}%"`,
        `"${s.dropoff}"`,
        `"${timeRange}"`,
        `"${new Date().toISOString()}"`,
      ])

      if (activeTab === 'trends') {
        rows.push(['--- Monthly Activity Trends ---', '', '', '', '', ''])
        filteredMonthlyTrends.forEach((t) => {
          rows.push([`"Month: ${t.month}"`, `Apps: ${t.apps}`, `Offers: ${t.offers}`, `Interviews: ${t.interviews}`, `"${timeRange}"`, `"${new Date().toISOString()}"`])
        })
      }

      if (activeTab === 'domains' && domainData.length > 0) {
        rows.push(['--- Domain Distributions ---', '', '', '', '', ''])
        domainData.forEach((d) => {
          rows.push([`"Domain: ${d.name}"`, d.count, `"${d.pct}%"`, '-', `"${timeRange}"`, `"${new Date().toISOString()}"`])
        })
      }

      const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `analytics_report_${variant}_${timeRange.toLowerCase()}_${new Date().toISOString().split('T')[0]}.csv`)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      showToast('CSV export downloaded successfully.')
    } catch {
      showToast('Failed to export CSV. Please try again.')
    }
  }

  // Action: Copy Summary to Clipboard
  const handleCopySummary = async () => {
    setIsMenuOpen(false)
    try {
      const summaryText = [
        `📊 ${title} (${timeRange} window)`,
        `• Total Submissions/Applications: ${appliedCount.toLocaleString()}`,
        `• Screened & Qualified: ${screenedCount.toLocaleString()}`,
        `• Live Interview Discussions: ${interviewsCount.toLocaleString()}`,
        `• Offers Extended/Accepted: ${offersCount.toLocaleString()}`,
        `• Overall Conversion Rate: ${conversionRate}%`,
        `• Active Tab: ${activeTab.toUpperCase()}`,
        `• Generated: ${new Date().toLocaleDateString()}`,
      ].join('\n')

      await navigator.clipboard.writeText(summaryText)
      showToast('Analytics summary copied to clipboard!')
    } catch {
      showToast('Could not copy to clipboard.')
    }
  }

  // Action: Print Report
  const handlePrintReport = () => {
    setIsMenuOpen(false)
    window.print()
  }

  if (fullAnalyticsMenu) {
    return (
      <Suspense fallback={<div className="space-y-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((item) => <KpiSkeleton key={item} />)}</div><ChartSkeleton /></div>}>
        <UnifiedAnalyticsCard
          variant={variant === 'public' ? 'student' : variant}
          title={title}
          subtitle={subtitle}
          refreshKey={(refreshKey ?? 0) + roleRefreshKey}
          onRefreshed={onRefreshed}
        />
      </Suspense>
    )
  }

  if ((loadError || !analytics) && !fullAnalyticsMenu) {
    return (
      <div className="space-y-4">
        <div role="alert" className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <p>Couldn't load pipeline analytics.</p>
          <Button size="sm" variant="outline" isLoading={isRefreshing} onClick={() => void fetchAnalytics()}>Retry</Button>
        </div>
        {variant === 'company' && !fullAnalyticsMenu && (
          <Suspense fallback={<ChartSkeleton />}>
            <CompanyPerformanceCharts range={performanceRange} refreshKey={refreshKey} />
          </Suspense>
        )}
      </div>
    )
  }

  return (
    <div className="w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-6 transition-all relative">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="absolute top-4 right-4 z-50 p-2.5 px-3.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl shadow-lg flex items-center gap-2 text-xs font-semibold animate-in fade-in slide-in-from-top-2">
          <Check className="w-4 h-4 text-emerald-400 dark:text-emerald-600 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header with Visual Badge & Navigation */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
              <BarChart3 className="w-4 h-4" />
            </span>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">{title}</h3>
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60">
              <Sparkles className="w-3 h-3 text-indigo-500" /> Live Database Analytics
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{subtitle}</p>
        </div>

        {/* View Switcher Tabs & Actions Menu on analysis top */}
        <div className={fullAnalyticsMenu ? 'flex w-full min-w-0 flex-wrap items-center gap-2 self-stretch sm:w-auto sm:flex-nowrap sm:self-start lg:self-auto' : 'flex shrink-0 items-center gap-2 self-start lg:self-auto'}>
          <div className={fullAnalyticsMenu ? 'relative w-full md:w-auto' : 'relative'} ref={viewMenuRef}>
            {(() => {
              const selectedView = viewOptions.find((view) => view.key === activeTab) ?? viewOptions[0]
              const SelectedIcon = selectedView.icon
              return (
                <>
                  <div>
                    <button
                      ref={viewTriggerRef}
                      type="button"
                      onClick={() => setIsViewMenuOpen((open) => !open)}
                      onKeyDown={(event) => {
                        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                          event.preventDefault()
                          setIsViewMenuOpen(true)
                        }
                      }}
                      className={`flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition-all hover:bg-white hover:text-indigo-600 dark:border-slate-700/60 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-indigo-400 ${fullAnalyticsMenu ? 'w-full justify-between' : ''}`}
                      aria-label={`Analytics view: ${selectedView.label}`}
                      aria-haspopup="menu"
                      aria-expanded={isViewMenuOpen}
                      aria-controls="analytics-view-menu"
                    >
                      <SelectedIcon className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                      <span>{selectedView.label}</span>
                      <ChevronDown className={`h-3 w-3 transition-transform ${isViewMenuOpen ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                  {isViewMenuOpen && (
                    <div
                      id="analytics-view-menu"
                      role="menu"
                      aria-label="Analytics views"
                      className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
                    >
                      {fullAnalyticsMenu ? fullViewGroups.map((group) => (
                        <div key={group.label} role="group" aria-label={group.label} className="py-1">
                          <p className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{group.label}</p>
                          {group.items.map((view) => {
                            const index = viewOptions.findIndex((item) => item.key === view.key)
                            const Icon = view.icon
                            const isActive = activeTab === view.key
                            return <button
                              key={view.key}
                              ref={(element) => { viewItemRefs.current[index] = element }}
                              type="button"
                              role="menuitem"
                              aria-current={isActive ? 'true' : undefined}
                              tabIndex={-1}
                              onClick={() => selectView(view.key)}
                              onKeyDown={(event) => handleViewMenuKeyDown(event, index)}
                              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors ${isActive ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}
                            >
                              <span className="flex items-center gap-2"><Icon className="h-3.5 w-3.5" />{view.label}</span>
                              {isActive && <Check className="h-3.5 w-3.5" aria-label="Selected" />}
                            </button>
                          })}
                        </div>
                      )) : viewOptions.map((view, index) => {
                        const Icon = view.icon
                        const isActive = activeTab === view.key
                        return <button
                          key={view.key}
                          ref={(element) => { viewItemRefs.current[index] = element }}
                          type="button"
                          role="menuitem"
                          tabIndex={-1}
                          onClick={() => selectView(view.key)}
                          onKeyDown={(event) => handleViewMenuKeyDown(event, index)}
                          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors ${isActive ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}
                        >
                          <span className="flex items-center gap-2"><Icon className="h-3.5 w-3.5" />{view.label}</span>
                          {isActive && <Check className="h-3.5 w-3.5" aria-label="Selected" />}
                        </button>
                      })}
                    </div>
                  )}
                </>
              )
            })()}
          </div>

          {variant === 'company' && (
            <div className="relative">
              <button
                type="button"
                aria-label="Company analytics range"
                aria-haspopup="menu"
                aria-expanded={isPerformanceRangeMenuOpen}
                onClick={() => setIsPerformanceRangeMenuOpen((open) => !open)}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700/60 dark:bg-slate-800/80 dark:text-slate-300"
              >
                {performanceRange === 'all' ? 'All' : `${performanceRange} days`}<ChevronDown className="h-3 w-3" />
              </button>
              {isPerformanceRangeMenuOpen && (
                <div role="menu" aria-label="Company analytics time range" className="absolute right-0 top-full z-30 mt-1 w-32 rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  {(['30', '90', 'all'] as const).map((range) => (
                    <button key={range} type="button" role="menuitemradio" aria-checked={performanceRange === range} onClick={() => { setPerformanceRange(range); setIsPerformanceRangeMenuOpen(false) }} className="block w-full rounded-md px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                      {range === 'all' ? 'All' : `${range} days`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Refresh Action */}
          <button
            type="button"
            onClick={() => {
              setRoleRefreshKey((key) => key + 1)
              void fetchAnalytics()
            }}
            disabled={isRefreshing}
            title="Refresh analysis data"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700/60 hover:bg-white dark:hover:bg-slate-900 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all cursor-pointer shadow-2xs disabled:opacity-50"
          >
            {isRefreshing ? <Spinner className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" /> : <RefreshCw className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />}
            <span className="hidden sm:inline">{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>

          {/* Interactive Visual Options & Actions Dropdown Menu */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              title="Visual Options, Filters & Actions"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer shadow-2xs ${
                isMenuOpen
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo-200 dark:shadow-none'
                  : 'bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/60 hover:bg-white dark:hover:bg-slate-900 hover:text-indigo-600 dark:hover:text-indigo-400'
              }`}
              aria-label="Visual Options & Actions Menu"
              aria-expanded={isMenuOpen}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Options & Menu</span>
              <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Floating Dropdown Content */}
            {isMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 sm:w-80 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl z-50 p-3 space-y-3.5 animate-in fade-in zoom-in-95 duration-150">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2 px-1">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Visual Controls & Actions</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium">ESC to close</span>
                </div>

                {/* 1. Quick View Switcher */}
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1">
                    Quick View Switcher
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    {[
                      { key: 'funnel', label: 'Funnel', icon: Filter },
                      { key: 'trends', label: 'Velocity', icon: TrendingUp },
                      { key: 'domains', label: 'Domains', icon: PieChart },
                      { key: 'market', label: 'Work Modes', icon: Layers },
                    ].map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setActiveTab(item.key as any)
                          setIsMenuOpen(false)
                        }}
                        className={`flex items-center gap-1.5 p-1.5 px-2 rounded-lg text-xs font-medium text-left transition-colors cursor-pointer ${
                          activeTab === item.key
                            ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-bold'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                        }`}
                      >
                        <item.icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2. Time Range Filter (Actually recomputes displayed metrics) */}
                <div className="space-y-1.5 border-t border-slate-100 dark:border-slate-800/80 pt-2.5">
                  <div className="flex items-center justify-between px-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> Time Range Filter
                    </p>
                    <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 font-semibold">{timeRange}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {[
                      { key: 'ALL', label: 'All Time' },
                      { key: '30D', label: 'Last 30 Days' },
                      { key: '90D', label: 'Last 90 Days' },
                      { key: 'QUARTER', label: 'Current Quarter' },
                    ].map((range) => (
                      <button
                        key={range.key}
                        type="button"
                        onClick={() => {
                          setTimeRange(range.key as TimeRangeOption)
                          showToast(`Filter applied: ${range.label}`)
                        }}
                        className={`p-1.5 px-2 rounded-lg text-xs font-medium text-left transition-colors cursor-pointer flex items-center justify-between ${
                          timeRange === range.key
                            ? 'bg-indigo-600 text-white font-bold'
                            : 'bg-slate-50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span>{range.label}</span>
                        {timeRange === range.key && <Check className="w-3 h-3 shrink-0" />}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. Display Customization Toggles */}
                <div className="space-y-1.5 border-t border-slate-100 dark:border-slate-800/80 pt-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1 flex items-center gap-1">
                    <Eye className="w-3 h-3" /> Display Toggles
                  </p>
                  <div className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                    <label className="flex items-center justify-between p-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer">
                      <span>Conversion Percentages</span>
                      <input
                        type="checkbox"
                        checked={showPercentages}
                        onChange={(e) => setShowPercentages(e.target.checked)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </label>
                    <label className="flex items-center justify-between p-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer">
                      <span>Top Stage Indicators</span>
                      <input
                        type="checkbox"
                        checked={showMetricBadges}
                        onChange={(e) => setShowMetricBadges(e.target.checked)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </label>
                    <label className="flex items-center justify-between p-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer">
                      <span>Stage Drop-off Rates</span>
                      <input
                        type="checkbox"
                        checked={showStageDropoffs}
                        onChange={(e) => setShowStageDropoffs(e.target.checked)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </label>
                  </div>
                </div>

                {/* 4. Export & Snapshot Actions */}
                <div className="space-y-1.5 border-t border-slate-100 dark:border-slate-800/80 pt-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1">
                    Export & Snapshots
                  </p>
                  <div className="grid grid-cols-1 gap-1">
                    <button
                      type="button"
                      onClick={handleExportCSV}
                      className="flex items-center gap-2 p-1.5 px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                      <span>Export Data to CSV</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCopySummary}
                      className="flex items-center gap-2 p-1.5 px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                      <span>Copy Summary to Clipboard</span>
                    </button>
                    <button
                      type="button"
                      onClick={handlePrintReport}
                      className="flex items-center gap-2 p-1.5 px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                      <span>Print Analytics Report</span>
                    </button>
                  </div>
                </div>

                {/* 5. Role-Specific Deep Links */}
                <div className="space-y-1.5 border-t border-slate-100 dark:border-slate-800/80 pt-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1">
                    Dashboard Quick Links
                  </p>
                  <div className="space-y-0.5 text-xs">
                    {variant === 'student' && (
                      <>
                        <Link
                          to={routes.applications()}
                          onClick={() => setIsMenuOpen(false)}
                          className="flex items-center justify-between p-1.5 px-2 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          <span className="flex items-center gap-1.5">
                            <Activity className="w-3.5 h-3.5 text-indigo-500" />
                            My Applications Pipeline
                          </span>
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                        </Link>
                        <Link
                          to={routes.saved}
                          onClick={() => setIsMenuOpen(false)}
                          className="flex items-center justify-between p-1.5 px-2 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          <span className="flex items-center gap-1.5">
                            <Briefcase className="w-3.5 h-3.5 text-indigo-500" />
                            Saved Jobs & Bookmarks
                          </span>
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                        </Link>
                        <Link
                          to={routes.studentProfile}
                          onClick={() => setIsMenuOpen(false)}
                          className="flex items-center justify-between p-1.5 px-2 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          <span className="flex items-center gap-1.5">
                            <Award className="w-3.5 h-3.5 text-indigo-500" />
                            Skill Quizzes & Badges
                          </span>
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                        </Link>
                      </>
                    )}

                    {variant === 'company' && (
                      <>
                        <Link
                          to={routes.companyApplicants()}
                          onClick={() => setIsMenuOpen(false)}
                          className="flex items-center justify-between p-1.5 px-2 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          <span className="flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5 text-indigo-500" />
                            ATS Candidate Funnel
                          </span>
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                        </Link>
                        <Link
                          to={routes.companyJobs()}
                          onClick={() => setIsMenuOpen(false)}
                          className="flex items-center justify-between p-1.5 px-2 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          <span className="flex items-center gap-1.5">
                            <Briefcase className="w-3.5 h-3.5 text-indigo-500" />
                            Manage & Post Internships
                          </span>
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                        </Link>
                        <Link
                          to={routes.interviews({ tab: 'upcoming' })}
                          onClick={() => setIsMenuOpen(false)}
                          className="flex items-center justify-between p-1.5 px-2 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-indigo-500" />
                            Interview Schedules
                          </span>
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                        </Link>
                      </>
                    )}

                    {variant === 'admin' && (
                      <>
                        <Link
                          to={routes.adminVerifications}
                          onClick={() => setIsMenuOpen(false)}
                          className="flex items-center justify-between p-1.5 px-2 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          <span className="flex items-center gap-1.5">
                            <ShieldCheck className="w-3.5 h-3.5 text-purple-500" />
                            Company Vetting Queue
                          </span>
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                        </Link>
                        <Link
                          to={routes.adminModeration}
                          onClick={() => setIsMenuOpen(false)}
                          className="flex items-center justify-between p-1.5 px-2 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          <span className="flex items-center gap-1.5">
                            <Briefcase className="w-3.5 h-3.5 text-purple-500" />
                            Listing Moderation
                          </span>
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                        </Link>
                        <Link
                          to={routes.adminReports()}
                          onClick={() => setIsMenuOpen(false)}
                          className="flex items-center justify-between p-1.5 px-2 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          <span className="flex items-center gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5 text-purple-500" />
                            User & Listing Reports
                          </span>
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                        </Link>
                      </>
                    )}

                    {variant === 'public' && (
                      <>
                        <Link
                          to={routes.opportunities}
                          onClick={() => setIsMenuOpen(false)}
                          className="flex items-center justify-between p-1.5 px-2 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          <span className="flex items-center gap-1.5">
                            <Briefcase className="w-3.5 h-3.5 text-indigo-500" />
                            Explore All Internships
                          </span>
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {fullAnalyticsMenu && variant !== 'public' && (
        <Suspense fallback={<div className="space-y-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((item) => <KpiSkeleton key={item} />)}</div><ChartSkeleton /></div>}>
          <RoleAnalyticsCharts
            variant={variant}
            chart={activeTab}
            range={performanceRange}
            refreshKey={(refreshKey ?? 0) + roleRefreshKey}
          />
        </Suspense>
      )}

      {variant === 'company' && !fullAnalyticsMenu && (
        <Suspense fallback={<ChartSkeleton />}>
          <CompanyPerformanceCharts range={performanceRange} refreshKey={refreshKey} />
        </Suspense>
      )}

      {fullAnalyticsMenu && (activeTab === 'funnel' || activeTab === 'trends') && (loading || loadError || !analytics) ? (
        loading ? <ChartSkeleton /> : (
          <div role="alert" className="flex min-h-36 flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white p-5 text-center text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <p>Couldn't load this chart.</p>
            <Button size="sm" variant="outline" isLoading={isRefreshing} onClick={() => void fetchAnalytics()}>Retry</Button>
          </div>
        )
      ) : null}

      {activeTab === 'funnel' && fullAnalyticsMenu && analytics && !loading && !loadError && (
        <Card data-chart-panel className="min-w-0 space-y-3 bg-white p-4 dark:bg-slate-900 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">Pipeline funnel</h4>
            <span className="sr-only">Sample size: {appliedCount} applications · {timeRange === 'ALL' ? 'All time' : timeRange === '30D' ? 'Last 30 days' : 'Last 90 days'}</span>
          </div>
          {appliedCount === 0 ? (
            <p className="flex min-h-36 items-center justify-center rounded-xl border border-dashed border-slate-200 px-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">No data to display yet. Your funnel will appear as applications progress.</p>
          ) : (
            <Suspense fallback={<ChartSkeleton className="border-0 bg-transparent p-0 dark:bg-transparent" />}>
              <ResponsiveOverviewChart
                type="funnel"
                label="Recruitment pipeline funnel"
                items={funnelStages.map((stage) => ({
                  label: stage.name,
                  value: stage.count,
                  detail: [
                    showPercentages ? `${stage.pct}%` : '',
                    showStageDropoffs && stage.dropoff !== '0%' ? `drop-off ${stage.dropoff}` : '',
                    showMetricBadges ? stage.velocity : '',
                  ].filter(Boolean).join(' · '),
                }))}
              />
            </Suspense>
          )}
        </Card>
      )}

      {activeTab === 'funnel' && !fullAnalyticsMenu && (
        <div className="space-y-4 animate-in fade-in duration-200">
          {appliedCount === 0 && (
            <div className="p-3.5 bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 rounded-xl flex items-center justify-between gap-3 text-xs text-indigo-800 dark:text-indigo-300">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <span>Zero activity recorded in the <strong>{timeRange}</strong> window. Data will update automatically when applications occur.</span>
              </div>
              {timeRange !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => setTimeRange('ALL')}
                  className="font-bold underline hover:text-indigo-600 shrink-0 cursor-pointer"
                >
                  View All Time
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {funnelStages.map((stage, idx) => (
              <div
                key={stage.name}
                className="relative p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 hover:border-indigo-300 dark:hover:border-indigo-700 transition-all flex flex-col justify-between overflow-hidden group"
              >
                {/* Visual top accent gradient bar */}
                <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${stage.color}`} />
                <div>
                  <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                    <span>Stage 0{idx + 1}</span>
                    {showPercentages && <span className="font-mono text-xs">{stage.pct}%</span>}
                  </div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    {stage.name}
                  </h4>
                  <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-2">
                    {stage.count.toLocaleString()}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-200/60 dark:border-slate-800/80 flex items-center justify-between text-xs">
                  {showMetricBadges && (
                    <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1 text-[11px]">
                      <Clock className="w-3 h-3" /> {stage.velocity}
                    </span>
                  )}
                  {showStageDropoffs && idx > 0 && appliedCount > 0 && (
                    <span className="text-rose-500 dark:text-rose-400 font-semibold text-[11px]">
                      {stage.dropoff}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Connected Step Visual Bars */}
          <div className="p-4 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center justify-between">
              <span>Recruitment Funnel Conversion Flow ({timeRange})</span>
              <span className="text-indigo-600 dark:text-indigo-400 font-normal">
                Overall conversion rate: <strong>{conversionRate}%</strong>
              </span>
            </div>
            <div className="space-y-2">
              {funnelStages.filter((stage) => !hiddenFunnelStages.includes(stage.name)).map((stage) => (
                <div key={stage.name} className="flex items-center gap-3">
                  <span className="w-44 text-xs text-slate-600 dark:text-slate-400 font-medium truncate">
                    {stage.name}
                  </span>
                  <div className="flex-1 h-3.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden relative">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${Math.max(stage.pct, stage.count > 0 ? 4 : 0)}%`, backgroundColor: chartColorFor(stage.name), opacity: highlightedDashboardSeries === null || highlightedDashboardSeries === stage.name ? 1 : 0.25 }}
                    />
                  </div>
                  <span className="w-14 text-right text-xs font-mono font-bold text-slate-800 dark:text-slate-200">
                    {stage.pct}%
                  </span>
                </div>
              ))}
            </div>
            <ChartLegend
              items={funnelStages.map((stage) => ({ id: stage.name, label: stage.name, color: chartColorFor(stage.name), value: stage.count }))}
              hiddenItems={hiddenFunnelStages}
              onToggle={(id) => setHiddenFunnelStages((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
              onHighlight={setHighlightedDashboardSeries}
              className="mt-3"
            />
          </div>
        </div>
      )}

      {activeTab === 'trends' && fullAnalyticsMenu && analytics && !loading && !loadError && (
        <Card className="min-w-0 space-y-3 bg-white p-4 dark:bg-slate-900 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">Activity trends</h4>
            <span className="sr-only">Sample size: {appliedCount} applications · {timeRange === 'ALL' ? 'All time' : timeRange === '30D' ? 'Last 30 days' : 'Last 90 days'}</span>
          </div>
          {filteredMonthlyTrends.length === 0 ? (
            <p className="flex min-h-36 items-center justify-center rounded-xl border border-dashed border-slate-200 px-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">No data to display yet. Activity trends will appear as applications arrive.</p>
          ) : (
            <Suspense fallback={<ChartSkeleton className="border-0 bg-transparent p-0 dark:bg-transparent" />}>
              <ResponsiveOverviewChart
                type="activity"
                label="Monthly applications and offers"
                series={[
                  { label: 'Applications filed', color: '#4f46e5', values: filteredMonthlyTrends.map((item) => ({ label: item.month, value: item.apps })) },
                  { label: 'Interviews', color: '#8b5cf6', values: filteredMonthlyTrends.map((item) => ({ label: item.month, value: item.interviews })) },
                  { label: 'Offers', color: '#10b981', values: filteredMonthlyTrends.map((item) => ({ label: item.month, value: item.offers })) },
                ]}
              />
            </Suspense>
          )}
        </Card>
      )}

      {activeTab === 'trends' && !fullAnalyticsMenu && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <ChartLegend
              items={[
                { id: 'Applications', label: 'Applications Filed', color: chartColorFor('Applications'), shape: 'line' },
                { id: 'Offers', label: 'Final Offers Accepted', color: chartColorFor('Offers'), shape: 'line' },
              ]}
              hiddenItems={hiddenTrendSeries}
              onToggle={(id) => setHiddenTrendSeries((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
              onHighlight={setHighlightedDashboardSeries}
            />
            <span className="text-slate-500 dark:text-slate-400 text-xs">
              Showing {timeRange} trends • Hover over points to inspect live monthly metrics
            </span>
          </div>

          {/* Interactive SVG Area & Line Chart */}
          <div className="w-full bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800 p-4 relative overflow-hidden">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full h-56 overflow-visible"
              role="img"
              aria-label="Monthly application and offer activity chart"
            >
              <title>Monthly applications and offers</title>
              <defs>
                <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColorFor('Applications')} stopOpacity="0.35" />
                  <stop offset="100%" stopColor={chartColorFor('Applications')} stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="emeraldGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColorFor('Offers')} stopOpacity="0.3" />
                  <stop offset="100%" stopColor={chartColorFor('Offers')} stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Horizontal Grid lines */}
              {[0, 1, 2, 3].map((row) => {
                const y = 25 + row * 45
                return (
                  <g key={row}>
                    <line
                      x1="40"
                      y1={y}
                      x2={svgWidth - 20}
                      y2={y}
                      stroke="currentColor"
                      strokeDasharray="4 4"
                      className="text-slate-200 dark:text-slate-800"
                    />
                    <text
                      x="10"
                      y={y + 4}
                      className="text-[10px] fill-slate-400 dark:fill-slate-300 font-mono"
                    >
                      {Math.round((maxApps / 3) * (3 - row))}
                    </text>
                  </g>
                )
              })}

              {/* Area gradient under apps curve */}
              {!hiddenTrendSeries.includes('Applications') && areaPath && <path d={areaPath} fill="url(#chartGradient)" opacity={highlightedDashboardSeries === null || highlightedDashboardSeries === 'Applications' ? 1 : 0.2} />}

              {/* Applications line */}
              {!hiddenTrendSeries.includes('Applications') && linePath && (
                <path
                  d={linePath}
                  fill="none"
                  stroke={chartColorFor('Applications')}
                  opacity={highlightedDashboardSeries === null || highlightedDashboardSeries === 'Applications' ? 1 : 0.2}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Offers line */}
              {!hiddenTrendSeries.includes('Offers') && offerLinePath && (
                <path
                  d={offerLinePath}
                  fill="none"
                  stroke={chartColorFor('Offers')}
                  opacity={highlightedDashboardSeries === null || highlightedDashboardSeries === 'Offers' ? 1 : 0.2}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Data points */}
              {points.map((p, idx) => (
                <g key={idx}>
                  {!hiddenTrendSeries.includes('Applications') && <circle
                    cx={p.x}
                    cy={p.y}
                    r={hoveredMonth === idx ? 7 : 5}
                    fill={chartColorFor('Applications')}
                    opacity={highlightedDashboardSeries === null || highlightedDashboardSeries === 'Applications' ? 1 : 0.2}
                    stroke="#ffffff"
                    strokeWidth="2"
                    className="cursor-pointer transition-all duration-150"
                    onMouseEnter={() => setHoveredMonth(idx)}
                    onMouseLeave={() => setHoveredMonth(null)}
                  />}
                  {!hiddenTrendSeries.includes('Offers') && offerPoints[idx] && (
                    <circle
                      cx={offerPoints[idx].x}
                      cy={offerPoints[idx].y}
                      r={hoveredMonth === idx ? 6 : 4}
                      fill={chartColorFor('Offers')}
                      opacity={highlightedDashboardSeries === null || highlightedDashboardSeries === 'Offers' ? 1 : 0.2}
                      stroke="#ffffff"
                      strokeWidth="2"
                      className="cursor-pointer transition-all duration-150"
                      onMouseEnter={() => setHoveredMonth(idx)}
                      onMouseLeave={() => setHoveredMonth(null)}
                    />
                  )}
                  <text
                    x={p.x}
                    y={svgHeight - 12}
                    textAnchor="middle"
                    className="text-xs fill-slate-500 dark:fill-slate-400 font-semibold"
                  >
                    {p.month}
                  </text>
                </g>
              ))}
            </svg>

            {/* Hover Tooltip card */}
            {hoveredMonth !== null && points[hoveredMonth] && (
              <div
                className="absolute bg-slate-900 text-white dark:bg-slate-800 text-xs rounded-xl p-3 shadow-xl pointer-events-none border border-slate-700 animate-in fade-in zoom-in-95 duration-100 z-10"
                style={{
                  left: `${Math.min(Math.max(points[hoveredMonth].x - 50, 10), svgWidth - 140)}px`,
                  top: '15px',
                }}
              >
                <div className="font-bold text-slate-300 border-b border-slate-700 pb-1 mb-1.5 flex items-center justify-between gap-3">
                  <span>{points[hoveredMonth].month} Recruitment Metrics</span>
                  <span className="text-[10px] text-indigo-400">{timeRange}</span>
                </div>
                <div className="space-y-1 font-mono text-[11px]">
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-400">Applications:</span>
                    <span className="font-bold text-indigo-400">{points[hoveredMonth].apps}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-400">Interviews:</span>
                    <span className="font-bold text-violet-400">{points[hoveredMonth].interviews}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-400">Offers:</span>
                    <span className="font-bold text-emerald-400">{points[hoveredMonth].offers}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'domains' && !fullAnalyticsMenu && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-700 dark:text-slate-300 font-semibold">
              Ecosystem Sector & Domain Breakdown ({timeRange})
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              {domainData.length} Active Industry Specializations
            </span>
          </div>

          {domainData.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 dark:bg-slate-950/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-xs text-slate-400">
              No sector applications registered yet in the selected {timeRange} window.
            </div>
          ) : (
            <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {domainData.filter((domain) => !hiddenDomains.includes(domain.name)).map((domain, idx, visibleDomains) => {
                const totalVisible = visibleDomains.reduce((sum, entry) => sum + entry.count, 0)
                const visiblePct = Math.round(domain.count / Math.max(1, totalVisible) * 100)
                return (
                <div
                  key={domain.name}
                  onMouseEnter={() => setHoveredDomain(idx)}
                  onMouseLeave={() => setHoveredDomain(null)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${
                    hoveredDomain === idx
                      ? 'border-indigo-400 dark:border-indigo-600 bg-indigo-50/40 dark:bg-indigo-950/30 shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40'
                  }`}
                  style={{ opacity: highlightedDashboardSeries === null || highlightedDashboardSeries === domain.name ? 1 : 0.3 }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      {domain.name}
                    </span>
                    <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">
                      {visiblePct}%
                    </span>
                  </div>
                  <div className="mt-2 text-xl font-extrabold text-slate-800 dark:text-slate-200">
                    {domain.count.toLocaleString()} <span className="text-xs font-normal text-slate-400">roles</span>
                  </div>
                  <div className="mt-3 w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(visiblePct, 5)}%`, backgroundColor: chartColorFor(domain.name) }}
                    />
                  </div>
                </div>
              )})}
            </div>
            <ChartLegend
              items={domainData.map((domain) => ({ id: domain.name, label: domain.name, color: chartColorFor(domain.name), value: domain.count }))}
              hiddenItems={hiddenDomains}
              onToggle={(id) => setHiddenDomains((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
              onHighlight={setHighlightedDashboardSeries}
              className="mt-3"
            />
            </>
          )}
        </div>
      )}

      {activeTab === 'market' && !fullAnalyticsMenu && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Remote Work</span>
              <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">42%</div>
              <p className="text-xs text-slate-400 mt-1">High flexibility cross-border talent</p>
            </div>
            <div className="p-4 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Hybrid Structure</span>
              <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">38%</div>
              <p className="text-xs text-slate-400 mt-1">Balanced studio & remote presence</p>
            </div>
            <div className="p-4 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">On-Site Campus</span>
              <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">20%</div>
              <p className="text-xs text-slate-400 mt-1">Lab and physical infrastructure roles</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
