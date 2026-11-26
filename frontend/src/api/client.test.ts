import axios, { AxiosError, type AxiosAdapter, type AxiosResponse } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './client'
import { useAuthStore } from '../store/auth'

const originalAdapter = api.defaults.adapter

afterEach(() => {
  api.defaults.adapter = originalAdapter
  vi.useRealTimers()
  vi.restoreAllMocks()
  useAuthStore.getState().logout(false, false)
})

function unauthorized(config: Parameters<AxiosAdapter>[0]): AxiosError {
  const response = {
    config,
    data: { detail: 'Not authenticated' },
    headers: {},
    status: 401,
    statusText: 'Unauthorized',
  } as AxiosResponse
  return new AxiosError('Unauthorized', AxiosError.ERR_BAD_REQUEST, config, undefined, response)
}

describe('API rate-limit responses', () => {
  it('does not immediately repeat a write request and surfaces the wait message', async () => {
    const adapter = vi.fn<AxiosAdapter>(async (config) => {
      const response = {
        config,
        data: { detail: 'Rate limit exceeded. Please retry in 3 seconds.' },
        headers: { 'retry-after': '3' },
        status: 429,
        statusText: 'Too Many Requests',
      } as AxiosResponse
      throw new AxiosError(
        'Request failed with status code 429',
        AxiosError.ERR_BAD_REQUEST,
        config,
        undefined,
        response,
      )
    })
    api.defaults.adapter = adapter

    await expect(api.post('/auth/login', { email: 'user@example.com' }))
      .rejects.toMatchObject({
        message: 'Rate limit exceeded. Please retry in 3 seconds.',
        response: { status: 429 },
      })

    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it('retries a read request once after the Retry-After delay', async () => {
    vi.useFakeTimers()
    const adapter = vi.fn<AxiosAdapter>(async (config) => {
      if (adapter.mock.calls.length === 1) {
        const response = {
          config,
          data: { detail: 'Rate limit exceeded.' },
          headers: { 'retry-after': '2' },
          status: 429,
          statusText: 'Too Many Requests',
        } as AxiosResponse
        throw new AxiosError('Request failed with status code 429', AxiosError.ERR_BAD_REQUEST, config, undefined, response)
      }
      return {
        config,
        data: { status: 'ok' },
        headers: {},
        status: 200,
        statusText: 'OK',
      } as AxiosResponse
    })
    api.defaults.adapter = adapter

    const rateLimitNotice = new Promise<void>((resolve) => {
      window.addEventListener('app:rate-limit', () => resolve(), { once: true })
    })
    const request = api.get('/browse')
    await rateLimitNotice

    expect(adapter).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(2000)
    await expect(request).resolves.toMatchObject({ data: { status: 'ok' } })
    expect(adapter).toHaveBeenCalledTimes(2)
  })

  it('does not refresh or clear the session when /auth/me is rate-limited', async () => {
    vi.useFakeTimers()
    useAuthStore.getState().setSession({
      accessToken: 'valid-access-token',
      refreshToken: 'valid-refresh-token',
      role: 'ADMIN',
      userId: 101,
      email: 'admin@example.com',
    })
    const adapter = vi.fn<AxiosAdapter>(async (config) => {
      const response = {
        config,
        data: { detail: 'Rate limit exceeded.' },
        headers: { 'retry-after': '1' },
        status: 429,
        statusText: 'Too Many Requests',
      } as AxiosResponse
      throw new AxiosError('Request failed with status code 429', AxiosError.ERR_BAD_REQUEST, config, undefined, response)
    })
    const refresh = vi.spyOn(axios, 'post')
    api.defaults.adapter = adapter
    const rateLimitNotice = new Promise<void>((resolve) => {
      window.addEventListener('app:rate-limit', () => resolve(), { once: true })
    })
    const request = api.get('/auth/me')
    const requestFailure = expect(request).rejects.toMatchObject({ response: { status: 429 } })

    await rateLimitNotice
    await vi.advanceTimersByTimeAsync(1000)
    await requestFailure

    expect(adapter).toHaveBeenCalledTimes(2)
    expect(refresh).not.toHaveBeenCalled()
    expect(useAuthStore.getState().session?.accessToken).toBe('valid-access-token')
    expect(sessionStorage.getItem('session_expired_message')).toBeNull()
  })
})

describe('access-token refresh', () => {
  it('keeps the session when a protected request has a network failure', async () => {
    vi.useFakeTimers()
    useAuthStore.getState().setSession({
      accessToken: 'valid-access-token',
      refreshToken: 'valid-refresh-token',
      role: 'STUDENT',
      userId: 98,
    })
    const adapter = vi.fn<AxiosAdapter>(async (config) => {
      throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config)
    })
    const refresh = vi.spyOn(axios, 'post')
    api.defaults.adapter = adapter

    const request = api.get('/protected')
    const requestFailure = expect(request).rejects.toMatchObject({ code: AxiosError.ERR_NETWORK })
    await vi.runAllTimersAsync()
    await requestFailure

    expect(adapter).toHaveBeenCalledTimes(3)
    expect(refresh).not.toHaveBeenCalled()
    expect(useAuthStore.getState().session?.accessToken).toBe('valid-access-token')
  })

  it('keeps the session when token refresh fails because of a network error', async () => {
    vi.useFakeTimers()
    useAuthStore.getState().setSession({
      accessToken: 'expired-access-token',
      refreshToken: 'valid-refresh-token',
      role: 'STUDENT',
      userId: 97,
    })
    const adapter = vi.fn<AxiosAdapter>(async (config) => {
      throw unauthorized(config)
    })
    const refreshError = new AxiosError('Network Error', AxiosError.ERR_NETWORK)
    const refresh = vi.spyOn(axios, 'post').mockRejectedValue(refreshError)
    api.defaults.adapter = adapter

    const request = api.get('/protected')
    const requestFailure = expect(request).rejects.toBe(refreshError)
    await vi.runAllTimersAsync()
    await requestFailure

    expect(refresh).toHaveBeenCalledTimes(3)
    expect(useAuthStore.getState().session?.accessToken).toBe('expired-access-token')
    expect(sessionStorage.getItem('session_expired_message')).toBeNull()
  })

  it('shares one refresh across concurrent unauthorized requests', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'expired-access-token',
      refreshToken: 'valid-refresh-token',
      role: 'STUDENT',
      userId: 96,
    })
    let resolveRefresh: ((value: unknown) => void) | undefined
    let markRefreshStarted: (() => void) | undefined
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve
    })
    const refresh = vi.spyOn(axios, 'post').mockImplementation(() => new Promise((resolve) => {
      resolveRefresh = resolve
      markRefreshStarted?.()
    }) as never)
    const adapter = vi.fn<AxiosAdapter>(async (config) => {
      if (String(config.headers.Authorization ?? '') === 'Bearer expired-access-token') {
        throw unauthorized(config)
      }
      return {
        config,
        data: { ok: true },
        headers: {},
        status: 200,
        statusText: 'OK',
      } as AxiosResponse
    })
    api.defaults.adapter = adapter

    const first = api.get('/protected/first')
    const second = api.get('/protected/second')
    await refreshStarted
    expect(refresh).toHaveBeenCalledOnce()

    resolveRefresh?.({
      data: {
        access_token: 'fresh-access-token',
        refresh_token: 'rotated-refresh-token',
        role: 'STUDENT',
        user_id: 96,
      },
    })
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('refreshes an expired access token once and transparently retries the request', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'expired-access-token',
      refreshToken: 'valid-refresh-token',
      role: 'STUDENT',
      userId: 99,
      email: 'student@example.com',
    })
    const refresh = vi.spyOn(axios, 'post').mockResolvedValue({
      data: {
        access_token: 'fresh-access-token',
        refresh_token: 'rotated-refresh-token',
        role: 'STUDENT',
        user_id: 99,
      },
    } as never)
    const adapter = vi.fn<AxiosAdapter>(async (config) => {
      if (String(config.headers.Authorization ?? '') === 'Bearer expired-access-token') {
        throw unauthorized(config)
      }
      return {
        config,
        data: { ok: true },
        headers: {},
        status: 200,
        statusText: 'OK',
      } as AxiosResponse
    })
    api.defaults.adapter = adapter

    await expect(api.get('/protected')).resolves.toMatchObject({ data: { ok: true } })

    expect(refresh).toHaveBeenCalledOnce()
    expect(adapter).toHaveBeenCalledTimes(2)
    expect(adapter.mock.calls[1][0].headers.Authorization).toBe('Bearer fresh-access-token')
    expect(useAuthStore.getState().session?.accessToken).toBe('fresh-access-token')
    expect(useAuthStore.getState().session?.refreshToken).toBe('rotated-refresh-token')
    expect(useAuthStore.getState().session).not.toBeNull()
  })

  it('clears auth state when the refresh token is expired', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'expired-access-token',
      refreshToken: 'expired-refresh-token',
      role: 'STUDENT',
      userId: 100,
      email: 'student@example.com',
    })
    const adapter = vi.fn<AxiosAdapter>(async (config) => {
      throw unauthorized(config)
    })
    api.defaults.adapter = adapter
    const refreshResponse = {
      config: {} as never,
      data: { detail: 'Invalid refresh token' },
      headers: {},
      status: 401,
      statusText: 'Unauthorized',
    } as AxiosResponse
    vi.spyOn(axios, 'post').mockRejectedValue(
      new AxiosError('Unauthorized', AxiosError.ERR_BAD_REQUEST, undefined, undefined, refreshResponse),
    )

    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } })

    expect(adapter).toHaveBeenCalledOnce()
    expect(useAuthStore.getState().session).toBeNull()
    expect(sessionStorage.getItem('session_expired_message')).toBe('true')
  })
})
