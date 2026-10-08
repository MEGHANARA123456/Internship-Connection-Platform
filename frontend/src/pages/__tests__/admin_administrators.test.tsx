import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { AdminAdministratorsSection } from '../AdminPages'

describe('AdminAdministratorsSection', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the administrator list and create form', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: [
        {
          id: 4,
          email: 'admin@example.com',
          is_active: true,
          created_at: '2026-10-01T00:00:00Z',
        },
      ],
    } as never)

    render(<AdminAdministratorsSection />)

    expect(await screen.findByText('admin@example.com')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Administrators' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Add administrator' })).toBeTruthy()
    expect(screen.getByLabelText('Email')).toBeTruthy()
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add administrator' })).toBeTruthy()
    expect(get).toHaveBeenCalledWith('/admin/users?role=ADMIN')
  })
})
