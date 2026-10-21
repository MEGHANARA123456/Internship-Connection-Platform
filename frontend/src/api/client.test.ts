import { AxiosError, type AxiosAdapter, type AxiosResponse } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './client'

const originalAdapter = api.defaults.adapter

afterEach(() => {
  api.defaults.adapter = originalAdapter
  vi.useRealTimers()
})

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
})
