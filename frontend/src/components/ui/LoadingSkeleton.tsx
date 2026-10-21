import React from 'react'
import { cn } from '../../lib/utils'
import { Loader2 } from 'lucide-react'

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'skeleton-shimmer rounded-md bg-slate-200/80 dark:bg-slate-800',
        className,
      )}
      {...props}
    />
  )
}

export function Spinner({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <Loader2
      role="status"
      aria-label="Loading"
      className={cn('h-5 w-5 animate-spin motion-reduce:animate-none', className)}
      {...props}
    />
  )
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-label="Loading chart"
      role="status"
      className={cn(
        'h-[280px] min-h-[280px] rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900',
        className,
      )}
    >
      <Skeleton className="mb-5 h-4 w-36" />
      <div className="flex h-[210px] items-end gap-3">
        {[45, 72, 56, 88, 62, 76].map((height, index) => (
          <Skeleton key={index} className="flex-1 rounded-t-md" style={{ height: `${height}%` }} />
        ))}
      </div>
    </div>
  )
}

export function KpiSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-label="Loading statistic"
      role="status"
      className={cn(
        'min-h-[124px] rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
      <Skeleton className="mt-2 h-7 w-16" />
      <Skeleton className="mt-2 h-3 w-24" />
    </div>
  )
}

export function PageLoader() {
  return (
    <div
      className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-3 text-sm text-slate-500 dark:text-slate-400"
      role="status"
      aria-live="polite"
    >
      <Spinner className="h-7 w-7 text-indigo-600 dark:text-indigo-400" />
      <span>Loading page...</span>
    </div>
  )
}

export function CardSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <div className="flex gap-2 pt-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
      </div>
    </div>
  )
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 w-full">
      <Skeleton className="h-10 w-full rounded-lg" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  )
}
