import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { RechartsAnalyticsCharts } from './RechartsAnalyticsCharts'
import { ResponsiveDonut } from '../charts/ResponsiveChart'

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

  it('shows all admin action types with readable fallback labels', () => {
    render(<MemoryRouter><RechartsAnalyticsCharts kind="admin_actions_by_type" label="Admin actions by type" rows={[
      { name: 'Postings approved', action: 'posting_approved', count: 3 },
      { name: 'Companies verified', action: 'company_verified', count: 2 },
      { name: 'Future Admin Action', action: 'future_admin_action', count: 1 },
    ]} viewAsTable /></MemoryRouter>)

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('Postings approved')).toBeInTheDocument()
    expect(screen.getByText('Companies verified')).toBeInTheDocument()
    expect(screen.getByText('Future admin action')).toBeInTheDocument()
  })

  it('uses distinct fixed work-mode colors for donut slices and matching legend swatches', () => {
    render(<MemoryRouter><RechartsAnalyticsCharts kind="work_modes" label="Work-mode split" rows={[
      { name: 'Remote', count: 4 },
      { name: 'Onsite', count: 3 },
      { name: 'Hybrid', count: 2 },
    ]} viewAsTable={false} /></MemoryRouter>)

    const legend = screen.getByRole('group', { name: 'Chart legend' })
    const expectedColors = ['#0072B2', '#E69F00', '#009E73']
    const legendColors = ['Remote', 'Onsite', 'Hybrid'].map((label) => {
      const button = within(legend).getByRole('button', { name: new RegExp(label) })
      return button.querySelector('span[aria-hidden="true"]')?.getAttribute('style')
    })
    expect(legendColors).toEqual([
      'background-color: rgb(0, 114, 178);',
      'background-color: rgb(230, 159, 0);',
      'background-color: rgb(0, 158, 115);',
    ])

    const { container } = render(<ResponsiveDonut label="Work-mode split" items={[
      { label: 'Remote', value: 4 },
      { label: 'Onsite', value: 3 },
      { label: 'Hybrid', value: 2 },
    ]} />)
    const sliceColors = Array.from(container.querySelectorAll('circle[stroke]')).map((circle) => circle.getAttribute('stroke'))
    for (const color of expectedColors) expect(sliceColors).toContain(color)
  })
})
