import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProctorGuard } from '../components/interviews/ProctorGuard'
import { recordInterviewProctoringEvent } from '../services/interviewService'
import { useProctoring } from './useProctoring'

vi.mock('../services/interviewService', () => ({
  recordInterviewProctoringEvent: vi.fn(),
}))
vi.mock('../lib/feedback', () => ({
  confirmAction: vi.fn().mockResolvedValue(false),
  showToast: vi.fn(),
}))

const recordEvent = vi.mocked(recordInterviewProctoringEvent)

const options = {
  enabled: true,
  sessionId: 17,
  questionIndex: 2,
  maxViolations: 3,
}

describe('useProctoring', () => {
  let originalHidden: PropertyDescriptor | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden')
    recordEvent.mockResolvedValue({
      violation_count: 1,
      max_violations: 3,
      terminated: false,
    })
  })

  afterEach(() => {
    cleanup()
    if (originalHidden) Object.defineProperty(document, 'hidden', originalHidden)
    else Reflect.deleteProperty(document, 'hidden')
  })

  it('records a tab visibility violation and updates the warning count', async () => {
    const { result } = renderHook(() => useProctoring(options))
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })

    act(() => document.dispatchEvent(new Event('visibilitychange')))

    await waitFor(() => expect(result.current.warningCount).toBe(1))
    expect(recordEvent).toHaveBeenCalledWith(17, expect.objectContaining({
      event_type: 'TAB_HIDDEN',
      question_index: 2,
    }))
    expect(result.current.warningOpen).toBe(true)
  })

  it('calls the termination handler when the configured threshold is reached', async () => {
    const onTerminated = vi.fn()
    recordEvent.mockResolvedValue({
      violation_count: 3,
      max_violations: 3,
      terminated: true,
    })
    renderHook(() => useProctoring({ ...options, onTerminated }))

    act(() => window.dispatchEvent(new Event('blur')))
    act(() => window.dispatchEvent(new Event('focus')))

    await waitFor(() => expect(onTerminated).toHaveBeenCalledOnce())
  })

  it('blocks clipboard paste in the interview area', async () => {
    recordEvent.mockResolvedValue({
      violation_count: 1,
      max_violations: 3,
      terminated: false,
    })
    render(
      <MemoryRouter>
        <ProctorGuard
          active
          sessionId={17}
          questionIndex={2}
          maxViolations={3}
          onTerminated={() => undefined}
        >
          <textarea aria-label="Your answer" />
        </ProctorGuard>
      </MemoryRouter>,
    )
    const paste = new Event('paste', { bubbles: true, cancelable: true })

    let pasteAllowed = true
    act(() => {
      pasteAllowed = screen.getByLabelText('Your answer').dispatchEvent(paste)
    })
    expect(pasteAllowed).toBe(false)
    await waitFor(() => expect(recordEvent).toHaveBeenCalledWith(17, expect.objectContaining({
      event_type: 'PASTE_ATTEMPT',
    })))
  })
})
