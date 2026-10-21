import { useId, useState } from 'react'
import { auditActionLabel } from '../../lib/auditActionLabels'

export interface ChartLegendItem {
  id: string
  label: string
  color: string
  shape?: 'square' | 'circle' | 'line' | 'dashed'
  value?: number
  percentage?: number
}

interface ChartLegendProps {
  items: ChartLegendItem[]
  hiddenItems?: string[]
  onToggle?: (id: string) => void
  onHighlight?: (id: string | null) => void
  className?: string
}

export function ChartLegend({
  items,
  hiddenItems = [],
  onToggle,
  onHighlight,
  className = '',
}: ChartLegendProps) {
  const [localHidden, setLocalHidden] = useState<string[]>([])
  const [showMore, setShowMore] = useState(false)
  const overflowId = useId()
  const hidden = onToggle ? hiddenItems : localHidden

  if (items.length === 0) return null
  const visibleItems = items.slice(0, 6)
  const total = items.reduce((sum, item) => sum + (item.value ?? 0), 0)
  const readable = (label: string) => auditActionLabel(label)

  const toggle = (id: string) => {
    if (onToggle) {
      onToggle(id)
    } else {
      setLocalHidden((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id])
    }
  }

  return (
    <div role="group" aria-label="Chart legend" className={`relative flex flex-wrap items-center justify-start gap-x-4 gap-y-2 text-xs ${className}`}>
      {visibleItems.map((item) => {
        const isVisible = !hidden.includes(item.id)
        const shape = item.shape ?? 'square'
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={isVisible}
            title={readable(item.label)}
            onClick={() => toggle(item.id)}
            onMouseEnter={() => onHighlight?.(item.id)}
            onMouseLeave={() => onHighlight?.(null)}
            onFocus={() => onHighlight?.(item.id)}
            onBlur={() => onHighlight?.(null)}
            className={`inline-flex max-w-full items-center gap-2 rounded-sm text-left text-slate-700 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:text-white ${isVisible ? '' : 'opacity-50'}`}
          >
            <span
              aria-hidden="true"
              className={`shrink-0 ${shape === 'line' || shape === 'dashed' ? 'h-0 w-4 border-t-2' : shape === 'circle' ? 'h-2.5 w-2.5 rounded-full' : 'h-2.5 w-2.5 rounded-sm'} ${shape === 'dashed' ? 'border-dashed' : ''}`}
              style={shape === 'line' || shape === 'dashed' ? { borderColor: item.color } : { backgroundColor: item.color }}
            />
            <span className="whitespace-normal">{readable(item.label)}</span>
            {item.value !== undefined && <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{item.value.toLocaleString()}</span>}
            {(item.percentage !== undefined || (item.value !== undefined && total > 0)) && (
              <span className="font-semibold tabular-nums text-slate-900 dark:text-white">
                {item.percentage ?? Math.round((item.value ?? 0) / total * 100)}%
              </span>
            )}
          </button>
        )
      })}
      {items.length > 6 && (
        <>
          <button
            type="button"
            aria-expanded={showMore}
            aria-controls={overflowId}
            onClick={() => setShowMore((open) => !open)}
            className="rounded px-1.5 py-1 font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-slate-800"
          >
            {showMore ? 'Show less' : `+${items.length - 6} more`}
          </button>
          {showMore && (
            <div
              id={overflowId}
              role="dialog"
              aria-label="More chart legend entries"
              className="basis-full rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {items.slice(6).map((item) => {
                  const isVisible = !hidden.includes(item.id)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={isVisible}
                      title={readable(item.label)}
                      onClick={() => toggle(item.id)}
                      onMouseEnter={() => onHighlight?.(item.id)}
                      onMouseLeave={() => onHighlight?.(null)}
                      onFocus={() => onHighlight?.(item.id)}
                      onBlur={() => onHighlight?.(null)}
                      className={`inline-flex max-w-full items-center gap-2 rounded-sm text-left text-slate-700 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:text-white ${isVisible ? '' : 'opacity-50'}`}
                    >
                      <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: item.color }} />
                      <span className="whitespace-normal">{readable(item.label)}</span>
                      {item.value !== undefined && <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{item.value.toLocaleString()}</span>}
                      {(item.percentage !== undefined || (item.value !== undefined && total > 0)) && (
                        <span className="font-semibold tabular-nums text-slate-900 dark:text-white">
                          {item.percentage ?? Math.round((item.value ?? 0) / total * 100)}%
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
