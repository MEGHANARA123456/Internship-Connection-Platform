import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VoiceRoom } from './VoiceRoom'
import { submitInterviewAnswer, transcribeInterviewAudio } from '../../services/interviewService'

vi.mock('../../services/interviewService', () => ({
  submitInterviewAnswer: vi.fn(),
  transcribeInterviewAudio: vi.fn(),
}))

const stream = {
  getTracks: () => [{ stop: vi.fn() }],
} as unknown as MediaStream

function installMediaDevices(getUserMedia = vi.fn().mockResolvedValue(stream)) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })
  return getUserMedia
}

function VoiceHarness() {
  const [answer, setAnswer] = useState('')
  const [durationToken, setDurationToken] = useState<string | null>(null)
  return (
    <>
      <VoiceRoom
        sessionId={17}
        questionId={22}
        questionText="Describe a project you worked on."
        answer={answer}
        disabled={false}
        onAnswerChange={setAnswer}
        onDurationTokenChange={setDurationToken}
        onBusyChange={() => undefined}
      />
      <button onClick={() => void submitInterviewAnswer(17, 22, answer, durationToken)}>
        Submit confirmed answer
      </button>
    </>
  )
}

class MockMediaRecorder {
  static isTypeSupported = vi.fn(() => true)
  state = 'inactive'
  mimeType: string
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onpause: (() => void) | null = null
  onresume: (() => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? 'audio/webm'
  }

  start() {
    this.state = 'recording'
  }

  pause() {
    this.state = 'paused'
    this.onpause?.()
  }

  resume() {
    this.state = 'recording'
    this.onresume?.()
  }

  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['mock audio'], { type: this.mimeType }) })
    this.onstop?.()
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('VoiceRoom', () => {
  it('explains microphone permission denial and keeps text entry available', async () => {
    installMediaDevices(vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' })))
    render(<VoiceRoom
      sessionId={17}
      questionId={22}
      questionText="Describe a project."
      answer=""
      disabled={false}
      onAnswerChange={() => undefined}
      onDurationTokenChange={() => undefined}
      onBusyChange={() => undefined}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Test microphone/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Microphone access was denied/)
    expect(screen.getByLabelText('Transcript / your answer')).toBeInTheDocument()
  })

  it('shows typed fallback when MediaRecorder and speech synthesis are unsupported', async () => {
    installMediaDevices()
    vi.stubGlobal('MediaRecorder', undefined)
    vi.stubGlobal('SpeechSynthesisUtterance', undefined)
    render(<VoiceRoom
      sessionId={17}
      questionId={22}
      questionText="Describe a project."
      answer=""
      disabled={false}
      onAnswerChange={() => undefined}
      onDurationTokenChange={() => undefined}
      onBusyChange={() => undefined}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Record answer/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Audio recording is not supported/)
    fireEvent.click(screen.getByRole('button', { name: /Replay question/ }))
    expect(await screen.findByText(/Question audio is not supported/)).toBeInTheDocument()
    expect(screen.getByLabelText('Transcript / your answer')).toBeInTheDocument()
  })

  it('lets the student edit the transcript before submitting it with verified duration', async () => {
    installMediaDevices()
    vi.stubGlobal('MediaRecorder', MockMediaRecorder)
    vi.mocked(transcribeInterviewAudio).mockResolvedValue({
      transcript: 'Recognized words.',
      duration_seconds: 4.5,
      duration_token: 'signed-duration',
    })
    vi.mocked(submitInterviewAnswer).mockResolvedValue({
      answer_id: 93,
      evaluation_status: 'COMPLETED',
      failure_code: null,
      evaluation: null,
    })
    render(<VoiceHarness />)

    fireEvent.click(screen.getByRole('button', { name: /Record answer/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Stop and transcribe/ })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /Stop and transcribe/ }))
    await screen.findByText(/Transcript ready for review/)
    expect(screen.getByLabelText('Transcript / your answer')).toHaveValue('Recognized words.')

    fireEvent.change(screen.getByLabelText('Transcript / your answer'), {
      target: { value: 'Edited answer with um one useful detail.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit confirmed answer' }))
    await waitFor(() => expect(submitInterviewAnswer).toHaveBeenCalledWith(
      17,
      22,
      'Edited answer with um one useful detail.',
      'signed-duration',
    ))
  })
})
