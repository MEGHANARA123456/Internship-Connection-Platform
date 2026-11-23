import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Textarea'
import { transcribeInterviewAudio } from '../../services/interviewService'

type RecorderStatus = 'idle' | 'ready' | 'recording' | 'paused' | 'processing' | 'review'

interface VoiceRoomProps {
  sessionId: number
  questionId: number
  questionText: string
  answer: string
  disabled: boolean
  allowAudioTranscription?: boolean
  sharedStream?: MediaStream | null
  onAnswerChange: (value: string) => void
  onDurationTokenChange: (value: string | null) => void
  onBusyChange: (busy: boolean) => void
}

const ANSWER_LIMIT = 5000

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number
  results: {
    length: number
    [index: number]: {
      isFinal: boolean
      [index: number]: { transcript: string }
    }
  }
}

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: Event & { error?: string }) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

function speechSynthesisAvailable(): boolean {
  return typeof window !== 'undefined'
    && typeof window.speechSynthesis?.speak === 'function'
    && typeof SpeechSynthesisUtterance !== 'undefined'
}

function transcribeErrorMessage(error: unknown): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string') {
    const messages: Record<string, string> = {
      stt_not_configured: 'Speech transcription is not configured. You can type your answer instead.',
      stt_timeout: 'Transcription timed out. Retry the clip or type your answer.',
      stt_rate_limited: 'The transcription service is busy. Retry shortly or type your answer.',
      stt_unavailable: 'The transcription service is unavailable. Retry the clip or type your answer.',
      stt_rejected_request: 'The transcription service rejected this clip. Retry or type your answer.',
      stt_invalid_response: 'The transcription service returned an invalid response. Retry or type your answer.',
      stt_empty_transcript: 'No speech was recognized. Re-record or type your answer.',
      audio_too_large: 'This clip exceeds the upload size limit. Re-record a shorter answer.',
      audio_too_long: 'This clip exceeds the allowed duration. Re-record a shorter answer.',
      audio_too_short: 'This clip is too short to transcribe. Re-record or type your answer.',
      audio_empty: 'The recording was empty. Re-record or type your answer.',
      invalid_audio: 'This recording could not be decoded. Re-record or type your answer.',
      audio_duration_unavailable: 'The recording duration could not be verified. Re-record or type your answer.',
      unsupported_audio_type: 'This audio format is not supported. Re-record or type your answer.',
    }
    return messages[detail] ?? 'Transcription failed. Retry the clip or type your answer.'
  }
  if (error instanceof Error && error.message) return error.message
  return 'Transcription failed. Retry the clip or type your answer.'
}

function microphoneErrorMessage(error: unknown): string {
  const name = (error as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Microphone access was denied. Allow microphone access in your browser settings, or type your answer.'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone was found. Connect a microphone, or type your answer.'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The microphone is unavailable or in use by another app. Close the other app, or type your answer.'
  }
  return 'Microphone access failed. Check your browser settings, or type your answer.'
}

function isSecureForMicrophone(): boolean {
  const hostname = window.location.hostname
  return window.isSecureContext || hostname === 'localhost' || hostname === '127.0.0.1'
}

export function VoiceRoom({
  sessionId,
  questionId,
  questionText,
  answer,
  disabled,
  allowAudioTranscription = true,
  sharedStream,
  onAnswerChange,
  onDurationTokenChange,
  onBusyChange,
}: VoiceRoomProps) {
  const [recorderStatus, setRecorderStatus] = useState<RecorderStatus>('idle')
  const [error, setError] = useState('')
  const [microphoneNotice, setMicrophoneNotice] = useState('')
  const [speechNotice, setSpeechNotice] = useState('')
  const [meterLevel, setMeterLevel] = useState(0)
  const [clipDuration, setClipDuration] = useState<number | null>(null)
  const [muted, setMuted] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [listeningForAnswer, setListeningForAnswer] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const recognitionBaseRef = useRef('')
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const animationRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const blobRef = useRef<Blob | null>(null)

  const startMeter = useCallback((stream: MediaStream) => {
    if (typeof AudioContext === 'undefined') return
    try {
      const context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      context.createMediaStreamSource(stream).connect(analyser)
      const samples = new Uint8Array(analyser.fftSize)
      audioContextRef.current = context
      const draw = () => {
        analyser.getByteTimeDomainData(samples)
        const sum = samples.reduce((total, sample) => {
          const value = (sample - 128) / 128
          return total + value * value
        }, 0)
        setMeterLevel(Math.min(100, Math.round(Math.sqrt(sum / samples.length) * 240)))
        animationRef.current = window.requestAnimationFrame(draw)
      }
      draw()
    } catch {
      setMicrophoneNotice('Microphone access is ready, but a live level meter is unavailable in this browser.')
    }
  }, [])

  const requestMicrophone = useCallback(async (): Promise<MediaStream | null> => {
    setError('')
    if (sharedStream) {
      if (sharedStream.getAudioTracks().length === 0) {
        setError('No microphone track is available. Enable the microphone or type your answer.')
        return null
      }
      if (streamRef.current === sharedStream) return sharedStream
      streamRef.current = sharedStream
      setRecorderStatus('ready')
      setMicrophoneNotice('Shared microphone ready. Speak to check the level meter.')
      startMeter(sharedStream)
      return sharedStream
    }
    if (streamRef.current) return streamRef.current
    if (!isSecureForMicrophone()) {
      setError('Microphone access requires HTTPS or localhost. You can still type your answer.')
      return null
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone capture is not supported in this browser. You can still type your answer.')
      return null
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      setRecorderStatus('ready')
      setMicrophoneNotice('Microphone ready. Speak to check the level meter.')
      startMeter(stream)
      return stream
    } catch (requestError) {
      setError(microphoneErrorMessage(requestError))
      return null
    }
  }, [sharedStream, startMeter])

  const transcribe = useCallback(async (blob: Blob) => {
    setRecorderStatus('processing')
    onBusyChange(true)
    setError('')
    try {
      const result = await transcribeInterviewAudio(sessionId, questionId, blob)
      onAnswerChange(result.transcript)
      onDurationTokenChange(result.duration_token)
      setClipDuration(result.duration_seconds)
      setRecorderStatus('review')
    } catch (transcriptionError) {
      setError(transcribeErrorMessage(transcriptionError))
      setRecorderStatus('ready')
    } finally {
      onBusyChange(false)
    }
  }, [onAnswerChange, onBusyChange, onDurationTokenChange, questionId, sessionId])

  const stopTracks = useCallback(() => {
    if (streamRef.current && streamRef.current !== sharedStream) {
      streamRef.current.getTracks().forEach((track) => track.stop())
    }
    streamRef.current = null
    if (animationRef.current !== null) {
      window.cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
    void audioContextRef.current?.close()
    audioContextRef.current = null
    setMeterLevel(0)
  }, [sharedStream])

  useEffect(() => {
    if (!sharedStream) return
    streamRef.current = sharedStream
    setRecorderStatus('ready')
    setMicrophoneNotice('Shared microphone ready. Speak to check the level meter.')
    startMeter(sharedStream)
    return () => {
      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
      void audioContextRef.current?.close()
      audioContextRef.current = null
    }
  }, [sharedStream, startMeter])

  useEffect(() => () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.onstop = null
      recorderRef.current.stop()
    }
    recognitionRef.current?.abort()
    recognitionRef.current = null
    stopTracks()
    if (typeof window.speechSynthesis?.cancel === 'function') window.speechSynthesis.cancel()
  }, [stopTracks])

  const startRecording = async () => {
    const stream = streamRef.current ?? await requestMicrophone()
    if (!stream) return
    if (typeof MediaRecorder === 'undefined') {
      setError('Audio recording is not supported in this browser. You can still type your answer.')
      return
    }
    const supportedTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ]
    const mimeType = supportedTypes.find((type) => MediaRecorder.isTypeSupported?.(type))
    try {
      const audioStream = sharedStream
        ? new MediaStream(stream.getAudioTracks())
        : stream
      if (sharedStream && audioStream.getAudioTracks().length === 0) {
        setError('No microphone track is available. Enable the microphone or type your answer.')
        return
      }
      const recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      blobRef.current = null
      onDurationTokenChange(null)
      setClipDuration(null)
      setError('')
      setMicrophoneNotice('')
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onpause = () => setRecorderStatus('paused')
      recorder.onresume = () => setRecorderStatus('recording')
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' })
        chunksRef.current = []
        if (!blob.size) {
          setError('The recording was empty. Check your microphone and try again, or type your answer.')
          setRecorderStatus('ready')
          onBusyChange(false)
          return
        }
        blobRef.current = blob
        void transcribe(blob)
      }
      recorder.onerror = () => {
        setError('Recording failed. Check microphone access, retry, or type your answer.')
        setRecorderStatus('ready')
        onBusyChange(false)
      }
      recorderRef.current = recorder
      recorder.start()
      onBusyChange(true)
      setRecorderStatus('recording')
    } catch {
      setError('Could not start recording. Check microphone access, or type your answer.')
      onBusyChange(false)
    }
  }

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording' || recorderRef.current?.state === 'paused') {
      recorderRef.current.stop()
    }
  }

  const speakQuestion = useCallback(() => {
    if (!speechSynthesisAvailable()) {
      setSpeechNotice('Question audio is not supported here. Read the question text above.')
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(questionText)
    utterance.onstart = () => {
      setSpeaking(true)
      setSpeechNotice('')
    }
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => {
      setSpeaking(false)
      setSpeechNotice('Question audio could not play. Read the question text above.')
    }
    try {
      window.speechSynthesis.speak(utterance)
    } catch {
      setSpeechNotice('Question audio could not play. Read the question text above.')
      setSpeaking(false)
    }
  }, [questionText])

  useEffect(() => {
    if (!muted) speakQuestion()
    else if (typeof window.speechSynthesis?.cancel === 'function') window.speechSynthesis.cancel()
    return () => {
      if (typeof window.speechSynthesis?.cancel === 'function') window.speechSynthesis.cancel()
    }
  }, [muted, questionId, speakQuestion])

  const startSpeakingAnswer = () => {
    if (disabled || listeningForAnswer) return
    const Recognition = getSpeechRecognition()
    if (!Recognition) {
      setSpeechNotice('Speech recognition is not supported in this browser. Type your answer in the transcript box instead.')
      return
    }
    try {
      const recognition = new Recognition()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'en-US'
      recognitionBaseRef.current = answer
      recognition.onresult = (event) => {
        let transcript = ''
        for (let index = 0; index < event.results.length; index += 1) {
          transcript += event.results[index][0]?.transcript ?? ''
        }
        if (transcript.trim()) {
          const base = recognitionBaseRef.current.trim()
          onAnswerChange(base ? `${base} ${transcript.trim()}` : transcript.trim())
        }
      }
      recognition.onerror = (event) => {
        setListeningForAnswer(false)
        setError(event.error === 'not-allowed'
          ? 'Microphone permission was denied. Allow microphone access or type your answer.'
          : 'Speech recognition failed. Review or type your answer.')
      }
      recognition.onend = () => setListeningForAnswer(false)
      recognitionRef.current = recognition
      setError('')
      setListeningForAnswer(true)
      recognition.start()
    } catch {
      setListeningForAnswer(false)
      setError('Speech recognition could not start. Type your answer instead.')
    }
  }

  const stopSpeakingAnswer = () => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setListeningForAnswer(false)
  }

  const rerecord = () => {
    if (answer.trim() && !window.confirm('Replace the current transcript or answer with a new recording?')) return
    blobRef.current = null
    onAnswerChange('')
    onDurationTokenChange(null)
    setClipDuration(null)
    setError('')
    setRecorderStatus(streamRef.current ? 'ready' : 'idle')
  }

  const useTextOnly = () => {
    onDurationTokenChange(null)
    blobRef.current = null
    setClipDuration(null)
    if (recorderStatus === 'review') setRecorderStatus('ready')
  }

  const releaseMicrophone = () => {
    stopTracks()
    setRecorderStatus('idle')
    setMicrophoneNotice('Microphone released.')
  }

  const liveStatus = recorderStatus === 'processing'
    ? 'Processing audio'
    : listeningForAnswer
      ? 'Listening for answer'
      : speaking
      ? 'Speaking'
      : recorderStatus === 'recording'
        ? 'Listening'
        : recorderStatus === 'paused'
          ? 'Recording paused'
          : recorderStatus === 'review'
            ? 'Transcript ready for review'
            : microphoneNotice || 'Text entry is always available'

  const speechRecognitionSupported = Boolean(getSpeechRecognition())

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" aria-label="Voice interview controls">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" aria-live="polite" className="text-sm font-medium text-slate-700 dark:text-slate-200">{liveStatus}</p>
        <div className="flex flex-wrap gap-2">
          {listeningForAnswer ? (
            <Button type="button" variant="outline" size="sm" onClick={stopSpeakingAnswer}>
              <MicOff className="mr-2 h-4 w-4" aria-hidden="true" /> Stop speaking
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled={disabled || recorderStatus === 'processing'} onClick={startSpeakingAnswer}>
              <Mic className="mr-2 h-4 w-4" aria-hidden="true" /> Speak answer
            </Button>
          )}
          {allowAudioTranscription && (
            <>
              <Button type="button" variant="outline" size="sm" disabled={disabled || recorderStatus === 'processing'} onClick={() => void requestMicrophone()}>
                <Mic className="mr-2 h-4 w-4" aria-hidden="true" /> Test microphone
              </Button>
              {streamRef.current && !sharedStream && (
                <Button type="button" variant="outline" size="sm" disabled={recorderStatus === 'recording' || recorderStatus === 'paused' || recorderStatus === 'processing'} onClick={releaseMicrophone}>
                  <MicOff className="mr-2 h-4 w-4" aria-hidden="true" /> Release microphone
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" disabled={disabled || recorderStatus === 'recording' || recorderStatus === 'paused' || recorderStatus === 'processing'} onClick={() => void startRecording()}>
                <Mic className="mr-2 h-4 w-4" aria-hidden="true" /> Record answer
              </Button>
            </>
          )}
          {allowAudioTranscription && recorderStatus === 'recording' && (
            <Button type="button" variant="outline" size="sm" onClick={() => recorderRef.current?.pause()}>
              <Pause className="mr-2 h-4 w-4" aria-hidden="true" /> Pause
            </Button>
          )}
          {allowAudioTranscription && recorderStatus === 'paused' && (
            <Button type="button" variant="outline" size="sm" onClick={() => recorderRef.current?.resume()}>
              <Play className="mr-2 h-4 w-4" aria-hidden="true" /> Resume
            </Button>
          )}
          {allowAudioTranscription && (recorderStatus === 'recording' || recorderStatus === 'paused') && (
            <Button type="button" variant="outline" size="sm" onClick={stopRecording}>Stop and transcribe</Button>
          )}
          {allowAudioTranscription && blobRef.current && recorderStatus !== 'processing' && (
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void transcribe(blobRef.current as Blob)}>
              Retry transcription
            </Button>
          )}
          {allowAudioTranscription && (recorderStatus === 'review' || blobRef.current) && (
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={rerecord}>
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" /> Re-record
            </Button>
          )}
        </div>
      </div>

      <div aria-label="Microphone input level" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={meterLevel} className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${meterLevel}%` }} />
      </div>
      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      {speechNotice && <p role="status" className="text-sm text-amber-800 dark:text-amber-200">{speechNotice}</p>}
      {!speechRecognitionSupported && <p role="status" className="text-sm text-amber-800 dark:text-amber-200">Speech recognition is not supported in this browser. Type your answer in the transcript box; no audio will be uploaded.</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={speaking || recorderStatus === 'recording' || recorderStatus === 'paused' || !speechSynthesisAvailable()} onClick={speakQuestion}>
          <Volume2 className="mr-2 h-4 w-4" aria-hidden="true" /> Replay question
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!speechSynthesisAvailable()} onClick={() => setMuted((current) => !current)}>
          {muted ? <Volume2 className="mr-2 h-4 w-4" aria-hidden="true" /> : <VolumeX className="mr-2 h-4 w-4" aria-hidden="true" />}
          {muted ? 'Enable question audio' : 'Mute question audio'}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!clipDuration} onClick={useTextOnly}>
          Use text only
        </Button>
      </div>
      {clipDuration !== null && (
        <p className="text-xs text-slate-500 dark:text-slate-400">Verified recording duration: {clipDuration.toFixed(1)} seconds. The session timer continues while recording is paused.</p>
      )}
      <Textarea
        label="Transcript / your answer"
        value={answer}
        onChange={(event) => onAnswerChange(event.target.value)}
        maxLength={ANSWER_LIMIT}
        rows={7}
        disabled={disabled}
        placeholder="Your recognized transcript appears here. Review or edit it, or type an answer."
        aria-describedby="voice-answer-count"
      />
      <p id="voice-answer-count" className={`text-right text-xs ${answer.length > ANSWER_LIMIT ? 'text-rose-700' : 'text-slate-500 dark:text-slate-400'}`}>
        {answer.length.toLocaleString()} / {ANSWER_LIMIT.toLocaleString()} characters
      </p>
    </section>
  )
}
