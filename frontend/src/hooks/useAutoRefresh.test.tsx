import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAutoRefresh } from './useAutoRefresh'

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
})

describe('useAutoRefresh', () => {
  it('refreshes on its interval, window focus, and return to a visible tab', async () => {
    vi.useFakeTimers()
    const callback = vi.fn()
    renderHook(() => useAutoRefresh(callback, 15_000))

    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(callback).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTime(15_000))
    expect(callback).toHaveBeenCalledTimes(2)

    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
      vi.advanceTimersByTime(15_000)
    })
    expect(callback).toHaveBeenCalledTimes(2)

    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(callback).toHaveBeenCalledTimes(3)
  })

  it('uses the latest callback, skips overlapping calls, swallows errors, and cleans up', async () => {
    vi.useFakeTimers()
    let finish: (() => void) | undefined
    const first = vi.fn()
    const latest = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const { rerender, unmount } = renderHook(
      ({ callback }) => useAutoRefresh(callback, 1_000),
      { initialProps: { callback: first } },
    )
    rerender({ callback: latest })

    act(() => window.dispatchEvent(new Event('focus')))
    act(() => window.dispatchEvent(new Event('focus')))
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledTimes(1)

    await act(async () => finish?.())
    const failure = vi.fn(() => { throw new Error('background failure') })
    rerender({ callback: failure })
    act(() => window.dispatchEvent(new Event('focus')))
    expect(failure).toHaveBeenCalledOnce()

    unmount()
    act(() => {
      window.dispatchEvent(new Event('focus'))
      vi.advanceTimersByTime(1_000)
    })
    expect(failure).toHaveBeenCalledOnce()
  })
})
