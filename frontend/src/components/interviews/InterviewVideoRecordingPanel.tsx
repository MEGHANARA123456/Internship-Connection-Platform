import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import {
  deleteInterviewVideoRecording,
  finalizeInterviewVideoRecording,
  getInterviewVideoRecording,
  getInterviewVideoRecordingState,
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

  const loadState = useCallback(async () => {
    try {
      const current = await getInterviewVideoRecordingState(sessionId)
      setState(current)
      onStateChange?.(current)
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Recording status could not be loaded.')
    }
  }, [onStateChange, sessionId])

  useEffect(() => {
    void loadState()
  }, [loadState, refreshKey])

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [])

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
      setError(playError instanceof Error ? playError.message : 'Recording could not be played.')
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
      setError(finalizeError instanceof Error ? finalizeError.message : 'The saved recording segment could not be finalized.')
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
      setError(deleteError instanceof Error ? deleteError.message : 'The recording could not be deleted.')
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
            {recording.status === 'UPLOADING'
              ? `Saved segment in progress · ${recording.chunk_count} uploaded chunk(s)`
              : `Recording · ${recording.duration_seconds?.toFixed(1) ?? '—'} seconds`}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Private to you. Expires {new Date(recording.retention_expires_at).toLocaleDateString()}.
          </p>
          <div className="flex flex-wrap gap-2">
            {recording.status === 'UPLOADING' && (
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busyRecordingId === recording.id}
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
