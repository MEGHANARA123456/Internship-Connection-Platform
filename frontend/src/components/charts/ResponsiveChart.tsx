import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChartLegend, type ChartLegendItem } from './ChartLegend'
import { assignColors } from './chartColors'
import { auditActionLabel } from '../../lib/auditActionLabels'

interface ResponsiveChartProps {
  label: string
  summary: string
  aspectRatio?: number
  children: (size: { width: number; height: number }) => ReactNode
}

function ResponsiveChart({
  label,
  summary,
  aspectRatio = 2.4,
  children,
}: ResponsiveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  const height = Math.max(120, width / aspectRatio)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateWidth = () => {
      const measured = container.getBoundingClientRect().width
      if (measured > 0) setWidth(measured)
    }
    updateWidth()
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(updateWidth)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="w-full min-w-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={label}
        className="block h-auto w-full overflow-hidden"
        preserveAspectRatio="xMidYMid meet"
      >
        <title>{label}</title>
        <desc>{summary}</desc>
        {children({ width, height })}
      </svg>
      <p className="sr-only">{summary || `${label}: no data.`}</p>
    </div>
  )
}

export type ChartDatum = { label: string; value: number; detail?: string }

function uniqueLabels(items: ChartDatum[], maxLength: number): string[] {
  const seen = new Set<string>()
  return items.map((item) => {
    const fullLabel = auditActionLabel(item.label)
    const base = fullLabel.length > maxLength ? `${fullLabel.slice(0, maxLength - 1).trimEnd()}…` : fullLabel
    let candidate = base
    let suffix = 2
    while (seen.has(candidate.toLocaleLowerCase())) {
      const marker = ` (${suffix++})`
      candidate = `${base.slice(0, Math.max(1, maxLength - marker.length)).trimEnd()}${marker}`
    }
    seen.add(candidate.toLocaleLowerCase())
    return candidate
  })
}

export function ResponsiveBars({
  label,
  items,
  orientation = 'horizontal',
}: {
  label: string
  items: ChartDatum[]
  orientation?: 'horizontal' | 'vertical'
}) {
  const [active, setActive] = useState<number | null>(null)
  const visibleItems = items
  const itemColors = assignColors(visibleItems.map((item) => item.label))
  const shortLabels = uniqueLabels(visibleItems, 22)
  const summary = items.map((item) => `${item.label}: ${item.value}${item.detail ? `, ${item.detail}` : ''}`).join('; ')
  const horizontal = orientation === 'horizontal'
  return (
    <section data-chart-panel className="flex min-w-0 flex-col gap-4 overflow-hidden rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">{label}</h3>
      <ResponsiveChart label={label} summary={summary} aspectRatio={horizontal ? 2.8 : 2.2}>
        {({ width, height }) => {
        const left = horizontal ? Math.min(width * 0.35, 190) : 18
        const right = 18
        const top = 12
        const bottom = horizontal ? 12 : 38
        const plotWidth = Math.max(10, width - left - right)
        const plotHeight = Math.max(10, height - top - bottom)
        const max = Math.max(...visibleItems.map((item) => item.value), 1)
        const rowHeight = plotHeight / Math.max(visibleItems.length, 1)
        const labelSize = Math.max(9, Math.min(13, width / 85))
        return (
          <g>
            {visibleItems.map((item, index) => {
              const itemColor = itemColors[item.label]
              const intensity = 0.4 + 0.6 * item.value / max
              const isHighlighted = active === null || active === index
              const title = `${item.label}: ${item.value}${item.detail ? ` · ${item.detail}` : ''}`
              if (horizontal) {
                const barWidth = (item.value / max) * plotWidth
                const y = top + index * rowHeight + rowHeight * 0.2
                const barHeight = Math.max(6, rowHeight * 0.56)
                const shortLabel = shortLabels[index]
                const valueX = Math.min(left + barWidth + 7, width - right)
                return (
                  <g key={item.label} tabIndex={0} role="graphics-symbol" aria-label={title} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onClick={() => setActive(active === index ? null : index)} className="cursor-pointer">
                    <title>{title}</title>
                    <text x={left - 8} y={y + barHeight * 0.82} textAnchor="end" fontSize={labelSize} fill="currentColor" className="fill-slate-600 dark:fill-slate-300"><title>{auditActionLabel(item.label)}</title>{shortLabel}</text>
                    <rect x={left} y={y} width={plotWidth} height={barHeight} rx={barHeight / 2} fill="#e2e8f0" className="dark:fill-slate-800" />
                    <rect x={left} y={y} width={barWidth} height={barHeight} rx={barHeight / 2} fill={itemColor} opacity={isHighlighted ? intensity : 0.25} />
                    <text x={valueX} y={y + barHeight * 0.82} textAnchor={valueX >= width - right ? 'end' : 'start'} fontSize={labelSize} fill="currentColor" className="fill-slate-700 dark:fill-slate-200">{item.value}</text>
                    {active === index && <text x={left + Math.min(barWidth, plotWidth - 20)} y={y - 2} textAnchor="end" fontSize={labelSize} fill="currentColor" className="fill-slate-500 dark:fill-slate-300">{item.detail}</text>}
                  </g>
                )
              }
              const slot = plotWidth / Math.max(visibleItems.length, 1)
              const barWidth = Math.max(5, Math.min(slot * 0.62, 54))
              const barHeight = (item.value / max) * plotHeight
              const x = left + slot * index + (slot - barWidth) / 2
              const y = top + plotHeight - barHeight
              return (
                <g key={item.label} tabIndex={0} role="graphics-symbol" aria-label={title} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onClick={() => setActive(active === index ? null : index)} className="cursor-pointer">
                  <title>{title}</title>
                  <rect x={x} y={top} width={barWidth} height={plotHeight} rx={5} fill="#e2e8f0" className="dark:fill-slate-800" />
                  <rect x={x} y={y} width={barWidth} height={Math.max(barHeight, item.value > 0 ? 2 : 0)} rx={5} fill={itemColor} opacity={isHighlighted ? intensity : 0.25} />
                  <text x={x + barWidth / 2} y={height - 12} textAnchor="middle" fontSize={labelSize} fill="currentColor" className="fill-slate-600 dark:fill-slate-300"><title>{auditActionLabel(item.label)}</title>{shortLabels[index]}</text>
                  {active === index && <text x={x + barWidth / 2} y={Math.max(top + labelSize, y - 5)} textAnchor="middle" fontSize={labelSize} fill="currentColor" className="fill-slate-700 dark:fill-slate-200">{item.value}</text>}
                </g>
              )
            })}
          </g>
        )
        }}
      </ResponsiveChart>
      {active !== null && visibleItems[active] && (
        <p role="tooltip" className="rounded-md bg-slate-900 px-2 py-1 text-xs text-white dark:bg-slate-700">
          {visibleItems[active].label}: {visibleItems[active].value}{visibleItems[active].detail ? ` · ${visibleItems[active].detail}` : ''}
        </p>
      )}
    </section>
  )
}

export function ResponsiveDonut({
  label,
  items,
}: {
  label: string
  items: ChartDatum[]
}) {
  const [active, setActive] = useState<number | null>(null)
  const [hidden, setHidden] = useState<string[]>([])
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const visibleItems = items.filter((item) => !hidden.includes(item.label))
  const itemColors = assignColors(items.map((item) => item.label))
  const total = items.reduce((sum, item) => sum + item.value, 0)
  const summary = items.map((item) => `${item.label}: ${item.value}`).join('; ')
  const legendItems: ChartLegendItem[] = items.map((item) => ({
    id: item.label,
    label: item.label,
    color: itemColors[item.label],
    value: item.value,
    percentage: total ? Math.round(item.value / total * 100) : 0,
    shape: 'circle',
  }))
  let offset = 0
  return (
    <section data-chart-panel className="flex min-w-0 flex-col gap-4 overflow-hidden rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">{label}</h3>
      <div className="flex min-w-0 flex-col items-center gap-3 md:flex-row md:items-center md:justify-between">
      <div className="w-full min-w-0 md:w-2/3">
      <ResponsiveChart label={label} summary={summary} aspectRatio={1}>
        {({ width }) => {
          const radius = Math.min(width * 0.34, width / 2 - 8)
          const ring = Math.PI * radius * 2
          return (
            <g transform={`translate(${width / 2},${width / 2})`}>
              <circle r={radius} fill="none" stroke="#e2e8f0" strokeWidth="13" className="dark:stroke-slate-800" />
              {total > 0 && visibleItems.map((item, index) => {
                const length = (item.value / total) * ring
                const dashOffset = offset
                offset += length
                const itemColor = itemColors[item.label]
                return (
                  <g key={item.label} opacity={highlighted === null || highlighted === item.label ? 1 : 0.25}>
                    <circle r={radius} fill="none" stroke="#ffffff" className="dark:stroke-slate-900" strokeWidth="15" strokeDasharray={`${length} ${ring - length}`} strokeDashoffset={-dashOffset} transform="rotate(-90)" />
                    <circle r={radius} fill="none" stroke={itemColor} strokeWidth="13" strokeDasharray={`${length} ${ring - length}`} strokeDashoffset={-dashOffset} transform="rotate(-90)" tabIndex={0} onMouseEnter={() => { setActive(index); setHighlighted(item.label) }} onMouseLeave={() => { setActive(null); setHighlighted(null) }} onFocus={() => { setActive(index); setHighlighted(item.label) }} onBlur={() => { setActive(null); setHighlighted(null) }} onClick={() => setActive(active === index ? null : index)}>
                      <title>{`${item.label}: ${item.value}`}</title>
                    </circle>
                  </g>
                )
              })}
              <text y="-1" textAnchor="middle" fontSize={Math.max(13, width * 0.08)} fontWeight="700" fill="currentColor" className="fill-slate-900 dark:fill-white">{active === null ? total : visibleItems[active]?.value}</text>
              <text y="13" textAnchor="middle" fontSize="7" fill="currentColor" className="fill-slate-500 dark:fill-slate-400">{active === null ? 'total' : visibleItems[active]?.label.slice(0, 14)}</text>
            </g>
          )
        }}
      </ResponsiveChart>
      </div>
      <div className="w-full min-w-0 md:w-1/3">
        <ChartLegend items={legendItems} hiddenItems={hidden} onToggle={(id) => setHidden((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id])} onHighlight={setHighlighted} className="justify-center md:justify-start" />
      </div>
      </div>
    </section>
  )
}

export function ResponsiveStackedBars({
  label,
  items,
  series,
}: {
  label: string
  items: Array<{ label: string; values: number[] }>
  series: Array<{ label: string; color: string }>
}) {
  const [hidden, setHidden] = useState<string[]>([])
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [activeRow, setActiveRow] = useState<number | null>(null)
  const visibleSeries = series.filter((item) => !hidden.includes(item.label))
  const seriesColors = assignColors(series.map((item) => item.label))
  const seriesTotals = series.map((_, index) => items.reduce((sum, item) => sum + (item.values[index] ?? 0), 0))
  const legendItems: ChartLegendItem[] = series.map((item, index) => ({
    id: item.label,
    label: item.label,
    color: seriesColors[item.label],
    value: seriesTotals[index],
    shape: 'square',
  }))
  const summary = items.map((item) => `${item.label}: ${item.values.map((value, index) => `${series[index]?.label} ${value}`).join(', ')}`).join('; ')
  return (
    <section data-chart-panel className="flex min-w-0 flex-col gap-4 overflow-hidden rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">{label}</h3>
      <ResponsiveChart label={label} summary={summary} aspectRatio={2.5}>
        {({ width, height }) => {
          const left = Math.min(width * 0.32, 180)
          const plotWidth = width - left - 16
          const rowHeight = (height - 16) / Math.max(items.length, 1)
          const labelSize = Math.max(9, Math.min(13, width / 85))
          return <g>{items.map((item, row) => {
            const total = Math.max(visibleSeries.reduce((sum, current) => sum + (item.values[series.findIndex((entry) => entry.label === current.label)] ?? 0), 0), 1)
            let x = left
            const y = 8 + row * rowHeight + rowHeight * 0.2
            const barHeight = Math.max(8, rowHeight * 0.55)
            const labelLimit = Math.max(7, Math.floor((left - 16) / (labelSize * 0.58)))
            const shortLabel = item.label.length > labelLimit ? `${item.label.slice(0, labelLimit - 1)}…` : item.label
            return <g key={item.label} tabIndex={0} role="graphics-symbol" aria-label={`${item.label}: ${summary}`} onMouseEnter={() => setActiveRow(row)} onMouseLeave={() => setActiveRow(null)} onFocus={() => setActiveRow(row)} onBlur={() => setActiveRow(null)} onClick={() => setActiveRow(activeRow === row ? null : row)}>
              <title>{`${item.label}: ${item.values.join(', ')}`}</title>
              <text x={left - 8} y={y + barHeight * 0.82} textAnchor="end" fontSize={labelSize} className="fill-slate-600 dark:fill-slate-300"><title>{item.label}</title>{shortLabel}</text>
              {visibleSeries.map((current) => {
                const index = series.findIndex((entry) => entry.label === current.label)
                const value = item.values[index] ?? 0
                const segmentWidth = (value / total) * plotWidth
                const segmentX = x
                x += segmentWidth
                return segmentWidth > 0 ? <rect key={current.label} x={segmentX} y={y} width={segmentWidth} height={barHeight} fill={seriesColors[current.label]} opacity={highlighted === null || highlighted === current.label ? 1 : 0.25}><title>{`${item.label} · ${current.label}: ${value}`}</title></rect> : null
              })}
            </g>
          })}</g>
        }}
      </ResponsiveChart>
      {activeRow !== null && items[activeRow] && (
        <p role="tooltip" className="rounded-md bg-slate-900 px-2 py-1 text-xs text-white dark:bg-slate-700">
          {items[activeRow].label}: {visibleSeries.map((item) => `${item.label} ${items[activeRow].values[series.findIndex((entry) => entry.label === item.label)] ?? 0}`).join(' · ')}
        </p>
      )}
      <ChartLegend items={legendItems} hiddenItems={hidden} onToggle={(id) => setHidden((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id])} onHighlight={setHighlighted} />
    </section>
  )
}

export function ResponsiveLineChart({
  label,
  series,
}: {
  label: string
  series: Array<{ label: string; values: ChartDatum[]; color: string }>
}) {
  const [active, setActive] = useState<{ series: number; index: number } | null>(null)
  const [hidden, setHidden] = useState<string[]>([])
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const visibleSeries = series.filter((line) => !hidden.includes(line.label))
  const seriesColors = assignColors(series.map((line) => line.label))
  const legendItems: ChartLegendItem[] = series.map((line) => ({
    id: line.label,
    label: line.label,
    color: seriesColors[line.label],
    shape: 'line',
  }))
  const summary = series.map((line) => `${line.label}: ${line.values.map((item) => `${item.label} ${item.value}`).join(', ')}`).join('; ')
  const values = visibleSeries.flatMap((line) => line.values.map((item) => item.value))
  const max = Math.max(...values, 1)
  return (
    <section data-chart-panel className="flex min-w-0 flex-col gap-4 overflow-hidden rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">{label}</h3>
      <ResponsiveChart label={label} summary={summary} aspectRatio={2.5}>
        {({ width, height }) => {
          const left = 34
          const right = 14
          const top = 12
          const bottom = 30
          const plotWidth = width - left - right
          const plotHeight = height - top - bottom
          const pointsFor = (data: ChartDatum[]) => data.map((item, index) => ({
            item,
            x: left + (data.length <= 1 ? plotWidth / 2 : index * plotWidth / (data.length - 1)),
            y: top + plotHeight - (item.value / max) * plotHeight,
          }))
          return <g>
            {[0, 1, 2].map((index) => {
              const y = top + (plotHeight * index) / 2
              return <line key={index} x1={left} x2={width - right} y1={y} y2={y} stroke="#cbd5e1" strokeDasharray="3 4" className="dark:stroke-slate-700" />
            })}
            {visibleSeries.map((line, lineIndex) => {
              const lineColor = seriesColors[line.label]
              const points = pointsFor(line.values)
              const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
              return <g key={line.label}>
                <path d={path} fill="none" stroke={lineColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity={highlighted === null || highlighted === line.label ? 1 : 0.25} />
                {points.map(({ item, x, y }, index) => {
                  const showLabel = width >= 640 || index % (points.length > 6 ? 3 : 2) === 0
                  return <g key={`${line.label}-${item.label}`} tabIndex={0} role="graphics-symbol" aria-label={`${line.label}, ${item.label}: ${item.value}`} onMouseEnter={() => setActive({ series: lineIndex, index })} onMouseLeave={() => setActive(null)} onFocus={() => setActive({ series: lineIndex, index })} onBlur={() => setActive(null)} onClick={() => setActive(active?.series === lineIndex && active.index === index ? null : { series: lineIndex, index })}>
                    <title>{`${line.label}, ${item.label}: ${item.value}`}</title>
                    <circle cx={x} cy={y} r={active?.series === lineIndex && active.index === index ? 6 : 4} fill={lineColor} stroke="white" strokeWidth="2" />
                    {showLabel && lineIndex === 0 && <text x={x} y={height - 9} textAnchor="middle" fontSize={Math.max(9, Math.min(12, width / 90))} className="fill-slate-600 dark:fill-slate-300"><title>{item.label}</title>{item.label}</text>}
                    {active?.series === lineIndex && active.index === index && <text x={x} y={Math.max(top + 10, y - 8)} textAnchor="middle" fontSize="11" className="fill-slate-700 dark:fill-slate-200">{item.value}</text>}
                  </g>
                })}
              </g>
            })}
          </g>
        }}
      </ResponsiveChart>
      <ChartLegend items={legendItems} hiddenItems={hidden} onToggle={(id) => setHidden((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id])} onHighlight={setHighlighted} />
    </section>
  )
}
