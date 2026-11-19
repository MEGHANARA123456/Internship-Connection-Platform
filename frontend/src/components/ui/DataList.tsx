import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface DataListColumn<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  className?: string
}

interface DataListProps<T> {
  ariaLabel: string
  rows: readonly T[]
  columns: readonly DataListColumn<T>[]
  getRowKey: (row: T, index: number) => string | number
  actions?: (row: T) => ReactNode
  actionsLabel?: string
  loading?: boolean
  skeletonRows?: number
  emptyState?: ReactNode
  className?: string
}

export function DataList<T>({
  ariaLabel,
  rows,
  columns,
  getRowKey,
  actions,
  actionsLabel = 'Actions',
  loading = false,
  skeletonRows = 4,
  emptyState = 'No items to display.',
  className,
}: DataListProps<T>) {
  const hasActions = Boolean(actions)

  if (loading && rows.length === 0) {
    return (
      <div aria-label={`Loading ${ariaLabel}`} role="status" className={cn('space-y-3', className)}>
        {Array.from({ length: skeletonRows }, (_, index) => (
          <div
            key={index}
            className="h-16 animate-pulse rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800"
          />
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className={cn('rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400', className)}>
        {emptyState}
      </div>
    )
  }

  return (
    <div
      aria-label={ariaLabel}
      aria-busy={loading}
      className={cn('overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900', className)}
    >
      <table aria-label={ariaLabel} className="hidden w-full text-left text-sm md:table">
        <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-300">
          <tr>
            {columns.map((column) => <th key={column.key} scope="col" className="px-4 py-3">{column.header}</th>)}
            {hasActions && <th scope="col" className="px-4 py-3 text-right">{actionsLabel}</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {rows.map((row, index) => (
            <tr key={getRowKey(row, index)} className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
              {columns.map((column) => (
                <td key={column.key} className={cn('px-4 py-3 align-middle', column.className)}>
                  {column.render(row)}
                </td>
              ))}
              {hasActions && <td className="px-4 py-3 align-middle"><div className="flex items-center justify-end gap-1">{actions?.(row)}</div></td>}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="divide-y divide-slate-200 md:hidden dark:divide-slate-800">
        {rows.map((row, index) => (
          <article key={getRowKey(row, index)} className="space-y-3 p-4 transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
            <dl className="grid gap-3">
              {columns.map((column) => (
                <div key={column.key} className={cn('min-w-0', column.className)}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{column.header}</dt>
                  <dd className="mt-1 min-w-0">{column.render(row)}</dd>
                </div>
              ))}
            </dl>
            {hasActions && <div className="flex items-center justify-end gap-1 border-t border-slate-100 pt-2 dark:border-slate-800">{actions?.(row)}</div>}
          </article>
        ))}
      </div>
      <span className="sr-only" aria-live="polite">{rows.length} items</span>
    </div>
  )
}
