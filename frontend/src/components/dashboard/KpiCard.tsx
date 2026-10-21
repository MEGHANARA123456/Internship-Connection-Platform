import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Info } from 'lucide-react'
import { Card } from '../ui/Card'
import { KpiSkeleton } from '../ui/LoadingSkeleton'
import { Button } from '../ui/Button'

type KpiCardProps = {
  label: string
  value: string | number
  caption: ReactNode
  icon: ReactNode
  href?: string
  info?: string
  loading?: boolean
  error?: boolean
  onRetry?: () => void
}

export function KpiCard({
  label,
  value,
  caption,
  icon,
  href,
  info,
  loading = false,
  error = false,
  onRetry,
}: KpiCardProps) {
  if (loading) return <KpiSkeleton className="h-full min-h-[124px]" />
  const metric = (
    <>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <span title={label} className="min-w-0 text-xs font-semibold leading-4 text-slate-600 dark:text-slate-300">{label}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
          <span className="rounded-lg bg-indigo-50 p-1.5 dark:bg-indigo-950/50">{icon}</span>
          {href && <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 opacity-50" />}
        </span>
      </div>
      <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{value}</p>
    </>
  )
  return (
    <Card className={`flex h-full min-h-[124px] flex-col gap-2 p-4 transition-colors ${href ? 'hover:border-indigo-300 dark:hover:border-indigo-700' : ''} ${error ? 'border-rose-200 dark:border-rose-900' : ''}`}>
      {href && !error ? (
        <Link to={href} aria-label={`${label}: ${value}. View ${label.toLowerCase()}.`} className="block space-y-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
          {metric}
        </Link>
      ) : error ? (
        <>
          <p title={label} className="text-xs font-semibold leading-4 text-slate-600 dark:text-slate-300">{label}</p>
          <div className="flex flex-1 flex-col justify-end gap-1">
            <p className="text-xs text-rose-700 dark:text-rose-300">Couldn&apos;t load this metric.</p>
            {onRetry && <Button size="sm" variant="outline" onClick={onRetry} className="w-fit">Retry</Button>}
          </div>
        </>
      ) : metric}
      {!error && (
        <>
          <div className="flex min-w-0 items-center gap-1 text-[10px] leading-4 text-slate-500 dark:text-slate-400">
            <span title={typeof caption === 'string' ? caption : undefined} className="min-w-0 flex-1 truncate">{caption}</span>
            {info && (
              <span
                title={info}
                aria-label={`${label} information`}
                className="shrink-0 cursor-help rounded-full text-slate-400 dark:text-slate-500"
              >
                <Info className="h-3 w-3" />
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  )
}
