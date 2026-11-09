import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { GuestInsights } from './GuestInsights'

vi.mock('../../api/client', () => ({
  api: { get: vi.fn() },
}))

const summary = {
  live_internships: 12,
  verified_companies: 8,
  registered_students: 240,
  offers_made: 15,
  openings_by_field: [{ name: 'Software Development', count: 7 }],
  openings_by_work_mode: [{ name: 'Remote', count: 5 }],
  updated_at: '2026-11-04T10:00:00Z',
}

function renderInsights() {
  return render(<MemoryRouter><GuestInsights /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GuestInsights', () => {
  it('renders the API-provided statistics and bar-list counts', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: summary } as never)
    renderInsights()

    expect(await screen.findByText('12')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('240')).toBeInTheDocument()
    expect(screen.getByText('15')).toBeInTheDocument()
    expect(screen.getByText('Software Development')).toBeInTheDocument()
    expect(screen.getByText('Remote')).toBeInTheDocument()
    expect(screen.getByText(/Updated/)).toBeInTheDocument()
  })

  it('shows an error and retries the request', async () => {
    vi.mocked(api.get)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: summary } as never)
    renderInsights()

    expect(await screen.findByRole('alert')).toHaveTextContent('Platform insights could not be loaded.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Software Development')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('treats a malformed response as a retryable load error', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { ...summary, live_internships: '12' },
    } as never)
    renderInsights()

    expect(await screen.findByRole('alert')).toHaveTextContent('Platform insights could not be loaded.')
    expect(screen.queryByText('12')).not.toBeInTheDocument()
  })

  it('shows the honest empty state and company registration link', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        ...summary,
        live_internships: 0,
        openings_by_field: [],
        openings_by_work_mode: [],
      },
    } as never)
    renderInsights()

    expect(await screen.findByText('No internships are open right now')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Register your company' })).toHaveAttribute('href', '/register-company')
    expect(screen.getAllByText('No open roles to show.')).toHaveLength(2)
  })
})
