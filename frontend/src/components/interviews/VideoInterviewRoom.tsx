import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Camera, CameraOff, Mic, MicOff, UserRound } from 'lucide-react'
import { Button } from '../ui/Button'
import {
  acknowledgeInterviewVideoRecordingConsent,
  createInterviewVideoRecording,
  finalizeInterviewVideoRecording,
  getInterviewVideoRecordingState,
  uploadInterviewVideoChunk,
} from '../../services/interviewService'
import type {
  InterviewVideoRecordingState,
} from '../../types/interview'
import { InterviewVideoRecordingPanel } from './InterviewVideoRecordingPanel'

interface VideoInterviewRoomProps {
  sessionId: number
  questionText: string
  children: (stream: MediaStream | null) => ReactNode
  onBusyChange: (busy: boolean) => void
}

export interface VideoInterviewRoomHandle {
  finalizeRecording: () => Promise<void>
}

interface PendingChunk {
  index: number
  blob: Blob
}

const CLIENT_CHUNK_BYTES = 4 * 1024 * 1024

function mediaErrorMessage(error: unknown, device: 'camera' | 'microphone'): string {
  const name = (error as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return `${device === 'camera' ? 'Camera' : 'Microphone'} access was denied. Allow access in browser settings or use text entry.`
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return `No ${device} was found. Connect a device or use text entry.`
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return `The ${device} is unavailable or in use by another app.`
  }
  return `${device === 'camera' ? 'Camera' : 'Microphone'} access failed. Check browser permissions or use text entry.`
}

function secureMediaAvailable(): boolean {
  return window.isSecureContext
    || window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1'
}

export const VideoInterviewRoom = forwardRef<
  VideoInterviewRoomHandle,
  VideoInterviewRoomProps
>(function VideoInterviewRoom({ sessionId, questionText, children, onBusyChange }, ref) {
  const videoElementRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const pendingChunksRef = useRef<PendingChunk[]>([])
  const uploadPromiseRef = useRef<Promise<void> | null>(null)
  const recordingIdRef = useRef<number | null>(null)
  const nextChunkIndexRef = useRef(0)
  const recordingMimeRef = useRef('video/webm')
  const [sharedStream, setSharedStream] = useState<MediaStream | null>(null)
  const [cameraError, setCameraError] = useState('')
  const [microphoneError, setMicrophoneError] = useState('')
  const [roomError, setRoomError] = useState('')
  const [networkOnline, setNetworkOnline] = useState(navigator.onLine)
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null)
  const [cameraEnabled, setCameraEnabled] = useState(true)
  const [muted, setMuted] = useState(false)
  const [captionsVisible, setCaptionsVisible] = useState(true)
  const [recordingConsentState, setRecordingConsentState] =
    useState<InterviewVideoRecordingState | null>(null)
  const [consentChecked, setConsentChecked] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [pendingChunkCount, setPendingChunkCount] = useState(0)
  const [panelRefreshKey, setPanelRefreshKey] = useState(0)

  const applyRecordingState = useCallback((state: InterviewVideoRecordingState) => {
    setRecordingConsentState(state)
    if (state.recording?.status === 'UPLOADING') {
      recordingIdRef.current = state.recording.id
      nextChunkIndexRef.current = state.recording.next_chunk_index
      recordingMimeRef.current = state.recording.mime_type || 'video/webm'
    } else {
      recordingIdRef.current = null
      nextChunkIndexRef.current = 0
    }
  }, [])

  const refreshRecordingState = useCallback(async () => {
    const state = await getInterviewVideoRecordingState(sessionId)
    applyRecordingState(state)
    setPanelRefreshKey((current) => current + 1)
    return state
  }, [applyRecordingState, sessionId])

  useEffect(() => {
    const updateNetwork = () => setNetworkOnline(navigator.onLine)
    window.addEventListener('online', updateNetwork)
    window.addEventListener('offline', updateNetwork)
    void getInterviewVideoRecordingState(sessionId)
      .then((state) => {
        applyRecordingState(state)
        setBackendConnected(true)
      })
      .catch(() => {
        setBackendConnected(false)
      })
    return () => {
      window.removeEventListener('online', updateNetwork)
      window.removeEventListener('offline', updateNetwork)
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [applyRecordingState, sessionId])

  useEffect(() => {
    if (videoElementRef.current) {
      videoElementRef.current.srcObject = sharedStream
    }
  }, [sharedStream])

  const checkDevices = async () => {
    setRoomError('')
    setCameraError('')
    setMicrophoneError('')
    if (!secureMediaAvailable()) {
      setCameraError('Camera and microphone access requires HTTPS or localhost.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera capture is not supported in this browser.')
      setMicrophoneError('Microphone capture is not supported in this browser.')
      return
    }

    streamRef.current?.getTracks().forEach((track) => track.stop())
    let cameraStream: MediaStream | null = null
    let microphoneStream: MediaStream | null = null
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      setCameraEnabled(true)
    } catch (error) {
      setCameraError(mediaErrorMessage(error, 'camera'))
    }
    try {
      microphoneStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true })
      setMuted(false)
    } catch (error) {
      setMicrophoneError(mediaErrorMessage(error, 'microphone'))
    }
    const tracks = [
      ...(cameraStream?.getVideoTracks() ?? []),
      ...(microphoneStream?.getAudioTracks() ?? []),
    ]
    const combined = tracks.length ? new MediaStream(tracks) : null
    streamRef.current = combined
    setSharedStream(combined)
    if (!combined) setRoomError('No camera or microphone stream is available. You can continue with text answers.')
    setBackendConnected(null)
    try {
      await getInterviewVideoRecordingState(sessionId)
      setBackendConnected(true)
    } catch {
      setBackendConnected(false)
    }
  }

  const toggleCamera = () => {
    const tracks = sharedStream?.getVideoTracks() ?? []
    if (!tracks.length) {
      setCameraError('No camera is available. Connect a camera or continue without video.')
      return
    }
    const nextEnabled = !cameraEnabled
    tracks.forEach((track) => { track.enabled = nextEnabled })
    setCameraEnabled(nextEnabled)
  }

  const toggleMicrophone = () => {
    const tracks = sharedStream?.getAudioTracks() ?? []
    if (!tracks.length) {
      setMicrophoneError('No microphone is available. Connect a microphone or type your answer.')
      return
    }
    const nextMuted = !muted
    tracks.forEach((track) => { track.enabled = !nextMuted })
    setMuted(nextMuted)
  }

  const flushPendingChunks = useCallback(async () => {
    if (uploadPromiseRef.current) return uploadPromiseRef.current
    const recordingId = recordingIdRef.current
    if (recordingId === null || pendingChunksRef.current.length === 0) return

    const uploadTask = (async () => {
      onBusyChange(true)
      setUploading(true)
      try {
        while (pendingChunksRef.current.length > 0) {
          const pending = pendingChunksRef.current[0]
          const result = await uploadInterviewVideoChunk(
            sessionId,
            recordingId,
            pending.index,
            pending.blob,
          )
          pendingChunksRef.current.shift()
          nextChunkIndexRef.current = result.next_chunk_index
          setPendingChunkCount(pendingChunksRef.current.length)
          setRoomError('')
        }
        setPanelRefreshKey((current) => current + 1)
      } catch {
        setRoomError('A video chunk could not be uploaded. It remains available for retry; previously uploaded chunks are saved.')
        throw new Error('video_chunk_upload_failed')
      } finally {
        setUploading(false)
        onBusyChange(false)
      }
    })()
    uploadPromiseRef.current = uploadTask
    try {
      await uploadTask
    } finally {
      uploadPromiseRef.current = null
    }
  }, [onBusyChange, sessionId])

  const enqueueChunk = (blob: Blob, mimeType: string) => {
    for (let offset = 0; offset < blob.size; offset += CLIENT_CHUNK_BYTES) {
      const part = blob.slice(offset, offset + CLIENT_CHUNK_BYTES, mimeType)
      pendingChunksRef.current.push({
        index: nextChunkIndexRef.current + pendingChunksRef.current.length,
        blob: part,
      })
    }
    setPendingChunkCount(pendingChunksRef.current.length)
    void flushPendingChunks().catch(() => undefined)
  }

  const startRecording = async () => {
    if (!recordingConsentState?.consent?.acknowledged) {
      setRoomError('Acknowledge the optional recording consent before recording.')
      return
    }
    const videoTracks = sharedStream?.getVideoTracks() ?? []
    const audioTracks = sharedStream?.getAudioTracks() ?? []
    if (!sharedStream || !videoTracks.length || !audioTracks.length) {
      setRoomError('Enable both camera and microphone before starting an audio/video recording.')
      return
    }
    if (typeof MediaRecorder === 'undefined') {
      setRoomError('Video recording is not supported in this browser. You can continue without recording.')
      return
    }
    if (recordingConsentState.recording?.status === 'UPLOADING') {
      setRoomError('A saved segment is waiting to be finalized. Finalize it before starting a new segment.')
      return
    }
    try {
      const recording = await createInterviewVideoRecording(sessionId)
      recordingIdRef.current = recording.id
      nextChunkIndexRef.current = recording.next_chunk_index
      await refreshRecordingState()
      const supportedTypes = [
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
      ]
      const mimeType = supportedTypes.find((type) => MediaRecorder.isTypeSupported?.(type))
      recordingMimeRef.current = mimeType?.split(';')[0] ?? 'video/webm'
      const recorder = new MediaRecorder(
        sharedStream,
        mimeType ? { mimeType } : undefined,
      )
      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          enqueueChunk(event.data, recorder.mimeType || recordingMimeRef.current)
        }
      }
      recorder.onerror = () => {
        setRoomError('Video recording was interrupted. The uploaded portion is preserved; retry pending chunks or finalize the saved segment.')
        if (recorder.state !== 'inactive') recorder.stop()
        setCapturing(false)
      }
      recorder.onstop = () => setCapturing(false)
      recorderRef.current = recorder
      recorder.start(5000)
      setCapturing(true)
      setRoomError('')
      setPanelRefreshKey((current) => current + 1)
    } catch (startError) {
      setRoomError(startError instanceof Error && startError.message
        ? startError.message
        : 'Video recording could not start. Retry or continue without recording.')
    }
  }

  const stopRecording = () => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }

  const retryPendingUploads = async () => {
    try {
      await flushPendingChunks()
    } catch {
      return
    }
  }

  const finalizeRecording = useCallback(async () => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      const stopped = new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true })
      })
      recorder.stop()
      await stopped
    }
    if (pendingChunksRef.current.length) await flushPendingChunks()
    const recordingId = recordingIdRef.current
    if (recordingId === null) return
    await finalizeInterviewVideoRecording(sessionId, recordingId)
    recordingIdRef.current = null
    await refreshRecordingState()
  }, [flushPendingChunks, refreshRecordingState, sessionId])

  useImperativeHandle(ref, () => ({ finalizeRecording }), [finalizeRecording])

  const acknowledgeConsent = async () => {
    const consentVersion = recordingConsentState?.required_consent_version
    if (!consentVersion || !consentChecked) return
    setRoomError('')
    try {
      await acknowledgeInterviewVideoRecordingConsent(sessionId, consentVersion)
      await refreshRecordingState()
      setConsentChecked(false)
    } catch {
      setRoomError('Recording consent could not be saved. Check your connection and retry.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section aria-label="Video device check" className="space-y-3 rounded-xl border border-slate-200 bg-slate-950 p-4 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">Your camera</h2>
            <Button type="button" variant="outline" size="sm" onClick={() => void checkDevices()}>Check devices</Button>
          </div>
          <video
            ref={videoElementRef}
            autoPlay
            muted
            playsInline
            aria-label="Your webcam preview"
            className="aspect-video w-full rounded-lg bg-slate-800 object-cover"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={!sharedStream?.getVideoTracks().length} onClick={toggleCamera}>
              {cameraEnabled ? <CameraOff className="mr-2 h-4 w-4" aria-hidden="true" /> : <Camera className="mr-2 h-4 w-4" aria-hidden="true" />}
              {cameraEnabled ? 'Camera off' : 'Camera on'}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={!sharedStream?.getAudioTracks().length} onClick={toggleMicrophone}>
              {muted ? <Mic className="mr-2 h-4 w-4" aria-hidden="true" /> : <MicOff className="mr-2 h-4 w-4" aria-hidden="true" />}
              {muted ? 'Unmute microphone' : 'Mute microphone'}
            </Button>
            <span role="status" className="text-xs text-slate-300">
              Connection: {backendConnected === null ? 'checking…' : backendConnected && networkOnline ? 'connected' : 'offline'}
            </span>
          </div>
          {cameraError && <p role="alert" className="text-sm text-amber-200">{cameraError}</p>}
          {microphoneError && <p role="alert" className="text-sm text-amber-200">{microphoneError}</p>}
        </section>

        <section aria-label="Interviewer and question" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div role="img" aria-label="Static interviewer avatar" className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">
              <UserRound aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900 dark:text-white">Interviewer</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Static avatar · no AI-generated video</p>
            </div>
            <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => setCaptionsVisible((value) => !value)}>
              Captions {captionsVisible ? 'on' : 'off'}
            </Button>
          </div>
          {captionsVisible && <p aria-live="polite" className="select-none rounded-lg bg-slate-50 p-4 text-base leading-7 text-slate-800 dark:bg-slate-800 dark:text-slate-100">{questionText}</p>}
        </section>
      </div>

      <section aria-label="Optional video recording consent" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
        <h2 className="font-semibold text-amber-950 dark:text-amber-100">Optional session recording · off by default</h2>
        {recordingConsentState?.consent?.acknowledged ? (
          <p role="status" className="text-sm text-amber-950 dark:text-amber-100">Recording consent is saved. Recording starts only when you choose Start recording.</p>
        ) : (
          <>
            <p className="text-sm leading-6 text-amber-950 dark:text-amber-100">
              If enabled, the webcam and microphone are recorded for your private playback and self-review. Recordings are stored in private storage, visible only to you, and deleted automatically within 30 days. You can delete them at any time. They are not used for facial, emotion, honesty, appearance, or hiring analysis.
            </p>
            <label className="flex items-start gap-3 text-sm text-amber-950 dark:text-amber-100">
              <input type="checkbox" checked={consentChecked} onChange={(event) => setConsentChecked(event.target.checked)} />
              <span>I explicitly consent to recording and private storage as described above.</span>
            </label>
            <Button type="button" variant="outline" disabled={!consentChecked} onClick={() => void acknowledgeConsent()}>
              Save recording consent
            </Button>
          </>
        )}
        {recordingConsentState?.consent?.acknowledged && (
          <div className="flex flex-wrap gap-2">
            {!capturing ? (
              <Button type="button" variant="outline" disabled={uploading || recordingConsentState.recording?.status === 'UPLOADING'} onClick={() => void startRecording()}>
                Start recording
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={stopRecording}>Stop recording</Button>
            )}
            {pendingChunkCount > 0 && (
              <Button type="button" variant="outline" disabled={uploading} onClick={() => void retryPendingUploads()}>
                {uploading ? 'Uploading…' : `Retry ${pendingChunkCount} pending chunk(s)`}
              </Button>
            )}
          </div>
        )}
        {roomError && <p role="alert" className="text-sm text-rose-800 dark:text-rose-200">{roomError}</p>}
        {recordingConsentState?.recording?.status === 'UPLOADING' && !capturing && (
          <p role="status" className="text-sm text-amber-950 dark:text-amber-100">
            A saved segment is waiting to be finalized. This can happen after a refresh or interruption; uploaded chunks are preserved.
          </p>
        )}
      </section>

      {children(sharedStream)}
      <InterviewVideoRecordingPanel
        sessionId={sessionId}
        refreshKey={panelRefreshKey}
        canFinalize={!capturing && !uploading && pendingChunkCount === 0}
        onStateChange={applyRecordingState}
      />
    </div>
  )
})
