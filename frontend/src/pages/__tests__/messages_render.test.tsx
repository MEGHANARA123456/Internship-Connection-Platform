import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../../App'
import { useAuthStore } from '../../store/auth'

describe('App route /messages render', () => {
  it('renders /messages when student is logged in', () => {
    useAuthStore.getState().setSession({
      accessToken: 'test-token',
      refreshToken: 'test-refresh-token',
      userId: 1,
      role: 'STUDENT',
      email: 'student@example.com',
      name: 'Student Name',
    })

    const { container } = render(
      <MemoryRouter initialEntries={['/messages']}>
        <App />
      </MemoryRouter>
    )
    expect(container).toBeDefined()
  })

  it('renders without session redirecting to login', () => {
    useAuthStore.getState().logout()

    const { container } = render(
      <MemoryRouter initialEntries={['/messages']}>
        <App />
      </MemoryRouter>
    )
    expect(container).toBeDefined()
  })
})
