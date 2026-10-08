import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { SessionIdentityVerifier } from '../../App'
import { WelcomeGreeting } from './WelcomeGreeting'
import { useAuthStore } from '../../store/auth'

describe('WelcomeGreeting identity', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    useAuthStore.setState({ session: null })
  })

  it('shows the /auth/me name instead of a stale cached session name', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      role: 'STUDENT',
      userId: 26,
      email: 'bharadwaj.3695@gmail.com',
      name: 'Kamatam Meghana',
    })
    let resolveAuthMe!: (response: { data: { id: number; email: string; name: string } }) => void
    const authMeResponse = new Promise<{ data: { id: number; email: string; name: string } }>((resolve) => {
      resolveAuthMe = resolve
    })
    vi.spyOn(api, 'get').mockReturnValue(authMeResponse as never)

    render(
      <>
        <SessionIdentityVerifier />
        <WelcomeGreeting />
      </>
    )
    await act(async () => {
      resolveAuthMe({
        data: {
          id: 26,
          email: 'bharadwaj.3695@gmail.com',
          name: 'Bharadwaj',
        },
      })
      await authMeResponse
    })

    expect(screen.getByText('Bharadwaj')).toBeTruthy()
    expect(screen.queryByText('Kamatam Meghana')).toBeNull()
    expect(api.get).toHaveBeenCalledTimes(1)
  })
})
