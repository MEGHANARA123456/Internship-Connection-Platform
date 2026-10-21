import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { RechartsAnalyticsCharts } from './RechartsAnalyticsCharts'

const domainRows = [
  { name: 'Artificial Intelligence / Machine Learning', count: 4 },
  { name: 'Artificial Intelligence / Machine learning', count: 2 },
]

describe('Recharts analytics legends', () => {
  it('omits category chips for ranked bars while retaining full names and merged counts in tables', () => {
    render(<MemoryRouter><RechartsAnalyticsCharts kind="domains" label="Roles by domain" rows={domainRows} viewAsTable={false} /></MemoryRouter>)
    expect(screen.queryByRole('group', { name: 'Chart legend' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: /Roles by domain/ })).toBeInTheDocument()
    expect(screen.queryByText(/^n=\d+/)).not.toBeInTheDocument()

    render(<MemoryRouter><RechartsAnalyticsCharts kind="domains" label="Roles by domain" rows={domainRows} viewAsTable /></MemoryRouter>)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('Artificial Intelligence / Machine Learning, Artificial Intelligence / Machine learning')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
  })

  it('lists all series in an area chart and stack statuses in a stacked chart', () => {
    const trendRows = [{ name: 'Oct 1', date: '2026-10-01', count: 4, applications: 4, interviews: 2, offers: 1 }]
    const { unmount } = render(<MemoryRouter><RechartsAnalyticsCharts kind="trends" label="Activity trends" rows={trendRows} viewAsTable={false} /></MemoryRouter>)
    let legend = screen.getByRole('group', { name: 'Chart legend' })
    expect(within(legend).getByRole('button', { name: /Applications/ })).toBeInTheDocument()
    expect(within(legend).getByRole('button', { name: /Interview-stage applications/ })).toBeInTheDocument()
    expect(within(legend).getByRole('button', { name: /Offers/ })).toBeInTheDocument()
    unmount()

    render(<MemoryRouter><RechartsAnalyticsCharts kind="top_companies" label="Top companies applied to" rows={[
      { name: 'Company A', count: 5, applied: 3, under_review: 1, rejected: 1 },
    ]} viewAsTable={false} /></MemoryRouter>)
    legend = screen.getByRole('group', { name: 'Chart legend' })
    expect(within(legend).getByRole('button', { name: /Applied/ })).toBeInTheDocument()
    expect(within(legend).getByRole('button', { name: /Under review/ })).toBeInTheDocument()
    fireEvent.click(within(legend).getByRole('button', { name: '+2 more' }))
    expect(within(legend).getByRole('button', { name: /Rejected/ })).toBeInTheDocument()
  })

  it('keeps the data table available when table mode is selected', () => {
    render(<MemoryRouter><RechartsAnalyticsCharts kind="domains" label="Roles by domain" rows={domainRows} viewAsTable /></MemoryRouter>)

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('Artificial Intelligence / Machine Learning, Artificial Intelligence / Machine learning')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Chart legend' })).not.toBeInTheDocument()
  })
})
