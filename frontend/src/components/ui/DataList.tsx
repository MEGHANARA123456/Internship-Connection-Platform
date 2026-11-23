import type { Key, ReactNode } from 'react'

interface DataListColumn<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
}

interface DataListProps<T> {
  ariaLabel: string
  rows: T[]
  getRowKey: (row: T) => Key
  columns: DataListColumn<T>[]
  actions?: (row: T) => ReactNode
  loading?: boolean
  emptyState?: ReactNode
}

export function DataList<T>({
  ariaLabel,
  rows,
  getRowKey,
  columns,
  actions,
  loading = false,
  emptyState = 'No items found.',
}: DataListProps<T>) {
  if (loading && rows.length === 0) {
    return <p role="status" className="text-sm text-slate-500">Loading…</p>
  }
  if (rows.length === 0) {
    return <p className="rounded-xl border border-dashed p-6 text-sm text-slate-500">{emptyState}</p>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <table aria-label={ariaLabel} className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-300">
          <tr>
            {columns.map((column) => <th key={column.key} scope="col" className="px-4 py-3">{column.header}</th>)}
            {actions && <th scope="col" className="px-4 py-3">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((column) => <td key={column.key} className="px-4 py-3 align-top">{column.render(row)}</td>)}
              {actions && <td className="px-4 py-3 align-top">{actions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
