import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acknowledgeInterviewVideoRecordingConsent,
  createInterviewVideoRecording,
  getInterviewVideoRecordingState,
  uploadInterviewVideoChunk,
} from '../../services/interviewService'
import { VideoInterviewRoom } from './VideoInterviewRoom'
import type { InterviewVideoRecordingState } from '../../types/interview'

vi.mock('../../services/interviewService', () => ({
  acknowledgeInterviewVideoRecordingConsent: vi.fn(),
  createInterviewVideoRecording: vi.fn(),
  deleteInterviewVideoRecording: vi.fn(),
  finalizeInterviewVideoRecording: vi.fn(),
  getInterviewVideoRecording: vi.fn(),
  getInterviewVideoRecordingState: vi.fn(),
  uploadInterviewVideoChunk: vi.fn(),
}))

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = []
  static isTypeSupported = vi.fn(() => true)
  state = 'inactive'
  mimeType: string
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onerror: (() => void) | null = null
  onstop: (() => void) | null = null

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? 'video/webm'
    MockMediaRecorder.instances.push(this)
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['partial video'], { type: this.mimeType }) })
    this.onstop?.()
  }
}

class MockMediaStream {
  private readonly tracks: Array<{ enabled: boolean; stop: () => void }>

  constructor(tracks: Array<{ enabled: boolean; stop: () => void }>) {
    this.tracks = tracks
  }

  getTracks() { return this.tracks }
  getVideoTracks() { return this.tracks.slice(0, 1) }
  getAudioTracks() { return this.tracks.slice(1) }
}

function state(consented: boolean, uploading = false): InterviewVideoRecordingState {
  const recording = uploading ? {
    id: 45,
    status: 'UPLOADING' as const,
    finalized: false,
    source_type: 'real' as const,
    retryable: false,
    mime_type: 'video/webm',
    chunk_count: 0,
    next_chunk_index: 0,
    total_bytes: 0,
    duration_seconds: null,
    retention_expires_at: '2026-12-01T00:00:00Z',
    created_at: '2026-11-18T10:00:00Z',
    error_code: null,
  } : null
  return {
    required_consent_version: '2026-11-v1',
    video_storage_consent: true,
    retention_days: 30,
    storage_backend: 'local',
    consent: consented
      ? { acknowledged: true, consent_version: '2026-11-v1', acknowledged_at: '2026-11-18T10:00:00Z' }
      : null,
    recording,
    recordings: recording ? [recording] : [],
  }
}

function renderRoom() {
  return render(
    <VideoInterviewRoom sessionId={17} onBusyChange={() => undefined}>
      {() => <p>Voice and text answer controls</p>}
    </VideoInterviewRoom>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('isSecureContext', true)
  MockMediaRecorder.instances = []
  vi.stubGlobal('MediaRecorder', MockMediaRecorder)
  vi.stubGlobal('MediaStream', MockMediaStream)
  vi.mocked(getInterviewVideoRecordingState).mockResolvedValue(state(false))
  vi.mocked(acknowledgeInterviewVideoRecordingConsent).mockResolvedValue()
  vi.mocked(createInterviewVideoRecording).mockResolvedValue({
    id: 45,
    status: 'UPLOADING',
    finalized: false,
    source_type: 'real',
    retryable: false,
    mime_type: '',
    chunk_count: 0,
    next_chunk_index: 0,
    total_bytes: 0,
    duration_seconds: null,
    retention_expires_at: '2026-12-01T00:00:00Z',
    created_at: '2026-11-18T10:00:00Z',
    error_code: null,
  })
  vi.mocked(uploadInterviewVideoChunk).mockResolvedValue({
    recording_id: 45,
    next_chunk_index: 1,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('VideoInterviewRoom', () => {
  it('explains camera and microphone denial while keeping the answer fallback available', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(
          Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
        ),
      },
    })
    renderRoom()

    fireEvent.click(screen.getByRole('button', { name: 'Check devices' }))

    expect(await screen.findByText(/Camera access was denied/)).toBeInTheDocument()
    expect(screen.getByText(/Microphone access was denied/)).toBeInTheDocument()
    expect(screen.getByText('Voice and text answer controls')).toBeInTheDocument()
  })

  it('preserves upload retry after a recording interruption', async () => {
    let consented = false
    let hasRecording = false
    vi.mocked(getInterviewVideoRecordingState).mockImplementation(async () =>
      state(consented, hasRecording))
    vi.mocked(acknowledgeInterviewVideoRecordingConsent).mockImplementation(async () => {
      consented = true
    })
    vi.mocked(createInterviewVideoRecording).mockImplementation(async () => {
      hasRecording = true
      return {
        id: 45,
        status: 'UPLOADING',
        finalized: false,
        source_type: 'real',
        retryable: false,
        mime_type: 'video/webm',
        chunk_count: 0,
        next_chunk_index: 0,
        total_bytes: 0,
        duration_seconds: null,
        retention_expires_at: '2026-12-01T00:00:00Z',
        created_at: '2026-11-18T10:00:00Z',
        error_code: null,
      }
    })
    vi.mocked(uploadInterviewVideoChunk)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ recording_id: 45, next_chunk_index: 1 })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async (constraints: MediaStreamConstraints) => {
          const track = { enabled: true, stop: vi.fn() }
          return new MockMediaStream(
            constraints.video ? [track] : [{ enabled: true, stop: vi.fn() }, track],
          ) as unknown as MediaStream
        }),
      },
    })
    renderRoom()

    fireEvent.click(screen.getByRole('button', { name: 'Check devices' }))
    await screen.findByRole('button', { name: 'Camera off' })
    fireEvent.click(screen.getByLabelText(/I explicitly consent to recording/))
    fireEvent.click(screen.getByRole('button', { name: 'Save recording consent' }))
    await screen.findByText(/Recording consent is saved/)
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }))
    await screen.findByRole('button', { name: 'Stop recording' })

    MockMediaRecorder.instances[0].onerror?.()
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be uploaded/)
    const retry = screen.getByRole('button', { name: /Retry 1 pending chunk/ })
    fireEvent.click(retry)

    await waitFor(() => {
      expect(uploadInterviewVideoChunk).toHaveBeenCalledTimes(2)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
