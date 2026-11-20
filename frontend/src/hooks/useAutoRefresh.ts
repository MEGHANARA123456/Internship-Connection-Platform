import { useEffect, useRef } from 'react'

export function useAutoRefresh(
  callback: () => void | Promise<unknown>,
  intervalMs = 15_000,
  enabled = true,
): void {
  const callbackRef = useRef(callback)
  const runningRef = useRef(false)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return

    const run = async () => {
      if (document.hidden || runningRef.current) return
      runningRef.current = true
      try {
        await callbackRef.current()
      } catch {
        // Background refresh failures leave the currently displayed data intact.
      } finally {
        runningRef.current = false
      }
    }
    const handleVisibilityChange = () => {
      if (!document.hidden) void run()
    }
    const intervalId = window.setInterval(() => void run(), intervalMs)

    window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', run)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [enabled, intervalMs])
}
