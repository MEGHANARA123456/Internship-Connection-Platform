import { ResponsiveBars, ResponsiveLineChart, type ChartDatum } from '../charts/ResponsiveChart'

interface ResponsiveOverviewChartProps {
  type: 'funnel' | 'activity'
  label: string
  items?: ChartDatum[]
  series?: Array<{ label: string; values: ChartDatum[]; color: string }>
}

export function ResponsiveOverviewChart({ type, label, items = [], series = [] }: ResponsiveOverviewChartProps) {
  if (type === 'funnel') return <ResponsiveBars label={label} items={items} />
  return <ResponsiveLineChart label={label} series={series} />
}
