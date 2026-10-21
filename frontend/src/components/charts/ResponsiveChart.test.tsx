import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResponsiveBars, ResponsiveDonut, ResponsiveLineChart, ResponsiveStackedBars } from './ResponsiveChart'

class ResizeObserverMock {
  private readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }
  observe() { this.callback([], this as unknown as ResizeObserver) }
  unobserve() {}
  disconnect() {}
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Responsive chart sizing', () => {
  it.each([360, 1280])('renders within a %i-pixel container', async (width) => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width,
      height: 0,
      top: 0,
      right: width,
      bottom: 0,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    render(<ResponsiveBars label="Applications by week" orientation="vertical" items={[
      { label: 'Week 1', value: 0 },
      { label: 'Week 2', value: 3 },
      { label: 'Week 3', value: 0 },
      { label: 'Week 4', value: 1 },
      { label: 'Week 5', value: 0 },
      { label: 'Week 6', value: 2 },
      { label: 'Week 7', value: 0 },
      { label: 'Week 8', value: 4 },
    ]} />)

    const chart = await screen.findByRole('img', { name: 'Applications by week' })
    expect(chart).toHaveAttribute('viewBox', `0 0 ${width} ${width / 2.2}`)
    expect(chart).toHaveAttribute('width', '100%')
  })

  it('keeps ranked bars free of duplicate/truncated category legends', async () => {
    render(<ResponsiveBars label="Roles by domain" items={[
      { label: 'Artificial Intelligence / Machine Learning', value: 4 },
      { label: 'Artificial Intelligence / Product Design', value: 2 },
    ]} />)

    const chart = await screen.findByRole('img', { name: 'Roles by domain' })
    const labelNodes = Array.from(chart.querySelectorAll('text')).filter((node) => node.querySelector('title'))
    const visibleLabels = labelNodes.map((node) => node.childNodes[1]?.textContent?.trim())
    expect(visibleLabels[0]).toContain('…')
    expect(visibleLabels[1]).toContain('(2)')
    expect(new Set(visibleLabels).size).toBe(2)
    expect(labelNodes.map((node) => node.querySelector('title')?.textContent?.toLowerCase())).toEqual([
      'artificial intelligence / machine learning',
      'artificial intelligence / product design',
    ])
    expect(screen.queryByRole('group', { name: 'Chart legend' })).not.toBeInTheDocument()
  })

  it('shows category counts and percentages in the donut legend and toggles slices', () => {
    render(<ResponsiveDonut label="Application status mix" items={[
      { label: 'Applied', value: 3 },
      { label: 'Shortlisted', value: 1 },
    ]} />)

    const legend = screen.getByRole('group', { name: 'Chart legend' })
    expect(within(legend).getByRole('button', { name: /Applied.*3.*75%/ })).toHaveAttribute('aria-pressed', 'true')
    const shortlisted = within(legend).getByRole('button', { name: /Shortlisted.*1.*25%/ })
    fireEvent.click(shortlisted)
    expect(shortlisted).toHaveAttribute('aria-pressed', 'false')
  })

  it('lists stacked-bar segments and line-series names with interactive state', () => {
    const { unmount } = render(<ResponsiveStackedBars
      label="Applications by company"
      items={[{ label: 'Company A', values: [2, 1] }]}
      series={[{ label: 'Applied', color: '#000' }, { label: 'Rejected', color: '#fff' }]}
    />)
    let legend = screen.getByRole('group', { name: 'Chart legend' })
    expect(within(legend).getByRole('button', { name: /Applied.*2/ })).toBeInTheDocument()
    const rejected = within(legend).getByRole('button', { name: /Rejected.*1/ })
    fireEvent.click(rejected)
    expect(rejected).toHaveAttribute('aria-pressed', 'false')
    unmount()

    render(<ResponsiveLineChart label="Weekly applications" series={[
      { label: 'Applications', color: '#000', values: [{ label: 'Week 1', value: 3 }] },
      { label: 'Interviews', color: '#fff', values: [{ label: 'Week 1', value: 1 }] },
    ]} />)
    legend = screen.getByRole('group', { name: 'Chart legend' })
    expect(within(legend).getByRole('button', { name: 'Applications' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(legend).getByRole('button', { name: 'Interviews' })).toBeInTheDocument()
  })
})
