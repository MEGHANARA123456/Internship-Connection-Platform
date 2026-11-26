import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { useToast } from '../ui/ToastProvider'
import {
  deleteInterviewVideoRecording,
  finalizeInterviewVideoRecording,
  getInterviewVideoRecording,
  getInterviewVideoRecordingState,
  retryInterviewVideoRecording,
} from '../../services/interviewService'
import type { InterviewVideoRecordingState } from '../../types/interview'

interface InterviewVideoRecordingPanelProps {
  sessionId: number
  refreshKey?: number
  canFinalize?: boolean
  onStateChange?: (state: InterviewVideoRecordingState) => void
}

export function InterviewVideoRecordingPanel({
  sessionId,
  refreshKey = 0,
  canFinalize = true,
  onStateChange,
}: InterviewVideoRecordingPanelProps) {
  const [state, setState] = useState<InterviewVideoRecordingState | null>(null)
  const [busyRecordingId, setBusyRecordingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [playingId, setPlayingId] = useState<number | null>(null)
  const [videoUrl, setVideoUrl] = useState('')
  const objectUrlRef = useRef<string | null>(null)
  const { toast } = useToast()

  const loadState = useCallback(async () => {
    try {
      const current = await getInterviewVideoRecordingState(sessionId)
      setState(current)
      onStateChange?.(current)
      setError('')
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Recording status could not be loaded.'
      setError(message)
      toast(message, { kind: 'error' })
    }
  }, [onStateChange, sessionId, toast])

  useEffect(() => {
    void loadState()
  }, [loadState, refreshKey])

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [])

  const pendingWork = state?.recordings.some((recording) => (
    recording.status === 'PENDING_UPLOAD'
    || recording.status === 'PENDING_DELETE'
    || (recording.status === 'UPLOADING' && recording.finalized)
  )) ?? false

  useEffect(() => {
    if (!pendingWork) return
    const timer = window.setInterval(() => void loadState(), 3000)
    return () => window.clearInterval(timer)
  }, [loadState, pendingWork])

  useEffect(() => {
    if (!pendingWork && busyRecordingId === null) return
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [busyRecordingId, pendingWork])

  const playRecording = async (recordingId: number) => {
    setBusyRecordingId(recordingId)
    setError('')
    try {
      const blob = await getInterviewVideoRecording(sessionId, recordingId)
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      const url = URL.createObjectURL(blob)
      objectUrlRef.current = url
      setVideoUrl(url)
      setPlayingId(recordingId)
    } catch (playError) {
      const message = playError instanceof Error ? playError.message : 'Recording could not be played.'
      setError(message)
      toast(message, { kind: 'error' })
    } finally {
      setBusyRecordingId(null)
    }
  }

  const finalizeRecording = async (recordingId: number) => {
    setBusyRecordingId(recordingId)
    setError('')
    try {
      await finalizeInterviewVideoRecording(sessionId, recordingId)
      await loadState()
    } catch (finalizeError) {
      const message = finalizeError instanceof Error ? finalizeError.message : 'The saved recording segment could not be finalized.'
      setError(message)
      toast(message, { kind: 'error' })
    } finally {
      setBusyRecordingId(null)
    }
  }

  const removeRecording = async (recordingId: number) => {
    if (!window.confirm('Delete this private recording now? This cannot be undone.')) return
    setBusyRecordingId(recordingId)
    setError('')
    try {
      await deleteInterviewVideoRecording(sessionId, recordingId)
      if (playingId === recordingId) {
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
        setVideoUrl('')
        setPlayingId(null)
      }
      await loadState()
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : 'The recording could not be deleted.'
      setError(message)
      toast(message, { kind: 'error' })
    } finally {
      setBusyRecordingId(null)
    }
  }

  const retryUpload = async (recordingId: number) => {
    setBusyRecordingId(recordingId)
    setError('')
    try {
      await retryInterviewVideoRecording(sessionId, recordingId)
      await loadState()
    } catch (retryError) {
      const message = retryError instanceof Error ? retryError.message : 'The recording upload could not be retried.'
      setError(message)
      toast(message, { kind: 'error' })
    } finally {
      setBusyRecordingId(null)
    }
  }

  const recordings = state?.recordings ?? []
  if (!recordings.length && !error) return null

  return (
    <section aria-label="Private interview recordings" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <h3 className="font-semibold text-slate-900 dark:text-white">Optional private recordings</h3>
      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      {recordings.map((recording) => (
        <div key={recording.id} className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <p className="text-sm">
            {recording.status === 'PENDING_UPLOAD'
              ? 'Queued for secure storage...'
              : recording.status === 'UPLOADING' && recording.finalized
                ? 'Uploading recording...'
                : recording.status === 'UPLOADING'
              ? `Saved segment in progress · ${recording.chunk_count} uploaded chunk(s)`
              : recording.status === 'FAILED'
                ? 'Recording upload failed.'
                : recording.status === 'PENDING_DELETE'
                  ? 'Recording deletion is queued.'
                  : recording.status === 'DELETED'
                    ? 'Recording deleted.'
                    : recording.status === 'EXPIRED'
                      ? 'Recording expired.'
                      : `Recording · ${recording.duration_seconds?.toFixed(1) ?? '—'} seconds`}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Private to you. Expires {new Date(recording.retention_expires_at).toLocaleDateString()}.
          </p>
          <div className="flex flex-wrap gap-2">
            {recording.status === 'UPLOADING' && !recording.finalized && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canFinalize || busyRecordingId === recording.id}
                isLoading={busyRecordingId === recording.id}
                onClick={() => void finalizeRecording(recording.id)}
              >
                Finalize saved segment
              </Button>
            )}
            {recording.status === 'AVAILABLE' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busyRecordingId === recording.id}
                isLoading={busyRecordingId === recording.id}
                onClick={() => void playRecording(recording.id)}
              >
                Play recording
              </Button>
            )}
            {recording.status === 'FAILED' && recording.retryable && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busyRecordingId === recording.id}
                isLoading={busyRecordingId === recording.id}
                onClick={() => void retryUpload(recording.id)}
              >
                Retry upload
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busyRecordingId === recording.id || ['DELETED', 'EXPIRED', 'PENDING_DELETE'].includes(recording.status)}
              onClick={() => void removeRecording(recording.id)}
            >
              Delete recording
            </Button>
          </div>
          {playingId === recording.id && videoUrl && (
            <video
              aria-label="Private interview recording playback"
              controls
              playsInline
              src={videoUrl}
              className="w-full rounded-lg bg-black"
            />
          )}
        </div>
      ))}
    </section>
  )
}
